import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { GraphPayload, NoteOpenPayload } from "../bridge/BridgeTypes";
import { UnityIframeBridge } from "../bridge/UnityIframeBridge";
import { VaultGraphBuilder } from "../graph/VaultGraphBuilder";
import type ReverySkyMapPlugin from "../main";

export const REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "sendGraphSet">;
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
  private lastMarkdownLeaf: WorkspaceLeaf | null = null;
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
          const payload = this.buildGraph(this.app);
          this.lastGraphPayload = payload;
          this.bridge.sendGraphSet(payload);
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
    this.bridge.detach();
    this.lastGraphPayload = null;
    emptyElement(this.contentEl as ObsidianHTMLElement);
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
    } else {
      this.lastMarkdownLeaf = this.findAnyMarkdownLeaf();
    }

    this.registerEvent(
      workspace.on("active-leaf-change", (leaf) => {
        if (this.isMarkdownLeaf(leaf)) {
          this.lastMarkdownLeaf = leaf;
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

  private getLeafSourcePath(leaf: WorkspaceLeaf): string {
    const view = leaf.view as { file?: { path?: string } } | null;
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
