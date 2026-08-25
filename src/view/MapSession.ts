import {
  TFile,
  type App,
  type CachedMetadata,
  type EventRef,
  type TAbstractFile
} from "obsidian";
import { createHash } from "node:crypto";
import type {
  MapLayoutPreference,
  GraphLink,
  GraphNoteNode,
  GraphPayload,
  NoteFocusPayload,
  NoteUpdatePayload,
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
import { extractActiveFilterTermValue } from "../graph/GraphQuerySyntax";
import { normalizeRuntimeBuildingName } from "../graph/GraphTextLimits";
import { makeStableNoteId } from "../graph/VaultGraphBuilder";
import { MapFocusController, type FocusRequestOptions } from "./MapFocusController";

const GRAPH_REFRESH_DEBOUNCE_MS = 250;
const GRAPH_SETTINGS_DEBOUNCE_MS = 250;
const FILTER_INPUT_DEBOUNCE_MS = 500;
const METADATA_RESOLVE_STATUS = "Updating graph data...";
const MAX_FOLDER_SUGGESTIONS = 80;
const MAX_TAG_SUGGESTIONS = 200;
export const DEFAULT_RENDER_SCALE = 1;
export const MIN_RENDER_SCALE = 0.5;
export const MAX_RENDER_SCALE = 1.5;
export const RENDER_SCALE_STEP = 0.1;
export const DEFAULT_EGO_ENABLED = false;
export const DEFAULT_EGO_DEPTH = 1;
export const MIN_EGO_DEPTH = 1;
export const MAX_EGO_DEPTH = 5;
export const DEFAULT_EGO_NEIGHBOR_LINKS_ENABLED = false;
export type MapViewState = {
  filterQuery?: unknown;
  showTags?: unknown;
  mapLayout?: unknown;
  renderScale?: unknown;
  frameRateMode?: unknown;
  egoEnabled?: unknown;
  egoDepth?: unknown;
  egoNeighborLinksEnabled?: unknown;
};

export type MapFilterUiState = {
  filterQuery: string;
  showTags: boolean;
  mapLayout: MapLayoutPreference;
  renderScale: number;
  renderScaleRestartRequired: boolean;
  frameRateMode: FrameRateMode;
  egoEnabled: boolean;
  egoDepth: number;
  egoNeighborLinksEnabled: boolean;
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

type EgoGraphScope = {
  payload: GraphPayload;
  distanceByNoteId: Map<string, number>;
};

type AcceptedFocus = {
  path: string;
  centerChanged: boolean;
};

type NoteMetadataSignature = {
  graph: string;
  landmarks: string;
};

export type MapSessionDependencies = {
  app: App;
  buildGraph: (app: App) => GraphPayload;
  now: () => number;
  sendGraph: (payload: GraphPayload) => void;
  sendStatus?: (message: string) => void;
  sendFocus: (payload: NoteFocusPayload) => void;
  sendNoteUpdate?: (payload: NoteUpdatePayload) => void;
  sendRuntimeSettings?: (payload: RuntimeSettingsPayload) => void;
  onStateChanged?: (state: Record<string, unknown>, options?: { persist?: boolean }) => void;
};

/**
 * Coordinates the non-DOM graph session state that must survive view re-renders:
 * graph refresh timing, persisted filters, and bridge-facing focus coordination.
 */
export class MapSession {
  private readonly app: App;
  private readonly focus: MapFocusController;
  private readonly buildGraph: (app: App) => GraphPayload;
  private readonly now: () => number;
  private readonly sendGraph: (payload: GraphPayload) => void;
  private readonly sendStatus?: (message: string) => void;
  private readonly sendFocus: (payload: NoteFocusPayload) => void;
  private readonly sendNoteUpdate: (payload: NoteUpdatePayload) => void;
  private readonly sendRuntimeSettings?: (payload: RuntimeSettingsPayload) => void;
  private readonly onStateChanged?: (state: Record<string, unknown>, options?: { persist?: boolean }) => void;

  private bridgeReady = false;
  private isLive = false;
  private refreshSubscriptionsRegistered = false;

  // Full vault graph snapshot used as the source for filters and suggestions.
  private sourceGraphPayload: GraphPayload | null = null;
  // Last effective graph snapshot prepared for Unity, focus checks, and note-open id resolution.
  private outgoingGraphPayload: GraphPayload | null = null;
  private noteMetadataSignatureByPath = new Map<string, NoteMetadataSignature>();

  private semanticRefreshPending = false;
  // Allows one metadataCache.resolved after startup to refresh cached vault graph data from settled links.
  private startupRefreshPending = false;

  // Plugin-side graph focus, updated from both TS focus dispatch and Unity note-open.
  private focusPath = "";
  // Tag selection can keep the Ego center while suspending visible note focus.
  private isEgoNoteFocusSuspended = false;

  private sourceRefreshTimer: number | null = null;
  private sourceRefreshTimerWindow: Window | null = null;
  private filterInputDebounceTimer: number | null = null;
  private filterInputDebounceTimerWindow: Window | null = null;
  private graphSettingsDebounceTimer: number | null = null;
  private graphSettingsDebounceTimerWindow: Window | null = null;

  private filterQuery = "";
  private showTags = true;
  private mapLayout: MapLayoutPreference = DEFAULT_MAP_LAYOUT_PREFERENCE;
  private renderScale = DEFAULT_RENDER_SCALE;
  private appliedRenderScale = DEFAULT_RENDER_SCALE;
  private frameRateMode: FrameRateMode = DEFAULT_FRAME_RATE_MODE;
  private egoEnabled = DEFAULT_EGO_ENABLED;
  private egoDepth = DEFAULT_EGO_DEPTH;
  private egoNeighborLinksEnabled = DEFAULT_EGO_NEIGHBOR_LINKS_ENABLED;

  // Parsed filter currently applied to the outgoing graph; live input commits it only after debounce.
  private activeQueryFilter: ParsedQueryFilter | null = null;
  private filterParseValid = true;
  private filterMessage = "";

  private folderPathSuggestions: FolderPathSuggestion[] = [];
  private tagSuggestions: TagSuggestion[] = [];

  constructor(deps: MapSessionDependencies) {
    this.app = deps.app;
    this.buildGraph = deps.buildGraph;
    this.now = deps.now;
    this.sendGraph = deps.sendGraph;
    this.sendStatus = deps.sendStatus;
    this.sendRuntimeSettings = deps.sendRuntimeSettings;
    this.sendNoteUpdate = deps.sendNoteUpdate ?? (() => undefined);
    this.onStateChanged = deps.onStateChanged;
    this.focus = new MapFocusController({
      app: this.app,
      now: this.now,
      requestFocus: (path, options) => this.handleEditorFocusRequest(path, options),
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
      frameRateMode: this.frameRateMode,
      egoEnabled: this.egoEnabled,
      egoDepth: this.egoDepth,
      egoNeighborLinksEnabled: this.egoNeighborLinksEnabled
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
    this.egoEnabled = typeof nextState.egoEnabled === "boolean"
      ? nextState.egoEnabled
      : DEFAULT_EGO_ENABLED;
    this.egoDepth = normalizeEgoDepth(nextState.egoDepth);
    this.egoNeighborLinksEnabled = typeof nextState.egoNeighborLinksEnabled === "boolean"
      ? nextState.egoNeighborLinksEnabled
      : DEFAULT_EGO_NEIGHBOR_LINKS_ENABLED;
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
    this.isEgoNoteFocusSuspended = false;
    this.clearSourceRefreshTimer();
    this.ensureRefreshSubscriptions(registerEvent);
  }

  stop(): void {
    this.isLive = false;
    this.clearSourceRefreshTimer();
    this.clearFilterInputDebounceTimer();
    this.clearGraphSettingsDebounceTimer();
    this.bridgeReady = false;
    this.sourceGraphPayload = null;
    this.folderPathSuggestions = [];
    this.tagSuggestions = [];
    this.focus.reset();
    this.semanticRefreshPending = false;
    this.startupRefreshPending = false;
    this.outgoingGraphPayload = null;
    this.focusPath = "";
    this.isEgoNoteFocusSuspended = false;
  }

  handleRuntimeReady(): void {
    this.bridgeReady = true;
    this.sendCurrentRuntimeSettings();
    const activeFilePath = this.getActiveFilePath();

    if (this.egoEnabled) {
      this.handleEgoRuntimeReady(activeFilePath);
    } else {
      this.handleGlobalRuntimeReady(activeFilePath);
    }

    this.startupRefreshPending = true;
  }

  private handleEgoRuntimeReady(activeFilePath: string): void {
    // Ego accepts focus first because the initial graph is scoped around it
    const acceptedStartupFocus = this.tryAcceptFocusPath(activeFilePath);

    this.prepareStartupGraph(acceptedStartupFocus?.centerChanged === true);
    this.sendOutgoingGraph();

    if (acceptedStartupFocus) {
      this.sendFocusForPath(acceptedStartupFocus.path);
    }
  }

  private handleGlobalRuntimeReady(activeFilePath: string): void {
    this.prepareStartupGraph(false);
    this.sendOutgoingGraph();

    // Global focus must be validated against the emitted graph
    const acceptedStartupFocus = this.tryAcceptFocusPath(activeFilePath);
    if (acceptedStartupFocus) {
      this.sendFocusForPath(acceptedStartupFocus.path);
    }
  }

  private prepareStartupGraph(forceRebuild: boolean): void {
    if (!forceRebuild && this.outgoingGraphPayload) {
      return;
    }

    if (!this.sourceGraphPayload) {
      this.rebuildSourceGraph();
    }
    this.rebuildOutgoingGraph();
  }

  handleRuntimeUnavailable(): void {
    this.bridgeReady = false;
    this.flushPendingGraphWork();
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
    this.scheduleGraphSettingsUpdate();
  }

  setMapLayoutPreference(mapLayout: unknown): void {
    this.mapLayout = normalizeMapLayoutPreference(mapLayout);
    this.notifyStateChanged();
    this.scheduleGraphSettingsUpdate();
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

  setEgoEnabled(egoEnabled: boolean): void {
    if (!egoEnabled && this.isEgoNoteFocusSuspended) {
      this.focusPath = "";
      this.isEgoNoteFocusSuspended = false;
    }
    this.egoEnabled = egoEnabled;
    this.notifyStateChanged();
    this.scheduleGraphSettingsUpdate();
  }

  setEgoDepth(egoDepth: unknown): void {
    this.egoDepth = normalizeEgoDepth(egoDepth);
    this.notifyStateChanged();
    if (this.egoEnabled) {
      this.scheduleGraphSettingsUpdate();
    }
  }

  setEgoNeighborLinksEnabled(egoNeighborLinksEnabled: boolean): void {
    this.egoNeighborLinksEnabled = egoNeighborLinksEnabled;
    this.notifyStateChanged();
    if (this.egoEnabled) {
      this.scheduleGraphSettingsUpdate();
    }
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
      egoEnabled: this.egoEnabled,
      egoDepth: this.egoDepth,
      egoNeighborLinksEnabled: this.egoNeighborLinksEnabled,
      filterParseValid: this.filterParseValid,
      filterMessage: this.filterMessage
    };
  }

  getFolderSuggestions(query: string): FolderPathSuggestion[] {
    this.ensureFolderSuggestionsReady();
    const activePathValue = extractActiveFilterTermValue(query, "path");
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
    const activeTagValue = extractActiveFilterTermValue(query, "tag");
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

  private getActiveFilePath(): string {
    const activeFile = this.app.workspace.getActiveFile?.() ?? null;
    return activeFile instanceof TFile ? this.normalizeVaultPath(activeFile.path) : "";
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

  requestFocusFromEditor(path: string): void {
    this.primeNoteSignatureForPath(path);
    this.focus.onMarkdownFocus(path);
  }

  private handleEditorFocusRequest(pathValue: unknown, options?: FocusRequestOptions): boolean {
    if (!this.bridgeReady) {
      return false;
    }

    const skipGraphCheck = options?.skipGraphCheck === true;
    const acceptedFocus = this.tryAcceptFocusPath(pathValue, skipGraphCheck);
    if (!acceptedFocus) {
      return false;
    }

    // Rename focus intentionally skips this rebuild: the vault rename event
    // schedules a fresh source graph rebuild, while the current source graph
    // can still contain the old path.
    if (this.egoEnabled && acceptedFocus.centerChanged && !options?.skipEgoGraphRebuild) {
      if (!this.sourceGraphPayload) {
        this.rebuildSourceGraph();
      }
      this.rebuildOutgoingGraph();
      this.sendOutgoingGraph();
    }

    this.sendFocusForPath(acceptedFocus.path);
    return true;
  }

  private tryAcceptFocusPath(pathValue: unknown, skipGraphCheck = false): AcceptedFocus | null {
    const path = this.normalizeVaultPath(pathValue);
    if (!this.isGraphRelevantPath(path)) {
      return null;
    }

    if (!this.egoEnabled) {
      // Global focus may only target a note Unity is already rendering.
      // Rename is the exception because the path-derived id can change before the renamed graph arrives.
      if (!skipGraphCheck && !this.isPathInOutgoingGraph(path)) {
        return null;
      }
    }

    const centerChanged = this.focusPath !== path;
    this.focusPath = path;
    this.isEgoNoteFocusSuspended = false;
    return {
      path,
      centerChanged
    };
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

  handleRuntimeFocusChange(pathValue: unknown): void {
    const acceptedFocus = this.tryAcceptFocusPath(pathValue, true);
    if (
      this.egoEnabled &&
      acceptedFocus?.centerChanged
    ) {
      // Ego graph rebuild changes the rendered neighborhood; re-send focus so Unity restores the new center.
      this.rebuildOutgoingGraph();
      this.sendOutgoingGraph();
      this.sendFocusForPath(acceptedFocus.path);
    }
  }

  handleRuntimeTagActivate(): void {
    if (this.egoEnabled) {
      // Tag selection is transient in Ego mode; the note center still owns graph scope continuity.
      this.isEgoNoteFocusSuspended = this.isGraphRelevantPath(this.focusPath);
    }
    else {
      // Global tag selection is a real move away from note focus.
      this.focusPath = "";
      this.isEgoNoteFocusSuspended = false;
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
          const nextSignature = this.buildNoteMetadataSignature(cache);
          const previousSignature = this.noteMetadataSignatureByPath.get(path) ?? null;
          this.noteMetadataSignatureByPath.set(path, nextSignature);
          if (!previousSignature) {
            this.markSemanticRefreshPending();
            return;
          }

          if (nextSignature.graph !== previousSignature.graph) {
            this.markSemanticRefreshPending();
            return;
          }

          if (nextSignature.landmarks !== previousSignature.landmarks) {
            const buildings = this.extractFrontmatterLandmarks(cache?.frontmatter);
            this.updateCachedNoteBuildings(path, buildings);
            this.sendNoteUpdateForPath(path, buildings);
          }
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
            // Treat the first post-startup resolved event as possible vault metadata settling.
            // This is unconditional and one-shot; distinguishing it from an irrelevant text edit
            // would require comparing rebuilt graph payloads for a narrow startup edge case.
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
          this.noteMetadataSignatureByPath.delete(normalizedPath);
          if (this.focusPath === normalizedPath) {
            this.focusPath = "";
            this.isEgoNoteFocusSuspended = false;
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
            this.noteMetadataSignatureByPath.delete(normalizedOldPath);
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
    this.clearSourceRefreshTimer();
    const timerWindow = this.getTimerWindow();
    this.sourceRefreshTimerWindow = timerWindow;
    this.sourceRefreshTimer = timerWindow.setTimeout(() => {
      this.sourceRefreshTimer = null;
      this.sourceRefreshTimerWindow = null;
      this.handleVaultGraphChanged();
    }, GRAPH_REFRESH_DEBOUNCE_MS);
  }

  private handleVaultGraphChanged(): void {
    this.rebuildSourceGraph();
    this.rebuildOutgoingGraph();
    this.sendOutgoingGraph();
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
        this.rebuildOutgoingGraph();
        this.sendOutgoingGraph();
      }
    }, FILTER_INPUT_DEBOUNCE_MS);
  }

  private scheduleGraphSettingsUpdate(): void {
    if (!this.isLive) {
      return;
    }

    this.clearGraphSettingsDebounceTimer();
    const timerWindow = this.getTimerWindow();
    this.graphSettingsDebounceTimerWindow = timerWindow;
    this.graphSettingsDebounceTimer = timerWindow.setTimeout(() => {
      this.graphSettingsDebounceTimer = null;
      this.graphSettingsDebounceTimerWindow = null;
      this.rebuildOutgoingGraph();
      this.sendOutgoingGraph();
    }, GRAPH_SETTINGS_DEBOUNCE_MS);
  }

  private flushPendingGraphWork(): void {
    let shouldInvalidateOutgoingGraph = false;

    if (this.sourceRefreshTimer) {
      this.clearSourceRefreshTimer();
      this.rebuildSourceGraph();
      shouldInvalidateOutgoingGraph = true;
    }

    if (this.filterInputDebounceTimer) {
      this.clearFilterInputDebounceTimer();
      this.notifyStateChanged();

      const parseResult = GraphQueryFilter.parseQuery(this.filterQuery);
      const nextActiveQueryFilter = this.resolveActiveQueryFilter(parseResult);
      if (
        parseResult.isValid &&
        !areQueryFiltersEqual(this.activeQueryFilter, nextActiveQueryFilter)
      ) {
        this.activeQueryFilter = nextActiveQueryFilter;
        shouldInvalidateOutgoingGraph = true;
      }
    }

    if (this.graphSettingsDebounceTimer) {
      this.clearGraphSettingsDebounceTimer();
      shouldInvalidateOutgoingGraph = true;
    }

    if (shouldInvalidateOutgoingGraph) {
      this.outgoingGraphPayload = null;
    }
  }

  /**
   * Turn the cached source graph into the effective outgoing payload by applying filters and layout.
   * The source graph stays untouched here; only the transport-ready snapshot is produced and cached.
   */
  private rebuildOutgoingGraph(): void {
    if (!this.sourceGraphPayload) {
      return;
    }

    this.outgoingGraphPayload = this.applyActiveFilters(this.sourceGraphPayload);
  }

  private sendFocusForPath(path: string): void {
    if (!this.bridgeReady) {
      return;
    }

    this.sendFocus({
      id: makeStableNoteId(path),
      path
    });
  }

  private updateCachedNoteBuildings(path: string, buildings: string[]): void {
    this.updateGraphPayloadNoteBuildings(this.sourceGraphPayload, path, buildings);
    this.updateGraphPayloadNoteBuildings(this.outgoingGraphPayload, path, buildings);
  }

  private updateGraphPayloadNoteBuildings(
    payload: GraphPayload | null,
    path: string,
    buildings: string[]
  ): void {
    if (!payload) {
      return;
    }

    const normalizedPath = this.normalizeVaultPath(path);
    const note = payload.notes.find((candidate) => (
      this.normalizeVaultPath(candidate.path) === normalizedPath
    ));
    if (!note) {
      return;
    }

    if (buildings.length > 0) {
      note.buildings = [...buildings];
    } else {
      delete note.buildings;
    }
  }

  private sendNoteUpdateForPath(path: string, buildings: string[]): void {
    if (!this.bridgeReady) {
      return;
    }

    this.sendNoteUpdate({
      id: makeStableNoteId(path),
      path,
      buildings
    });
  }

  private sendOutgoingGraph(): void {
    if (!this.bridgeReady || !this.outgoingGraphPayload) {
      return;
    }

    this.sendGraph(this.outgoingGraphPayload);
    if (this.egoEnabled && this.isEgoNoteFocusSuspended) {
      this.restoreEgoFocus();
    }
  }

  private restoreEgoFocus(): void {
    this.isEgoNoteFocusSuspended = false;
    const centerPath = this.normalizeVaultPath(this.focusPath);
    if (!centerPath) {
      return;
    }

    this.sendFocusForPath(centerPath);
  }

  private applyActiveFilters(payload: GraphPayload): GraphPayload {
    const centerNoteId = this.egoEnabled ? this.getCurrentEgoCenterNoteId() : undefined;

    const queryFiltered = GraphQueryFilter.applyFilter(
      payload,
      this.activeQueryFilter,
      { alwaysIncludeNoteId: centerNoteId }
    );

    const egoScope: EgoGraphScope = this.egoEnabled
      ? this.buildEgoGraphScope(queryFiltered)
      : { payload: queryFiltered, distanceByNoteId: new Map() };

    const tagsFiltered = this.applyTagsVisibilityFilter(
      egoScope.payload,
      egoScope.distanceByNoteId
    );

    return {
      ...tagsFiltered,
      mapLayout: this.mapLayout
    };
  }

  private getCurrentEgoCenterNoteId(): string | undefined {
    const centerPath = this.normalizeVaultPath(this.focusPath);
    return this.isGraphRelevantPath(centerPath) ? makeStableNoteId(centerPath) : undefined;
  }

  private buildEgoGraphScope(payload: GraphPayload): EgoGraphScope {
    const centerPath = this.normalizeVaultPath(this.focusPath);
    if (!this.isGraphRelevantPath(centerPath)) {
      return {
        payload: this.toGraphSubset(payload, new Set(), []),
        distanceByNoteId: new Map()
      };
    }

    const noteById = new Map<string, GraphNoteNode>();
    const noteIdByPath = new Map<string, string>();
    for (const note of payload.notes) {
      const normalizedPath = this.normalizeVaultPath(note.path);
      noteById.set(note.id, note);
      noteIdByPath.set(normalizedPath, note.id);
    }

    const centerId = noteIdByPath.get(centerPath);
    if (!centerId) {
      return {
        payload: this.toGraphSubset(payload, new Set(), []),
        distanceByNoteId: new Map()
      };
    }

    const adjacentNoteIds = new Map<string, Set<string>>();
    for (const link of payload.links) {
      if (!noteById.has(link.sourceId) || !noteById.has(link.targetId)) {
        continue;
      }

      let sourceNeighbors = adjacentNoteIds.get(link.sourceId);
      if (!sourceNeighbors) {
        sourceNeighbors = new Set();
        adjacentNoteIds.set(link.sourceId, sourceNeighbors);
      }
      sourceNeighbors.add(link.targetId);

      let targetNeighbors = adjacentNoteIds.get(link.targetId);
      if (!targetNeighbors) {
        targetNeighbors = new Set();
        adjacentNoteIds.set(link.targetId, targetNeighbors);
      }
      targetNeighbors.add(link.sourceId);
    }

    const distanceByNoteId = new Map<string, number>([[centerId, 0]]);
    const queue = [centerId];
    for (let index = 0; index < queue.length; index++) {
      const currentId = queue[index];
      const currentDistance = distanceByNoteId.get(currentId) ?? 0;
      if (currentDistance >= this.egoDepth) {
        continue;
      }

      for (const neighborId of adjacentNoteIds.get(currentId) ?? []) {
        if (distanceByNoteId.has(neighborId)) {
          continue;
        }

        distanceByNoteId.set(neighborId, currentDistance + 1);
        queue.push(neighborId);
      }
    }

    const includedIds = new Set(distanceByNoteId.keys());

    const links = payload.links.filter((link) => {
      if (!includedIds.has(link.sourceId) || !includedIds.has(link.targetId)) {
        return false;
      }
      if (this.egoNeighborLinksEnabled) {
        return true;
      }
      const sourceDistance = distanceByNoteId.get(link.sourceId);
      const targetDistance = distanceByNoteId.get(link.targetId);
      return (
        typeof sourceDistance === "number" &&
        typeof targetDistance === "number" &&
        Math.min(sourceDistance, targetDistance) < this.egoDepth &&
        sourceDistance !== targetDistance
      );
    });

    return {
      payload: this.toGraphSubset(payload, includedIds, links),
      distanceByNoteId
    };
  }

  private toGraphSubset(payload: GraphPayload, includedIds: Set<string>, links: GraphLink[]): GraphPayload {
    const notes = payload.notes.filter((note) => includedIds.has(note.id));
    return {
      ...payload,
      vault: {
        ...payload.vault,
        noteCount: notes.length
      },
      notes,
      links
    };
  }

  private applyTagsVisibilityFilter(
    payload: GraphPayload,
    distanceByNoteId: Map<string, number>
  ): GraphPayload {
    if (!this.showTags) {
      return this.withoutTags(payload);
    }

    const isEgoScope = distanceByNoteId.size > 0;
    if (!isEgoScope) {
      return payload;
    }

    if (this.egoNeighborLinksEnabled) {
      return this.applyEgoNeighborTagVisibility(payload, distanceByNoteId);
    }

    return this.applyEgoOwnerTagVisibility(payload, distanceByNoteId);
  }

  private withoutTags(payload: GraphPayload): GraphPayload {
    return {
      ...payload,
      notes: payload.notes.map((note) => ({
        ...note,
        tags: []
      }))
    };
  }

  private applyEgoNeighborTagVisibility(
    payload: GraphPayload,
    distanceByNoteId: Map<string, number>
  ): GraphPayload {
    const visibleInnerTags = this.buildVisibleInnerTagSet(payload, distanceByNoteId);
    return {
      ...payload,
      notes: payload.notes.map((note) => ({
        ...note,
        tags: this.getVisibleEgoNoteTags(note, distanceByNoteId, visibleInnerTags)
      }))
    };
  }

  private buildVisibleInnerTagSet(
    payload: GraphPayload,
    distanceByNoteId: Map<string, number>
  ): Set<string> {
    const visibleTags = new Set<string>();
    for (const note of payload.notes) {
      const distance = distanceByNoteId.get(note.id);
      if (typeof distance !== "number" || distance >= this.egoDepth) {
        continue;
      }

      for (const tag of note.tags) {
        visibleTags.add(this.normalizeEgoTagKey(tag));
      }
    }
    return visibleTags;
  }

  private getVisibleEgoNoteTags(
    note: GraphNoteNode,
    distanceByNoteId: Map<string, number>,
    visibleInnerTags: Set<string>
  ): string[] {
    const distance = distanceByNoteId.get(note.id);
    if (typeof distance !== "number") {
      return [];
    }

    if (distance < this.egoDepth) {
      return note.tags;
    }

    return note.tags.filter((tag) => visibleInnerTags.has(this.normalizeEgoTagKey(tag)));
  }

  private applyEgoOwnerTagVisibility(
    payload: GraphPayload,
    distanceByNoteId: Map<string, number>
  ): GraphPayload {
    const ownerTagKeysByNoteId = this.buildEgoTagOwners(payload, distanceByNoteId);
    return {
      ...payload,
      notes: payload.notes.map((note) => {
        const ownerTagKeys = ownerTagKeysByNoteId.get(note.id) ?? new Set<string>();
        return {
          ...note,
          tags: note.tags.filter((tag) => ownerTagKeys.has(this.normalizeEgoTagKey(tag)))
        };
      })
    };
  }

  private buildEgoTagOwners(
    payload: GraphPayload,
    distanceByNoteId: Map<string, number>
  ): Map<string, Set<string>> {
    const firstVisibleDepthByTagKey = new Map<string, number>();
    for (const note of payload.notes) {
      const distance = distanceByNoteId.get(note.id);
      if (typeof distance !== "number" || distance >= this.egoDepth) {
        continue;
      }

      for (const tag of note.tags) {
        const tagKey = this.normalizeEgoTagKey(tag);
        const firstVisibleDepth = firstVisibleDepthByTagKey.get(tagKey);
        if (firstVisibleDepth === undefined || distance < firstVisibleDepth) {
          firstVisibleDepthByTagKey.set(tagKey, distance);
        }
      }
    }

    const ownerTagKeysByNoteId = new Map<string, Set<string>>();
    for (const note of payload.notes) {
      const distance = distanceByNoteId.get(note.id);
      if (typeof distance !== "number" || distance >= this.egoDepth) {
        continue;
      }

      const ownerTagKeys = note.tags
        .map((tag) => this.normalizeEgoTagKey(tag))
        .filter((tagKey) => firstVisibleDepthByTagKey.get(tagKey) === distance);
      if (ownerTagKeys.length > 0) {
        ownerTagKeysByNoteId.set(note.id, new Set(ownerTagKeys));
      }
    }

    return ownerTagKeysByNoteId;
  }

  private normalizeEgoTagKey(tag: string): string {
    return tag.trim().toLowerCase();
  }

  private buildNoteMetadataSignature(cache: CachedMetadata | null): NoteMetadataSignature {
    return {
      graph: this.buildGraphRelevantSignature(cache),
      landmarks: this.buildLandmarksSignature(cache?.frontmatter)
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
    return this.hashSignature(JSON.stringify({
      tags,
      links
    }));
  }

  private buildLandmarksSignature(frontmatter: unknown): string {
    return this.hashSignature(JSON.stringify(this.extractFrontmatterLandmarks(frontmatter)));
  }

  private hashSignature(value: string): string {
    return createHash("sha256").update(value).digest().subarray(0, 4).toString("base64url");
  }

  private primeNoteSignatureForPath(pathValue: unknown): void {
    const path = this.normalizeVaultPath(pathValue);
    // Editor focus can repeat for the same note; only the first focus primes
    // the baseline, and metadataCache.changed owns later signature updates.
    if (!this.isGraphRelevantPath(path) || this.noteMetadataSignatureByPath.has(path)) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file) ?? null;
    this.noteMetadataSignatureByPath.set(path, this.buildNoteMetadataSignature(cache));
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

  private extractFrontmatterLandmarks(frontmatter: unknown): string[] {
    if (!frontmatter || typeof frontmatter !== "object") {
      return [];
    }

    const landmarksRaw = (frontmatter as { landmarks?: unknown }).landmarks;
    if (!Array.isArray(landmarksRaw)) {
      return [];
    }

    return landmarksRaw
      .filter((landmark): landmark is string => typeof landmark === "string")
      .map((landmark) => normalizeRuntimeBuildingName(landmark))
      .filter((landmark) => landmark.length > 0);
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

  private clearSourceRefreshTimer(): void {
    if (!this.sourceRefreshTimer) {
      return;
    }

    (this.sourceRefreshTimerWindow ?? this.getTimerWindow()).clearTimeout(this.sourceRefreshTimer);
    this.sourceRefreshTimer = null;
    this.sourceRefreshTimerWindow = null;
  }

  private clearFilterInputDebounceTimer(): void {
    if (!this.filterInputDebounceTimer) {
      return;
    }

    (this.filterInputDebounceTimerWindow ?? this.getTimerWindow()).clearTimeout(this.filterInputDebounceTimer);
    this.filterInputDebounceTimer = null;
    this.filterInputDebounceTimerWindow = null;
  }

  private clearGraphSettingsDebounceTimer(): void {
    if (!this.graphSettingsDebounceTimer) {
      return;
    }

    (this.graphSettingsDebounceTimerWindow ?? this.getTimerWindow()).clearTimeout(this.graphSettingsDebounceTimer);
    this.graphSettingsDebounceTimer = null;
    this.graphSettingsDebounceTimerWindow = null;
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

export function normalizeEgoDepth(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return DEFAULT_EGO_DEPTH;
  }

  if (
    !Number.isInteger(numericValue) ||
    numericValue < MIN_EGO_DEPTH ||
    numericValue > MAX_EGO_DEPTH
  ) {
    return DEFAULT_EGO_DEPTH;
  }
  return numericValue;
}
