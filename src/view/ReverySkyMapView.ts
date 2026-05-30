import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App, CachedMetadata, TAbstractFile, TFile } from "obsidian";
import type { GraphPayload, NoteFocusPayload, NoteOpenPayload } from "../bridge/BridgeTypes";
import { UnityIframeBridge } from "../bridge/UnityIframeBridge";
import { VaultGraphBuilder } from "../graph/VaultGraphBuilder";
import type ReverySkyMapPlugin from "../main";

export const REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";
const GRAPH_REFRESH_DEBOUNCE_MS = 250;
const GRAPH_RESOLVE_BARRIER_FALLBACK_MS = 700;

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "sendGraphSet" | "sendNoteFocus">;
type ObsidianHTMLElement = HTMLElement & {
  empty?: () => void;
  createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

export type ReverySkyMapViewDependencies = {
  createBridge?: () => BridgePort;
  buildGraph?: (app: App) => GraphPayload;
  notify?: (message: string) => void;
  now?: () => number;
};

export class ReverySkyMapView extends ItemView {
  navigation = false;
  private readonly bridge: BridgePort;
  private readonly buildGraph: (app: App) => GraphPayload;
  private readonly notify: (message: string) => void;
  private readonly now: () => number;
  private lastGraphPayload: GraphPayload | null = null;
  private pendingGraphPayload: GraphPayload | null = null;
  private pendingFocusPayload: NoteFocusPayload | null = null;
  private lastMarkdownLeaf: WorkspaceLeaf | null = null;
  private activeMarkdownPath = "";
  private focusOrdinal = 0;
  private activeFocusOrdinal = 0;
  private pendingCreatedFocusOrdinal = 0;
  private pendingCreatedFocusPath: string | null = null;
  private lastDispatchedFocusKey = "";
  private semanticRefreshPending = false;
  private noteSignatureByPath = new Map<string, string>();
  private bridgeReady = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveBarrierFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshSubscriptionsRegistered = false;
  private refreshActive = false;
  private leafTrackingRegistered = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ReverySkyMapPlugin,
    deps: ReverySkyMapViewDependencies = {}
  ) {
    super(leaf);
    this.bridge = deps.createBridge?.() ?? new UnityIframeBridge();
    this.buildGraph = deps.buildGraph ?? VaultGraphBuilder.build;
    this.notify = deps.notify ?? ((message: string) => new Notice(message));
    this.now = deps.now ?? Date.now;
  }

  getViewType(): string {
    return REVERYSKY_MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ReverySky Map";
  }

  async onOpen(): Promise<void> {
    this.ensureLeafTracking();
    this.ensureRefreshSubscriptions();
    this.refreshActive = true;
    this.bridgeReady = false;
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastDispatchedFocusKey = "";
    this.pendingCreatedFocusPath = null;
    this.pendingCreatedFocusOrdinal = 0;
    this.semanticRefreshPending = false;
    this.clearRefreshTimer();
    this.clearResolveBarrierFallbackTimer();

    const container = this.contentEl as ObsidianHTMLElement;
    emptyElement(container);

    let iframeSrc: string;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }

    const iframe = createChild(container, "iframe");
    iframe.src = `${iframeSrc}?t=${this.now()}`;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    if (typeof (iframe as ObsidianHTMLElement).setAttr === "function") {
      (iframe as ObsidianHTMLElement).setAttr!("title", "ReverySky Map");
    } else {
      iframe.setAttribute("title", "ReverySky Map");
    }

    iframe.addEventListener("load", () => {
      if (!iframe.contentWindow) {
        this.notify("Failed to access iframe window.");
        return;
      }

      this.bridge.attach(iframe.contentWindow, {
        onReady: () => {
          this.bridgeReady = true;
          this.flushOrRefreshGraph();
        },
        onNoteOpen: (payload: NoteOpenPayload) => {
          void this.openRequestedNote(payload);
        },
        onError: (message: string) => {
          this.notify(message);
        }
      });
    });
  }

  async onClose(): Promise<void> {
    this.refreshActive = false;
    this.clearRefreshTimer();
    this.clearResolveBarrierFallbackTimer();
    this.bridgeReady = false;
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastDispatchedFocusKey = "";
    this.pendingCreatedFocusPath = null;
    this.pendingCreatedFocusOrdinal = 0;
    this.semanticRefreshPending = false;
    this.bridge.detach();
    this.lastGraphPayload = null;
    emptyElement(this.contentEl as ObsidianHTMLElement);
  }

  private ensureRefreshSubscriptions(): void {
    if (this.refreshSubscriptionsRegistered) {
      return;
    }

    this.refreshSubscriptionsRegistered = true;
    const metadataCache = (this.app as Partial<App>).metadataCache;
    const vault = (this.app as Partial<App>).vault;

    if (metadataCache?.on) {
      this.registerEvent(
        metadataCache.on("changed", (file: TFile, _data: string, cache: CachedMetadata) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }

          const path = this.normalizeVaultPath(file.path);
          const nextSignature = this.buildGraphRelevantSignature(cache);
          const previousSignature = this.noteSignatureByPath.get(path) ?? "";
          this.noteSignatureByPath.set(path, nextSignature);
          if (nextSignature === previousSignature) {
            return;
          }

          this.markSemanticRefreshPending();
        })
      );
      this.registerEvent(
        metadataCache.on("resolved", () => {
          if (!this.semanticRefreshPending) {
            return;
          }

          this.semanticRefreshPending = false;
          this.clearResolveBarrierFallbackTimer();
          this.scheduleGraphRefresh();
        })
      );
    }

    if (vault?.on) {
      this.registerEvent(
        vault.on("create", (file: TAbstractFile) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          const normalizedPath = this.normalizeVaultPath(file.path);
          this.pendingCreatedFocusPath = normalizedPath;
          this.pendingCreatedFocusOrdinal = ++this.focusOrdinal;
          this.scheduleGraphRefresh();
        })
      );
      this.registerEvent(
        vault.on("delete", (file: TAbstractFile) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          this.noteSignatureByPath.delete(this.normalizeVaultPath(file.path));
          this.scheduleGraphRefresh();
        })
      );
      this.registerEvent(
        vault.on("rename", (file: TAbstractFile, oldPath: string) => {
          if (!this.isGraphRelevantPath(file?.path) && !this.isGraphRelevantPath(oldPath)) {
            return;
          }
          const normalizedOldPath = this.normalizeVaultPath(oldPath);
          const normalizedNewPath = this.normalizeVaultPath(file?.path);

          // Keep focus stable when the active note itself is being renamed.
          if (normalizedOldPath && this.normalizeVaultPath(this.activeMarkdownPath) === normalizedOldPath) {
            this.activeMarkdownPath = normalizedNewPath;
            this.activeFocusOrdinal = ++this.focusOrdinal;
          }

          if (this.pendingCreatedFocusPath && this.normalizeVaultPath(this.pendingCreatedFocusPath) === normalizedOldPath) {
            this.pendingCreatedFocusPath = normalizedNewPath;
          }

          if (this.isGraphRelevantPath(oldPath)) {
            this.noteSignatureByPath.delete(normalizedOldPath);
          }
          this.scheduleGraphRefresh();
        })
      );
    }
  }

  private markSemanticRefreshPending(): void {
    if (!this.refreshActive) {
      return;
    }

    this.semanticRefreshPending = true;
    this.clearResolveBarrierFallbackTimer();
    this.resolveBarrierFallbackTimer = setTimeout(() => {
      this.resolveBarrierFallbackTimer = null;
      if (!this.semanticRefreshPending) {
        return;
      }

      this.semanticRefreshPending = false;
      this.scheduleGraphRefresh();
    }, GRAPH_RESOLVE_BARRIER_FALLBACK_MS);
  }

  private scheduleGraphRefresh(): void {
    if (!this.refreshActive) {
      return;
    }
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshGraphNow();
    }, GRAPH_REFRESH_DEBOUNCE_MS);
  }

  private refreshGraphNow(): void {
    const payload = this.buildGraph(this.app);
    this.lastGraphPayload = payload;
    if (!this.bridgeReady) {
      this.pendingGraphPayload = payload;
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(payload);
      return;
    }

    this.pendingGraphPayload = null;
    this.bridge.sendGraphSet(payload);
    this.dispatchPreferredFocus(payload);
  }

  private flushOrRefreshGraph(): void {
    if (this.pendingGraphPayload) {
      const payload = this.pendingGraphPayload;
      this.pendingGraphPayload = null;
      this.lastGraphPayload = payload;
      this.bridge.sendGraphSet(payload);
      if (this.pendingFocusPayload) {
        this.bridge.sendNoteFocus(this.pendingFocusPayload);
        this.lastDispatchedFocusKey = this.toFocusKey(this.pendingFocusPayload);
        this.pendingFocusPayload = null;
      } else {
        this.dispatchPreferredFocus(payload);
      }
      return;
    }

    this.refreshGraphNow();
  }

  private clearRefreshTimer(): void {
    if (!this.refreshTimer) {
      return;
    }

    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private clearResolveBarrierFallbackTimer(): void {
    if (!this.resolveBarrierFallbackTimer) {
      return;
    }

    clearTimeout(this.resolveBarrierFallbackTimer);
    this.resolveBarrierFallbackTimer = null;
  }

  private dispatchPreferredFocus(payload: GraphPayload): void {
    if (!this.bridgeReady) {
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(payload);
      return;
    }

    const focusPayload = this.resolvePreferredFocusPayload(payload);
    if (!focusPayload) {
      return;
    }

    const focusKey = this.toFocusKey(focusPayload);
    if (focusKey && focusKey === this.lastDispatchedFocusKey) {
      return;
    }

    this.bridge.sendNoteFocus(focusPayload);
    this.lastDispatchedFocusKey = focusKey;
  }

  private resolvePreferredFocusPayload(payload: GraphPayload): NoteFocusPayload | null {
    const preferredPath = this.getPreferredFocusPath();
    if (!preferredPath) {
      return null;
    }

    const normalizedPreferredPath = this.normalizeVaultPath(preferredPath);
    const byPath =
      payload.notes.find((note) => this.normalizeVaultPath(note.path) === normalizedPreferredPath) ??
      null;

    if (this.pendingCreatedFocusPath) {
      const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);
      const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
      if (!activePath || this.activeFocusOrdinal >= this.pendingCreatedFocusOrdinal || activePath === createdPath) {
        this.pendingCreatedFocusPath = null;
        this.pendingCreatedFocusOrdinal = 0;
      }
    }

    if (!byPath) {
      return {
        path: normalizedPreferredPath
      };
    }

    return {
      id: byPath.id,
      path: byPath.path
    };
  }

  private getPreferredFocusPath(): string {
    const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
    const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);

    if (activePath && (!createdPath || this.activeFocusOrdinal >= this.pendingCreatedFocusOrdinal)) {
      return activePath;
    }
    if (createdPath) {
      return createdPath;
    }
    return activePath;
  }

  private toFocusKey(payload: NoteFocusPayload): string {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    const path = typeof payload.path === "string" ? this.normalizeVaultPath(payload.path) : "";
    return `${id}|${path}`;
  }

  private buildGraphRelevantSignature(cache: CachedMetadata | null): string {
    const inlineTags = (cache?.tags ?? [])
      .map((tagEntry) => (typeof tagEntry?.tag === "string" ? tagEntry.tag : ""))
      .filter((tag) => tag.length > 0);
    const frontmatterTags = this.extractFrontmatterTags(cache?.frontmatter);
    const tags = Array.from(
      new Set(
        [...inlineTags, ...frontmatterTags]
          .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
          .filter((tag) => tag.length > 0)
      )
    ).sort();

    const links = Array.from(
      new Set(
        (cache?.links ?? [])
          .map((link) => this.normalizeLinkValue(link.link))
          .filter((link) => link.length > 0)
      )
    ).sort();

    return JSON.stringify({
      tags,
      links
    });
  }

  private normalizeLinkValue(linkValue: unknown): string {
    if (typeof linkValue !== "string") {
      return "";
    }
    return linkValue.trim().replace(/\\/g, "/").toLowerCase();
  }

  private normalizeVaultPath(pathValue: unknown): string {
    if (typeof pathValue !== "string") {
      return "";
    }
    return pathValue.trim().replace(/\\/g, "/");
  }

  private extractFrontmatterTags(frontmatter: unknown): string[] {
    if (!frontmatter || typeof frontmatter !== "object") {
      return [];
    }

    const tagsRaw = (frontmatter as { tags?: unknown }).tags;
    if (typeof tagsRaw === "string") {
      return [tagsRaw];
    }
    if (Array.isArray(tagsRaw)) {
      return tagsRaw.filter((tag): tag is string => typeof tag === "string");
    }
    return [];
  }

  private isGraphRelevantPath(pathValue: unknown): boolean {
    if (typeof pathValue !== "string") {
      return false;
    }
    return pathValue.toLowerCase().endsWith(".md");
  }

  private async openRequestedNote(payload: NoteOpenPayload): Promise<void> {
    const resolvedPath = this.resolveRequestedPath(payload);
    if (!resolvedPath) {
      this.notify("Unable to open note: bridge payload did not include a valid note id or path.");
      return;
    }

    const noteFile = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!noteFile || typeof (noteFile as { path?: unknown }).path !== "string") {
      this.notify(`Unable to open note: file not found for path '${resolvedPath}'.`);
      return;
    }

    const targetLeaf = this.resolveTargetNoteLeaf();
    const sourcePath = targetLeaf ? this.getLeafSourcePath(targetLeaf) : "";
    try {
      await this.app.workspace.openLinkText(
        noteFile.path,
        sourcePath,
        false,
        targetLeaf
          ? {
              active: true,
              group: targetLeaf
            }
          : {
              active: true
            }
      );
    } catch (error) {
      this.notify(`Unable to open note: ${String(error)}`);
    }
  }

  private resolveRequestedPath(payload: NoteOpenPayload): string | null {
    const requestedId = typeof payload.id === "string" ? payload.id.trim() : "";
    const requestedPath = typeof payload.path === "string" ? payload.path.trim() : "";

    if (requestedId && this.lastGraphPayload) {
      const byId = this.lastGraphPayload.notes.find((note) => note.id === requestedId);
      if (byId?.path?.trim()) {
        return byId.path.replace(/\\/g, "/");
      }
    }

    if (requestedPath) {
      return requestedPath.replace(/\\/g, "/");
    }

    return null;
  }

  private ensureLeafTracking(): void {
    if (this.leafTrackingRegistered) {
      return;
    }

    this.leafTrackingRegistered = true;
    const workspace = this.app.workspace;
    if (!workspace) {
      return;
    }

    const currentActiveLeaf = workspace.activeLeaf ?? null;
    if (this.isMarkdownLeaf(currentActiveLeaf)) {
      this.lastMarkdownLeaf = currentActiveLeaf;
      this.activeMarkdownPath = this.getLeafSourcePath(currentActiveLeaf);
    } else {
      this.lastMarkdownLeaf = this.findAnyMarkdownLeaf();
      this.activeMarkdownPath = this.getLeafSourcePath(this.lastMarkdownLeaf);
    }

    this.registerEvent(
      workspace.on("active-leaf-change", (leaf) => {
        if (this.isMarkdownLeaf(leaf)) {
          this.lastMarkdownLeaf = leaf;
          this.activeFocusOrdinal = ++this.focusOrdinal;
          this.activeMarkdownPath = this.getLeafSourcePath(leaf);
          if (this.lastGraphPayload) {
            this.dispatchPreferredFocus(this.lastGraphPayload);
          }
        }
      })
    );
  }

  private resolveTargetNoteLeaf(): WorkspaceLeaf | null {
    const workspace = this.app.workspace;
    if (!workspace) {
      return null;
    }

    const activeLeaf = workspace.activeLeaf ?? null;
    if (this.isMarkdownLeaf(activeLeaf)) {
      return activeLeaf;
    }

    if (this.isMarkdownLeaf(this.lastMarkdownLeaf)) {
      return this.lastMarkdownLeaf;
    }

    const anyMarkdownLeaf = this.findAnyMarkdownLeaf();
    if (this.isMarkdownLeaf(anyMarkdownLeaf)) {
      this.lastMarkdownLeaf = anyMarkdownLeaf;
      return anyMarkdownLeaf;
    }

    return null;
  }

  private isMarkdownLeaf(leaf: WorkspaceLeaf | null): leaf is WorkspaceLeaf {
    if (!leaf) {
      return false;
    }

    const viewType = leaf.view?.getViewType?.();
    if (viewType === "markdown") {
      return true;
    }

    const stateType = leaf.getViewState?.().type;
    return stateType === "markdown";
  }

  private getLeafSourcePath(leaf: WorkspaceLeaf | null): string {
    const view = (leaf?.view as { file?: { path?: string } } | null) ?? null;
    const path = view?.file?.path;
    return typeof path === "string" ? path : "";
  }

  private findAnyMarkdownLeaf(): WorkspaceLeaf | null {
    const workspace = this.app.workspace;
    if (!workspace) {
      return null;
    }

    const markdownLeaf = workspace.getLeavesOfType("markdown")[0] ?? null;
    if (this.isMarkdownLeaf(markdownLeaf)) {
      return markdownLeaf;
    }

    let fallbackLeaf: WorkspaceLeaf | null = null;
    workspace.iterateAllLeaves((leaf) => {
      if (!fallbackLeaf && this.isMarkdownLeaf(leaf)) {
        fallbackLeaf = leaf;
      }
    });

    return fallbackLeaf;
  }
}

function emptyElement(element: ObsidianHTMLElement): void {
  if (typeof element.empty === "function") {
    element.empty();
    return;
  }

  element.replaceChildren();
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  if (typeof element.createEl === "function") {
    return element.createEl(tagName);
  }

  const child = document.createElement(tagName);
  element.appendChild(child);
  return child as HTMLElementTagNameMap[K];
}
