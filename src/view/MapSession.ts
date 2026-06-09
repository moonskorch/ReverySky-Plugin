import type {
  App,
  CachedMetadata,
  EventRef,
  TAbstractFile,
  TFile,
  WorkspaceLeaf
} from "obsidian";
import type {
  GraphEnginePreference,
  GraphPayload,
  NoteFocusPayload,
  NoteOpenPayload
} from "../bridge/BridgeTypes";
import {
  DEFAULT_ENGINE_PREFERENCE,
  normalizeGraphEnginePreference
} from "../bridge/EnginePreference";
import { GraphPathFilter, type ParsedPathFilter, type PathFilterParseResult } from "../graph/GraphPathFilter";

const GRAPH_REFRESH_DEBOUNCE_MS = 250;
const GRAPH_RESOLVE_BARRIER_FALLBACK_MS = 700;
const FILTER_INPUT_DEBOUNCE_MS = 250;
const MAX_FOLDER_SUGGESTIONS = 80;
const MAX_TAG_SUGGESTIONS = 200;
export type MapViewState = {
  pathFilterQuery?: unknown;
  showTags?: unknown;
  enginePreference?: unknown;
};

export type MapFilterUiState = {
  pathFilterQuery: string;
  showTags: boolean;
  enginePreference: GraphEnginePreference;
  pathFilterParseValid: boolean;
  pathFilterMessage: string;
};

export type FolderPathSuggestion = {
  path: string;
  normalizedPath: string;
  count: number;
  depth: number;
};

export type DateFilterPresetSuggestion = {
  label: string;
  suffix: string;
  description: string;
};

export type TagSuggestion = {
  tag: string;
  normalizedTag: string;
  displayTag: string;
};

export type MapSessionDependencies = {
  app: App;
  buildGraph: (app: App) => GraphPayload;
  now: () => number;
  sendGraph: (payload: GraphPayload) => void;
  sendFocus: (payload: NoteFocusPayload) => void;
};

/**
 * Coordinates the non-DOM map session state that must survive view re-renders:
 * graph refresh timing, persisted filters, and note-focus precedence.
 */
export class MapSession {
  private readonly app: App;
  private readonly buildGraph: (app: App) => GraphPayload;
  private readonly now: () => number;
  private readonly sendGraph: (payload: GraphPayload) => void;
  private readonly sendFocus: (payload: NoteFocusPayload) => void;

  private sourceGraphPayload: GraphPayload | null = null;
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
  private pathFilterQuery = "";
  private showTags = true;
  private enginePreference: GraphEnginePreference = DEFAULT_ENGINE_PREFERENCE;
  private activePathFilter: ParsedPathFilter | null = null;
  private pathFilterParseValid = true;
  private pathFilterMessage = "";
  private filterInputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private folderPathSuggestions: FolderPathSuggestion[] = [];
  private tagSuggestions: TagSuggestion[] = [];

  constructor(deps: MapSessionDependencies) {
    this.app = deps.app;
    this.buildGraph = deps.buildGraph;
    this.now = deps.now;
    this.sendGraph = deps.sendGraph;
    this.sendFocus = deps.sendFocus;
  }

  getState(): Record<string, unknown> {
    return {
      pathFilterQuery: this.pathFilterQuery,
      showTags: this.showTags,
      enginePreference: this.enginePreference
    };
  }

  async setState(state: unknown): Promise<void> {
    const nextState = (state ?? {}) as MapViewState;
    const nextQuery =
      typeof nextState.pathFilterQuery === "string" ? nextState.pathFilterQuery : "";
    const nextShowTags = typeof nextState.showTags === "boolean" ? nextState.showTags : true;
    const nextEnginePreference = normalizeGraphEnginePreference(nextState.enginePreference);
    this.pathFilterQuery = nextQuery;
    this.showTags = nextShowTags;
    this.enginePreference = nextEnginePreference;
    this.applyParsedFilterResult(GraphPathFilter.parsePathQuery(nextQuery));
  }

  start(registerEvent: (eventRef: EventRef) => void): void {
    this.ensureLeafTracking(registerEvent);
    this.ensureRefreshSubscriptions(registerEvent);
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
  }

  stop(): void {
    this.refreshActive = false;
    this.clearRefreshTimer();
    this.clearResolveBarrierFallbackTimer();
    this.clearFilterInputDebounceTimer();
    this.bridgeReady = false;
    this.sourceGraphPayload = null;
    this.folderPathSuggestions = [];
    this.tagSuggestions = [];
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastDispatchedFocusKey = "";
    this.pendingCreatedFocusPath = null;
    this.pendingCreatedFocusOrdinal = 0;
    this.semanticRefreshPending = false;
    this.lastGraphPayload = null;
  }

  setBridgeReady(isReady: boolean): void {
    this.bridgeReady = isReady;
  }

  setFilterQuery(query: string): void {
    this.pathFilterQuery = typeof query === "string" ? query : "";
    const parseResult = GraphPathFilter.parsePathQuery(this.pathFilterQuery);
    this.applyParsedFilterResult(parseResult);
    if (!parseResult.isValid) {
      return;
    }

    this.scheduleFilterRefresh();
  }

  setShowTags(showTags: boolean): void {
    this.showTags = showTags;
    this.emitGraphFromSource();
  }

  setEnginePreference(enginePreference: unknown): void {
    this.enginePreference = normalizeGraphEnginePreference(enginePreference);
    this.emitGraphFromSource();
  }

  getFilterUiState(): MapFilterUiState {
    return {
      pathFilterQuery: this.pathFilterQuery,
      showTags: this.showTags,
      enginePreference: this.enginePreference,
      pathFilterParseValid: this.pathFilterParseValid,
      pathFilterMessage: this.pathFilterMessage
    };
  }

  getFolderSuggestions(query: string): FolderPathSuggestion[] {
    this.ensureFolderSuggestionsReady();
    const activePathValue = this.extractActivePathFilterTermValue(query);
    const normalizedActive = this.normalizeSearchTerm(activePathValue);

    return this.folderPathSuggestions
      .filter((item) => {
        if (!normalizedActive) {
          return true;
        }
        return item.normalizedPath.includes(normalizedActive);
      })
      .sort((a, b) => {
        if (normalizedActive) {
          const aStarts = a.normalizedPath.startsWith(normalizedActive) ? 1 : 0;
          const bStarts = b.normalizedPath.startsWith(normalizedActive) ? 1 : 0;
          if (aStarts !== bStarts) {
            return bStarts - aStarts;
          }
        }
        if (a.depth !== b.depth) {
          return a.depth - b.depth;
        }
        if (a.count !== b.count) {
          return b.count - a.count;
        }
        return a.path.localeCompare(b.path, "en", { sensitivity: "base" });
      })
      .slice(0, MAX_FOLDER_SUGGESTIONS);
  }

  getTagSuggestions(query: string): TagSuggestion[] {
    this.ensureTagSuggestionsReady();
    const activeTagValue = this.extractActiveTagFilterTermValue(query);
    const normalizedActive = this.normalizeTagSuggestionSearchTerm(activeTagValue);

    return this.tagSuggestions
      .filter((item) => !normalizedActive || item.normalizedTag.includes(normalizedActive))
      .sort((a, b) => {
        if (normalizedActive) {
          const aStarts = a.normalizedTag.startsWith(normalizedActive) ? 1 : 0;
          const bStarts = b.normalizedTag.startsWith(normalizedActive) ? 1 : 0;
          if (aStarts !== bStarts) {
            return bStarts - aStarts;
          }
        }
        return a.displayTag.localeCompare(b.displayTag, undefined, { sensitivity: "base" });
      })
      .slice(0, MAX_TAG_SUGGESTIONS);
  }

  getDateFilterPresetSuggestions(): DateFilterPresetSuggestion[] {
    const today = this.utcDayFromNowOffset({ days: 0 });
    const weekAgo = this.utcDayFromNowOffset({ days: -7 });
    const monthAgo = this.utcDayFromNowOffset({ months: -1 });
    const yearAgo = this.utcDayFromNowOffset({ years: -1 });

    return [
      {
        label: "= today",
        suffix: today,
        description: "Matches notes dated today."
      },
      {
        label: ">= one week ago",
        suffix: `>=${weekAgo}`,
        description: "Matches notes on or newer than one week ago."
      },
      {
        label: ">= one month ago",
        suffix: `>=${monthAgo}`,
        description: "Matches notes on or newer than one month ago."
      },
      {
        label: ">= one year ago",
        suffix: `>=${yearAgo}`,
        description: "Matches notes on or newer than one year ago."
      }
    ];
  }

  flushOrRefresh(): void {
    if (this.pendingGraphPayload) {
      const payload = this.pendingGraphPayload;
      this.pendingGraphPayload = null;
      this.lastGraphPayload = payload;
      this.sendGraph(payload);
      if (this.pendingFocusPayload) {
        // Reuse the focus chosen before bridge readiness so late handshakes do not recompute precedence.
        this.sendFocus(this.pendingFocusPayload);
        this.lastDispatchedFocusKey = this.toFocusKey(this.pendingFocusPayload);
        this.pendingFocusPayload = null;
      } else {
        this.dispatchPreferredFocus(payload);
      }
      return;
    }

    if (this.sourceGraphPayload) {
      this.emitGraphFromSource();
      return;
    }

    this.refreshGraphNow();
  }

  resolveRequestedPath(payload: NoteOpenPayload): string | null {
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

  resolveTargetMarkdownLeaf(): WorkspaceLeaf | null {
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

  getLeafSourcePath(leaf: WorkspaceLeaf | null): string {
    const view = (leaf?.view as { file?: { path?: string } } | null) ?? null;
    const path = view?.file?.path;
    return typeof path === "string" ? path : "";
  }

  private ensureRefreshSubscriptions(registerEvent: (eventRef: EventRef) => void): void {
    if (this.refreshSubscriptionsRegistered) {
      return;
    }

    this.refreshSubscriptionsRegistered = true;
    const metadataCache = (this.app as Partial<App>).metadataCache;
    const vault = (this.app as Partial<App>).vault;

    if (metadataCache?.on) {
      registerEvent(
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
      registerEvent(
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
      registerEvent(
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
      registerEvent(
        vault.on("delete", (file: TAbstractFile) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          this.noteSignatureByPath.delete(this.normalizeVaultPath(file.path));
          this.scheduleGraphRefresh();
        })
      );
      registerEvent(
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

  private ensureLeafTracking(registerEvent: (eventRef: EventRef) => void): void {
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

    registerEvent(
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

  private markSemanticRefreshPending(): void {
    if (!this.refreshActive) {
      return;
    }

    this.semanticRefreshPending = true;
    this.clearResolveBarrierFallbackTimer();
    // `metadataCache.resolved` is the ideal flush point; fall back if it never arrives.
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
    this.sourceGraphPayload = this.buildGraph(this.app);
    this.folderPathSuggestions = this.buildFolderPathSuggestions(this.sourceGraphPayload);
    this.tagSuggestions = this.buildTagSuggestions(this.sourceGraphPayload);
    this.emitGraphFromSource();
  }

  private scheduleFilterRefresh(): void {
    if (!this.refreshActive) {
      return;
    }

    this.clearFilterInputDebounceTimer();
    this.filterInputDebounceTimer = setTimeout(() => {
      this.filterInputDebounceTimer = null;
      this.emitGraphFromSource();
    }, FILTER_INPUT_DEBOUNCE_MS);
  }

  private emitGraphFromSource(): void {
    if (!this.sourceGraphPayload) {
      return;
    }

    const outgoingPayload = this.applyActiveFilters(this.sourceGraphPayload);
    this.lastGraphPayload = outgoingPayload;

    if (!this.bridgeReady) {
      // Cache the latest effective graph so the runtime receives the freshest snapshot after handshake.
      this.pendingGraphPayload = outgoingPayload;
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(outgoingPayload);
      return;
    }

    this.pendingGraphPayload = null;
    this.sendGraph(outgoingPayload);
    this.dispatchPreferredFocus(outgoingPayload);
  }

  private applyActiveFilters(payload: GraphPayload): GraphPayload {
    const pathFiltered = GraphPathFilter.applyPathFilter(payload, this.activePathFilter);
    const tagsFiltered = this.applyTagsVisibilityFilter(pathFiltered);
    return {
      ...tagsFiltered,
      enginePreference: this.enginePreference
    };
  }

  private applyTagsVisibilityFilter(payload: GraphPayload): GraphPayload {
    if (this.showTags) {
      return payload;
    }

    return {
      ...payload,
      notes: payload.notes.map((note) => ({
        ...note,
        tags: []
      }))
    };
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

    this.sendFocus(focusPayload);
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
      // Once active-note focus catches up, the temporary "new note" preference should stop winning.
      const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);
      const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
      if (!activePath || this.activeFocusOrdinal >= this.pendingCreatedFocusOrdinal || activePath === createdPath) {
        this.pendingCreatedFocusPath = null;
        this.pendingCreatedFocusOrdinal = 0;
      }
    }

    if (!byPath) {
      return null;
    }

    return {
      id: byPath.id,
      path: byPath.path
    };
  }

  private getPreferredFocusPath(): string {
    const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
    const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);

    // Active markdown note is the steady-state source of truth unless a newer created-note focus is still pending.
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

  private buildFolderPathSuggestions(payload: GraphPayload): FolderPathSuggestion[] {
    const counts = new Map<string, number>();

    for (const note of payload.notes) {
      const normalizedPath = this.normalizeVaultPath(note.path);
      const folderPrefixes = this.extractFolderPrefixes(normalizedPath);
      for (const prefix of folderPrefixes) {
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    }

    const suggestions: FolderPathSuggestion[] = [];
    for (const [folderPath, count] of counts.entries()) {
      const normalizedFolder = this.normalizeSearchTerm(folderPath);
      suggestions.push({
        path: folderPath,
        normalizedPath: normalizedFolder,
        count,
        depth: folderPath.split("/").length
      });
    }

    return suggestions.sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.path.localeCompare(b.path, "en", { sensitivity: "base" });
    });
  }

  private buildTagSuggestions(payload: GraphPayload): TagSuggestion[] {
    const uniqueTags = new Map<string, string>();

    for (const note of payload.notes) {
      for (const tag of note.tags) {
        const normalizedTag = this.normalizeTagSuggestionSearchTerm(tag);
        if (!normalizedTag || uniqueTags.has(normalizedTag)) {
          continue;
        }

        uniqueTags.set(normalizedTag, tag.trim().replace(/^#/, ""));
      }
    }

    return Array.from(uniqueTags.entries())
      .map(([normalizedTag, tag]) => ({
        tag,
        normalizedTag,
        displayTag: `#${tag}`
      }))
      .sort((a, b) => a.displayTag.localeCompare(b.displayTag, undefined, { sensitivity: "base" }));
  }

  private extractFolderPrefixes(normalizedNotePath: string): string[] {
    const slashIndex = normalizedNotePath.lastIndexOf("/");
    if (slashIndex < 1) {
      return [];
    }

    const folderPath = normalizedNotePath.slice(0, slashIndex);
    const parts = folderPath.split("/").filter((part) => part.length > 0);
    const prefixes: string[] = [];

    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      prefixes.push(current);
    }

    return prefixes;
  }

  private extractActivePathFilterTermValue(query: string): string {
    const activePattern = /(^|\s)-?path:(?:"([^"]*)"|([^\s]*))$/i;
    const match = query.match(activePattern);
    if (!match) {
      return "";
    }

    const quotedValue = typeof match[2] === "string" ? match[2] : "";
    const plainValue = typeof match[3] === "string" ? match[3] : "";
    const rawValue = quotedValue || plainValue;
    return rawValue.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  private extractActiveTagFilterTermValue(query: string): string {
    const activePattern = /(^|\s)-?tag:(?:"([^"]*)"|([^\s]*))$/i;
    const match = query.match(activePattern);
    if (!match) {
      return "";
    }

    const quotedValue = typeof match[2] === "string" ? match[2] : "";
    const plainValue = typeof match[3] === "string" ? match[3] : "";
    const rawValue = quotedValue || plainValue;
    return rawValue.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }

  private normalizeSearchTerm(value: string): string {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }

  private normalizeTagSuggestionSearchTerm(value: string): string {
    return value.trim().replace(/^#/, "").toLowerCase();
  }

  private applyParsedFilterResult(parseResult: PathFilterParseResult): void {
    this.pathFilterParseValid = parseResult.isValid;

    if (!parseResult.isValid) {
      this.pathFilterMessage = "";
      return;
    }

    this.pathFilterMessage = parseResult.hasUnsupportedTokens
      ? "Only path:, date:, and tag: terms are applied in this view."
      : "";
    this.activePathFilter = parseResult.hasPathTerms ? parseResult.parsed : null;
  }

  private ensureFolderSuggestionsReady(): void {
    if (this.folderPathSuggestions.length > 0) {
      return;
    }

    if (!this.sourceGraphPayload) {
      this.sourceGraphPayload = this.buildGraph(this.app);
    }

    if (!this.sourceGraphPayload) {
      return;
    }

    this.folderPathSuggestions = this.buildFolderPathSuggestions(this.sourceGraphPayload);
  }

  private ensureTagSuggestionsReady(): void {
    if (this.tagSuggestions.length > 0) {
      return;
    }

    if (!this.sourceGraphPayload) {
      this.sourceGraphPayload = this.buildGraph(this.app);
    }

    if (!this.sourceGraphPayload) {
      return;
    }

    this.tagSuggestions = this.buildTagSuggestions(this.sourceGraphPayload);
  }

  private utcDayFromNowOffset(offset: { days?: number; months?: number; years?: number }): string {
    const base = new Date(this.now());
    const baseYear = base.getUTCFullYear();
    const baseMonth = base.getUTCMonth();
    const baseDay = base.getUTCDate();
    const yearShift = offset.years ?? 0;
    const monthShift = offset.months ?? 0;
    const dayShift = offset.days ?? 0;
    const shifted = this.createClampedUtcDate(baseYear, baseMonth, baseDay, yearShift, monthShift);

    if (dayShift !== 0) {
      shifted.setUTCDate(shifted.getUTCDate() + dayShift);
    }

    return shifted.toISOString().slice(0, 10);
  }

  private createClampedUtcDate(
    baseYear: number,
    baseMonth: number,
    baseDay: number,
    yearShift: number,
    monthShift: number
  ): Date {
    const monthShiftedStart = new Date(Date.UTC(baseYear + yearShift, baseMonth + monthShift, 1));
    const targetYear = monthShiftedStart.getUTCFullYear();
    const targetMonth = monthShiftedStart.getUTCMonth();
    const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const clampedDay = Math.min(baseDay, daysInTargetMonth);
    return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
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

  private clearFilterInputDebounceTimer(): void {
    if (!this.filterInputDebounceTimer) {
      return;
    }

    clearTimeout(this.filterInputDebounceTimer);
    this.filterInputDebounceTimer = null;
  }
}
