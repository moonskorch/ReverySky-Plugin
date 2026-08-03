import {
  TFile,
  type App,
  type CachedMetadata,
  type EventRef,
  type TAbstractFile
} from "obsidian";
import type {
  MapLayoutPreference,
  GraphPayload,
  NoteFocusPayload,
  NoteOpenPayload,
  RuntimeSettingsPayload
} from "../bridge/BridgeTypes";
import {
  DEFAULT_MAP_LAYOUT_PREFERENCE,
  normalizeMapLayoutPreference
} from "../bridge/LayoutPreference";
import {
  DEFAULT_FRAME_RATE_MODE,
  normalizeFrameRateMode,
  type FrameRateMode
} from "../bridge/FrameRateMode";
import {
  GraphQueryFilter,
  areQueryFiltersEqual,
  type ParsedQueryFilter,
  type QueryFilterParseResult
} from "../graph/GraphQueryFilter";
import { makeStableNoteId } from "../graph/VaultGraphBuilder";
import { MapFocusController } from "./MapFocusController";

const GRAPH_REFRESH_DEBOUNCE_MS = 250;
const FILTER_INPUT_DEBOUNCE_MS = 500;
const METADATA_RESOLVE_STATUS = "Updating graph data...";
const MAX_FOLDER_SUGGESTIONS = 80;
const MAX_TAG_SUGGESTIONS = 200;
export const DEFAULT_RENDER_SCALE = 1;
export const MIN_RENDER_SCALE = 0.5;
export const MAX_RENDER_SCALE = 1.5;
export const RENDER_SCALE_STEP = 0.1;
export type MapViewState = {
  filterQuery?: unknown;
  showTags?: unknown;
  mapLayout?: unknown;
  renderScale?: unknown;
  frameRateMode?: unknown;
};

export type MapFilterUiState = {
  filterQuery: string;
  showTags: boolean;
  mapLayout: MapLayoutPreference;
  renderScale: number;
  renderScaleRestartRequired: boolean;
  frameRateMode: FrameRateMode;
  filterParseValid: boolean;
  filterMessage: string;
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
  sendStatus?: (message: string) => void;
  sendFocus: (payload: NoteFocusPayload) => void;
  sendRuntimeSettings?: (payload: RuntimeSettingsPayload) => void;
  onStateChanged?: (state: Record<string, unknown>, options?: { persist?: boolean }) => void;
};

/**
 * Coordinates the non-DOM graph session state that must survive view re-renders:
 * graph refresh timing, persisted filters, and bridge-facing focus coordination.
 */
export class MapSession {
  private readonly app: App;
  private readonly buildGraph: (app: App) => GraphPayload;
  private readonly now: () => number;
  private readonly sendGraph: (payload: GraphPayload) => void;
  private readonly sendStatus?: (message: string) => void;
  private readonly sendFocus: (payload: NoteFocusPayload) => void;
  private readonly sendRuntimeSettings?: (payload: RuntimeSettingsPayload) => void;
  private readonly onStateChanged?: (state: Record<string, unknown>, options?: { persist?: boolean }) => void;
  private readonly focus: MapFocusController;

  // Full vault graph snapshot used as the source for filters and suggestions.
  private sourceGraphPayload: GraphPayload | null = null;
  // Last effective graph snapshot prepared for Unity, focus checks, and note-open id resolution.
  private outgoingGraphPayload: GraphPayload | null = null;
  private semanticRefreshPending = false;
  private startupRefreshPending = false;
  private noteSignatureByPath = new Map<string, string>();
  // Plugin-side graph focus, updated from both TS focus dispatch and Unity note-open.
  private focusPath = "";
  private bridgeReady = false;
  private refreshTimer: number | null = null;
  private refreshTimerWindow: Window | null = null;
  private refreshSubscriptionsRegistered = false;
  private isLive = false;
  private filterQuery = "";
  private showTags = true;
  private mapLayout: MapLayoutPreference = DEFAULT_MAP_LAYOUT_PREFERENCE;
  private renderScale = DEFAULT_RENDER_SCALE;
  private appliedRenderScale = DEFAULT_RENDER_SCALE;
  private frameRateMode: FrameRateMode = DEFAULT_FRAME_RATE_MODE;
  // Parsed filter currently applied to the outgoing graph; live input commits it only after debounce.
  private activeQueryFilter: ParsedQueryFilter | null = null;
  private filterParseValid = true;
  private filterMessage = "";
  private filterInputDebounceTimer: number | null = null;
  private filterInputDebounceTimerWindow: Window | null = null;
  private folderPathSuggestions: FolderPathSuggestion[] = [];
  private tagSuggestions: TagSuggestion[] = [];

  constructor(deps: MapSessionDependencies) {
    this.app = deps.app;
    this.buildGraph = deps.buildGraph;
    this.now = deps.now;
    this.sendGraph = deps.sendGraph;
    this.sendStatus = deps.sendStatus;
    this.sendRuntimeSettings = deps.sendRuntimeSettings;
    this.onStateChanged = deps.onStateChanged;
    this.focus = new MapFocusController({
      app: this.app,
      now: this.now,
      requestFocus: (path, options) => this.trySendFocusForPath(path, options),
      getFocusPath: () => this.focusPath
    });
    this.sendFocus = deps.sendFocus;
  }

  getState(): Record<string, unknown> {
    return {
      filterQuery: this.filterQuery,
      showTags: this.showTags,
      mapLayout: this.mapLayout,
      renderScale: this.renderScale,
      frameRateMode: this.frameRateMode
    };
  }

  async setState(state: unknown): Promise<void> {
    const nextState = (state ?? {}) as MapViewState;
    const nextQuery = typeof nextState.filterQuery === "string" ? nextState.filterQuery : "";
    const nextShowTags = typeof nextState.showTags === "boolean" ? nextState.showTags : true;
    const nextLayoutPreference = normalizeMapLayoutPreference(nextState.mapLayout);
    this.filterQuery = nextQuery;
    this.showTags = nextShowTags;
    this.mapLayout = nextLayoutPreference;
    this.renderScale = normalizeRenderScale(nextState.renderScale);
    this.frameRateMode = normalizeFrameRateMode(nextState.frameRateMode);
    this.applyParsedQueryResult(GraphQueryFilter.parseQuery(nextQuery));
  }

  start(registerEvent: (eventRef: EventRef) => void): void {
    this.isLive = true;
    this.bridgeReady = false;
    this.appliedRenderScale = this.renderScale;
    this.focus.start(registerEvent);
    this.semanticRefreshPending = false;
    this.startupRefreshPending = false;
    this.focusPath = "";
    this.clearRefreshTimer();
    this.ensureRefreshSubscriptions(registerEvent);
  }

  stop(): void {
    this.isLive = false;
    this.clearRefreshTimer();
    this.clearFilterInputDebounceTimer();
    this.bridgeReady = false;
    this.sourceGraphPayload = null;
    this.folderPathSuggestions = [];
    this.tagSuggestions = [];
    this.focus.reset();
    this.semanticRefreshPending = false;
    this.startupRefreshPending = false;
    this.outgoingGraphPayload = null;
    this.focusPath = "";
  }

  handleRuntimeReady(): void {
    this.bridgeReady = true;
    this.sendCurrentRuntimeSettings();
    this.sendInitialRuntimeGraph();
  }

  handleRuntimeUnavailable(): void {
    this.bridgeReady = false;
  }

  setFilterQuery(query: string): void {
    const nextQuery = typeof query === "string" ? query : "";
    if (nextQuery === this.filterQuery) {
      return;
    }

    const parseResult = GraphQueryFilter.parseQuery(nextQuery);
    const nextActiveQueryFilter = this.resolveActiveQueryFilter(parseResult);
    // Compare parsed filters so whitespace-only query edits do not rebuild the runtime graph.
    const shouldSendGraph =
      parseResult.isValid &&
      !areQueryFiltersEqual(this.activeQueryFilter, nextActiveQueryFilter);

    this.filterQuery = nextQuery;
    this.notifyStateChanged({ persist: false });
    this.applyParsedQueryUiState(parseResult);
    this.scheduleFilterGraphUpdate(shouldSendGraph, nextActiveQueryFilter);
  }

  setShowTags(showTags: boolean): void {
    this.showTags = showTags;
    this.notifyStateChanged();
    this.sendGraphFromSource();
  }

  setMapLayoutPreference(mapLayout: unknown): void {
    this.mapLayout = normalizeMapLayoutPreference(mapLayout);
    this.notifyStateChanged();
    this.sendGraphFromSource();
  }

  setFrameRateMode(frameRateMode: unknown): void {
    this.frameRateMode = normalizeFrameRateMode(frameRateMode);
    this.notifyStateChanged();
    this.sendCurrentRuntimeSettings();
  }

  setRenderScale(renderScale: unknown): void {
    this.renderScale = normalizeRenderScale(renderScale);
    this.notifyStateChanged({ persist: false });
  }

  persistRenderScale(): void {
    this.notifyStateChanged();
  }

  getRenderScale(): number {
    return this.renderScale;
  }

  private sendCurrentRuntimeSettings(): void {
    if (!this.bridgeReady) {
      return;
    }

    this.sendRuntimeSettings?.({
      frameRateMode: this.frameRateMode
    });
  }

  getFilterUiState(): MapFilterUiState {
    return {
      filterQuery: this.filterQuery,
      showTags: this.showTags,
      mapLayout: this.mapLayout,
      renderScale: this.renderScale,
      renderScaleRestartRequired: this.renderScale !== this.appliedRenderScale,
      frameRateMode: this.frameRateMode,
      filterParseValid: this.filterParseValid,
      filterMessage: this.filterMessage
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

  private sendInitialRuntimeGraph(): void {
    if (this.outgoingGraphPayload) {
      this.sendGraph(this.outgoingGraphPayload);
    } else {
      if (!this.sourceGraphPayload) {
        this.rebuildSourceGraph();
      }
      this.sendGraphFromSource();
    }

    this.startupRefreshPending = true;
  }

  resolveRequestedPath(payload: NoteOpenPayload): string | null {
    const requestedId = typeof payload.id === "string" ? payload.id.trim() : "";
    const requestedPath = typeof payload.path === "string" ? payload.path.trim() : "";

    if (requestedId && this.outgoingGraphPayload) {
      const byId = this.outgoingGraphPayload.notes.find((note) => note.id === requestedId);
      if (byId?.path?.trim()) {
        return byId.path.replace(/\\/g, "/");
      }
    }

    if (requestedPath) {
      return requestedPath.replace(/\\/g, "/");
    }

    return null;
  }

  resolveOpenLinkSourcePath(): string {
    return this.focus.resolveOpenLinkSourcePath();
  }

  requestEditorFocus(path: string): void {
    this.primeNoteSignatureForPath(path);
    this.focus.onMarkdownFocus(path);
  }

  private trySendFocusForPath(
    pathValue: unknown,
    options?: { skipGraphCheck?: boolean }
  ): boolean {
    const path = this.normalizeVaultPath(pathValue);
    // TypeScript owns graph membership: ordinary focus is sent only for notes
    // that belong to the effective graph Unity is rendering now.
    // Rename bypasses this because the path-derived id can change before the
    // renamed graph payload reaches Unity.
    if (!this.bridgeReady ||
        !this.isGraphRelevantPath(path) ||
        (!options?.skipGraphCheck && !this.isPathInOutgoingGraph(path))) {
      return false;
    }

    this.sendFocus({
      id: makeStableNoteId(path),
      path
    });
    this.focusPath = path;
    return true;
  }

  private isPathInOutgoingGraph(path: string): boolean {
    if (!this.outgoingGraphPayload) {
      return false;
    }

    const noteId = makeStableNoteId(path);
    return this.outgoingGraphPayload.notes.some((note) => {
      const notePath = this.normalizeVaultPath(note.path);
      return notePath === path || note.id === noteId;
    });
  }

  expectFocusEchoForPath(path: string): void {
    this.focus.expectFocusEchoForPath(path);
  }

  recordRuntimeFocusPath(pathValue: unknown): void {
    const path = this.normalizeVaultPath(pathValue);
    if (this.isGraphRelevantPath(path)) {
      this.focusPath = path;
    }
  }

  clearExpectedFocusEchoForPath(path: string): void {
    this.focus.clearExpectedFocusEchoForPath(path);
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
          if (this.semanticRefreshPending) {
            this.semanticRefreshPending = false;
            this.startupRefreshPending = false;
            this.scheduleSourceGraphRebuild();
            return;
          }

          if (this.startupRefreshPending) {
            // Keep startup correction one-shot and unconditional: a late plugin enable can
            // spend it on the next resolved event, but avoiding that would require a graph
            // equality pass for a narrow edge case.
            this.startupRefreshPending = false;
            this.scheduleSourceGraphRebuild();
          }
        })
      );
    }

    if (vault?.on) {
      registerEvent(
        vault.on("create", (file: TAbstractFile) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          this.scheduleSourceGraphRebuild();
        })
      );
      registerEvent(
        vault.on("delete", (file: TAbstractFile) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          const normalizedPath = this.normalizeVaultPath(file.path);
          this.noteSignatureByPath.delete(normalizedPath);
          if (this.focusPath === normalizedPath) {
            this.focusPath = "";
          }
          this.scheduleSourceGraphRebuild();
        })
      );
      registerEvent(
        vault.on("rename", (file: TAbstractFile, oldPath: string) => {
          if (!this.isGraphRelevantPath(file?.path) && !this.isGraphRelevantPath(oldPath)) {
            return;
          }
          const normalizedOldPath = this.normalizeVaultPath(oldPath);
          this.focus.onRename(oldPath, file?.path);

          if (this.isGraphRelevantPath(oldPath)) {
            this.noteSignatureByPath.delete(normalizedOldPath);
          }
          this.scheduleSourceGraphRebuild();
        })
      );
    }
  }

  private markSemanticRefreshPending(): void {
    if (!this.isLive) {
      return;
    }

    this.semanticRefreshPending = true;
    this.sendStatus?.(METADATA_RESOLVE_STATUS);
  }

  private scheduleSourceGraphRebuild(): void {
    if (!this.isLive) {
      return;
    }
    this.clearRefreshTimer();
    const timerWindow = this.getTimerWindow();
    this.refreshTimerWindow = timerWindow;
    this.refreshTimer = timerWindow.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshTimerWindow = null;
      this.handleVaultGraphChanged();
    }, GRAPH_REFRESH_DEBOUNCE_MS);
  }

  private handleVaultGraphChanged(): void {
    this.rebuildSourceGraph();
    this.sendGraphFromSource();
  }

  private rebuildSourceGraph(): void {
    this.sourceGraphPayload = this.buildGraph(this.app);
    this.folderPathSuggestions = this.buildFolderPathSuggestions(this.sourceGraphPayload);
    this.tagSuggestions = this.buildTagSuggestions(this.sourceGraphPayload);
  }

  private scheduleFilterGraphUpdate(
    shouldSendGraph: boolean,
    nextActiveQueryFilter: ParsedQueryFilter | null
  ): void {
    if (!this.isLive) {
      // Before the live view starts, keep the filter ready for the first graph emission.
      if (shouldSendGraph) {
        this.activeQueryFilter = nextActiveQueryFilter;
      }
      this.notifyStateChanged();
      return;
    }

    this.clearFilterInputDebounceTimer();
    const timerWindow = this.getTimerWindow();
    this.filterInputDebounceTimerWindow = timerWindow;
    this.filterInputDebounceTimer = timerWindow.setTimeout(() => {
      this.filterInputDebounceTimer = null;
      this.filterInputDebounceTimerWindow = null;
      this.notifyStateChanged();
      if (shouldSendGraph) {
        // Apply the parsed candidate at the same moment the graph is rebuilt.
        this.activeQueryFilter = nextActiveQueryFilter;
        this.sendGraphFromSource();
      }
    }, FILTER_INPUT_DEBOUNCE_MS);
  }

  /**
   * Turn the cached source graph into the effective outgoing payload by applying filters and layout.
   * The source graph stays untouched here; only the transport-ready snapshot is produced and cached.
   */
  private sendGraphFromSource(): void {
    if (!this.sourceGraphPayload) {
      return;
    }

    this.outgoingGraphPayload = this.applyActiveFilters(this.sourceGraphPayload);

    if (this.bridgeReady) {
      this.sendGraph(this.outgoingGraphPayload);
    }
  }

  private applyActiveFilters(payload: GraphPayload): GraphPayload {
    const queryFiltered = GraphQueryFilter.applyFilter(payload, this.activeQueryFilter);
    const tagsFiltered = this.applyTagsVisibilityFilter(queryFiltered);
    return {
      ...tagsFiltered,
      mapLayout: this.mapLayout
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

  private primeNoteSignatureForPath(pathValue: unknown): void {
    const path = this.normalizeVaultPath(pathValue);
    // Editor focus can repeat for the same note; only the first focus primes
    // the baseline, and metadataCache.changed owns later signature updates.
    if (!this.isGraphRelevantPath(path) || this.noteSignatureByPath.has(path)) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file) ?? null;
    this.noteSignatureByPath.set(path, this.buildGraphRelevantSignature(cache));
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

  private applyParsedQueryResult(parseResult: QueryFilterParseResult): void {
    this.applyParsedQueryUiState(parseResult);
    if (parseResult.isValid) {
      this.activeQueryFilter = parseResult.hasSupportedTerms ? parseResult.parsed : null;
    }
  }

  private applyParsedQueryUiState(parseResult: QueryFilterParseResult): void {
    this.filterParseValid = parseResult.isValid;

    if (!parseResult.isValid) {
      this.filterMessage = "";
      return;
    }

    this.filterMessage = parseResult.hasUnsupportedTokens
      ? "Only path:, date:, and tag: terms are applied in this view."
      : "";
  }

  private resolveActiveQueryFilter(parseResult: QueryFilterParseResult): ParsedQueryFilter | null {
    if (!parseResult.isValid || !parseResult.hasSupportedTerms) {
      return null;
    }

    return parseResult.parsed;
  }

  private notifyStateChanged(options?: { persist?: boolean }): void {
    this.onStateChanged?.(this.getState(), options);
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

  private getTimerWindow(): Window {
    return window.activeWindow ?? window;
  }

  private clearRefreshTimer(): void {
    if (!this.refreshTimer) {
      return;
    }

    (this.refreshTimerWindow ?? this.getTimerWindow()).clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.refreshTimerWindow = null;
  }

  private clearFilterInputDebounceTimer(): void {
    if (!this.filterInputDebounceTimer) {
      return;
    }

    (this.filterInputDebounceTimerWindow ?? this.getTimerWindow()).clearTimeout(this.filterInputDebounceTimer);
    this.filterInputDebounceTimer = null;
    this.filterInputDebounceTimerWindow = null;
  }
}

export function normalizeRenderScale(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_RENDER_SCALE;
  }

  const rounded = Math.round(numericValue * 10) / 10;
  if (rounded < MIN_RENDER_SCALE || rounded > MAX_RENDER_SCALE) {
    return DEFAULT_RENDER_SCALE;
  }
  return rounded;
}
