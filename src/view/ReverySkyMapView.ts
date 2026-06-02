import { ItemView, Notice, SearchComponent, WorkspaceLeaf, setIcon } from "obsidian";
import type { App, CachedMetadata, TAbstractFile, TFile } from "obsidian";
import type {
  GraphEnginePreference,
  GraphPayload,
  NoteFocusPayload,
  NoteOpenPayload
} from "../bridge/BridgeTypes";
import { UnityIframeBridge } from "../bridge/UnityIframeBridge";
import { VaultGraphBuilder } from "../graph/VaultGraphBuilder";
import {
  GraphPathFilter,
  type ParsedPathFilter,
  type PathFilterParseResult
} from "../graph/GraphPathFilter";
import type ReverySkyMapPlugin from "../main";

export const REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";
const GRAPH_REFRESH_DEBOUNCE_MS = 250;
const GRAPH_RESOLVE_BARRIER_FALLBACK_MS = 700;
const FILTER_INPUT_DEBOUNCE_MS = 250;
const FILTER_SUGGESTIONS_HIDE_DELAY_MS = 120;
const MAX_FOLDER_SUGGESTIONS = 80;
const MAX_TAG_SUGGESTIONS = 200;
const DEFAULT_ENGINE_PREFERENCE: GraphEnginePreference = "auto";
const ENGINE_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: GraphEnginePreference;
  label: string;
}> = [
  {
    value: "auto",
    label: "Auto"
  },
  {
    value: "forces",
    label: "Map of links (<200 notes)"
  },
  {
    value: "static25d",
    label: "Map of dates"
  }
] as const;

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "sendGraphSet" | "sendNoteFocus">;
type ObsidianHTMLElement = HTMLElement & {
  empty?: () => void;
  createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

type ReverySkyMapViewState = {
  pathFilterQuery?: unknown;
  showTags?: unknown;
  enginePreference?: unknown;
};

type FolderPathSuggestion = {
  path: string;
  normalizedPath: string;
  count: number;
  depth: number;
};

type DateFilterPresetSuggestion = {
  label: string;
  suffix: string;
  description: string;
};

type TagSuggestion = {
  tag: string;
  normalizedTag: string;
  displayTag: string;
};

type FilterSuggestionMode = 0 | 1 | 2 | 3;

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
  private filterSuggestionsHideTimer: ReturnType<typeof setTimeout> | null = null;
  private filterMessageEl: HTMLElement | null = null;
  private filterSuggestionsEl: HTMLElement | null = null;
  private filterPanelEl: HTMLElement | null = null;
  private filterToggleButtonEl: HTMLButtonElement | null = null;
  private tagsToggleButtonEl: HTMLButtonElement | null = null;
  private engineDropdownEl: HTMLSelectElement | null = null;
  private filterSuggestionMode: FilterSuggestionMode = 0;
  private folderPathSuggestions: FolderPathSuggestion[] = [];
  private tagSuggestions: TagSuggestion[] = [];
  private searchComponent: SearchComponent | null = null;
  private filterPanelOpen = false;

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

  getState(): Record<string, unknown> {
    return {
      pathFilterQuery: this.pathFilterQuery,
      showTags: this.showTags,
      enginePreference: this.enginePreference
    };
  }

  async setState(state: unknown): Promise<void> {
    const nextState = (state ?? {}) as ReverySkyMapViewState;
    const nextQuery =
      typeof nextState.pathFilterQuery === "string" ? nextState.pathFilterQuery : "";
    const nextShowTags = typeof nextState.showTags === "boolean" ? nextState.showTags : true;
    const nextEnginePreference = this.normalizeEnginePreference(nextState.enginePreference);
    this.pathFilterQuery = nextQuery;
    this.setShowTags(nextShowTags, { emit: false });
    this.setEnginePreference(nextEnginePreference, { emit: false });
    this.applyParsedFilterResult(GraphPathFilter.parsePathQuery(nextQuery));
    this.syncSearchComponentValue();
    this.refreshFilterMessage();
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
    const iframeHost = this.renderViewLayout(container);
    this.syncSearchComponentValue();
    this.refreshFilterMessage();

    let iframeSrc: string;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }

    const iframe = createChild(iframeHost, "iframe");
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
    this.clearFilterInputDebounceTimer();
    this.clearFilterSuggestionsHideTimer();
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
    this.bridge.detach();
    this.lastGraphPayload = null;
    this.searchComponent = null;
    this.filterMessageEl = null;
    this.filterSuggestionsEl = null;
    this.filterPanelEl = null;
    this.filterToggleButtonEl = null;
    this.tagsToggleButtonEl = null;
    this.engineDropdownEl = null;
    this.filterSuggestionMode = 0;
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
      this.pendingGraphPayload = outgoingPayload;
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(outgoingPayload);
      return;
    }

    this.pendingGraphPayload = null;
    this.bridge.sendGraphSet(outgoingPayload);
    this.dispatchPreferredFocus(outgoingPayload);
    this.refreshFilterSuggestions();
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

    if (this.sourceGraphPayload) {
      this.emitGraphFromSource();
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

  private clearFilterInputDebounceTimer(): void {
    if (!this.filterInputDebounceTimer) {
      return;
    }

    clearTimeout(this.filterInputDebounceTimer);
    this.filterInputDebounceTimer = null;
  }

  private clearFilterSuggestionsHideTimer(): void {
    if (!this.filterSuggestionsHideTimer) {
      return;
    }

    clearTimeout(this.filterSuggestionsHideTimer);
    this.filterSuggestionsHideTimer = null;
  }

  private renderViewLayout(container: ObsidianHTMLElement): ObsidianHTMLElement {
    const root = createChild(container, "div") as ObsidianHTMLElement;
    root.className = "reverysky-map-root";

    const iframeHost = createChild(root, "div") as ObsidianHTMLElement;
    iframeHost.className = "reverysky-map-iframe-host";

    const overlayControls = createChild(root, "div");
    overlayControls.className = "reverysky-map-overlay-controls";

    const settingsToggleButton = createChild(overlayControls as ObsidianHTMLElement, "button");
    settingsToggleButton.type = "button";
    settingsToggleButton.className = "reverysky-map-filter-toggle";
    this.filterToggleButtonEl = settingsToggleButton;
    settingsToggleButton.setAttribute("aria-label", "Open filters");
    setIcon(settingsToggleButton, "settings");
    const toggleFilterPanel = () => {
      const nextOpen = !this.filterPanelOpen;
      this.setFilterPanelOpen(nextOpen);
      if (nextOpen) {
        this.syncSearchComponentValue();
        this.refreshFilterMessage();
      }
    };
    settingsToggleButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleFilterPanel();
    });
    settingsToggleButton.addEventListener("click", (event) => {
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.detail !== 0) {
        return;
      }
      event.preventDefault();
      toggleFilterPanel();
    });

    const filterContainer = createChild(root, "div");
    filterContainer.className = "reverysky-map-filter-panel";
    this.filterPanelEl = filterContainer;

    const filterSection = createChild(filterContainer as ObsidianHTMLElement, "div");
    filterSection.className = "reverysky-map-filter-section";

    const filterSectionHeader = createChild(filterSection as ObsidianHTMLElement, "div");
    filterSectionHeader.className = "reverysky-map-filter-header";

    const filterSectionTitle = createChild(filterSectionHeader as ObsidianHTMLElement, "div");
    filterSectionTitle.className = "reverysky-map-filter-title";
    filterSectionTitle.textContent = "Settings";

    const panelCloseButton = createChild(filterSectionHeader as ObsidianHTMLElement, "button");
    panelCloseButton.type = "button";
    panelCloseButton.className = "reverysky-map-filter-close";
    panelCloseButton.setAttribute("aria-label", "Close filters");
    setIcon(panelCloseButton, "x");
    const closeFilterPanel = (event?: Event) => {
      event?.preventDefault();
      this.setFilterPanelOpen(false);
    };
    panelCloseButton.addEventListener("mousedown", (event) => {
      closeFilterPanel(event);
    });
    panelCloseButton.addEventListener("click", (event) => {
      closeFilterPanel(event);
    });

    const filterSearchArea = createChild(filterSection as ObsidianHTMLElement, "div");
    filterSearchArea.className = "reverysky-map-filter-search-area";

    const filterSearchLabel = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    filterSearchLabel.className = "reverysky-map-filter-field-label";
    filterSearchLabel.textContent = "Filter";

    const searchHost = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    this.searchComponent = new SearchComponent(searchHost);
    this.searchComponent.setPlaceholder("Search in...");
    this.searchComponent.onChange((value) => {
      this.onPathFilterInputChanged(value);
    });
    this.searchComponent.inputEl.setAttribute("aria-label", "Search in filter");
    this.searchComponent.inputEl.addEventListener("focus", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.searchComponent.inputEl.addEventListener("click", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.searchComponent.inputEl.addEventListener("blur", () => {
      this.scheduleHideFilterSuggestions();
    });
    this.searchComponent.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (this.searchComponent) {
          this.searchComponent.setValue("");
        }
        this.onPathFilterInputChanged("");
        this.hideFilterSuggestions();
      }
    });

    this.filterSuggestionsEl = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    this.filterSuggestionsEl.className = "reverysky-map-filter-suggestions";
    this.filterSuggestionsEl.style.display = "none";

    this.filterMessageEl = createChild(filterSection as ObsidianHTMLElement, "div");
    this.filterMessageEl.className = "reverysky-map-filter-message";

    const tagsToggleRow = createChild(filterSection as ObsidianHTMLElement, "div");
    tagsToggleRow.className = "reverysky-map-tags-toggle-row";

    const tagsLabel = createChild(tagsToggleRow as ObsidianHTMLElement, "div");
    tagsLabel.className = "reverysky-map-filter-field-label";
    tagsLabel.textContent = "Tags";

    const tagsToggleButton = createChild(tagsToggleRow as ObsidianHTMLElement, "button");
    tagsToggleButton.type = "button";
    tagsToggleButton.className = "reverysky-map-tags-toggle";
    tagsToggleButton.setAttribute("aria-label", "Toggle tags");
    this.tagsToggleButtonEl = tagsToggleButton;

    const tagsToggleThumb = createChild(tagsToggleButton as ObsidianHTMLElement, "span");
    tagsToggleThumb.className = "reverysky-map-tags-toggle-thumb";

    const toggleTags = (event: Event) => {
      event.preventDefault();
      this.setShowTags(!this.showTags, { emit: true });
    };
    tagsToggleButton.addEventListener("mousedown", toggleTags);
    tagsToggleButton.addEventListener("click", (event) => {
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.detail !== 0) {
        return;
      }
      toggleTags(event);
    });
    this.refreshTagsToggleUi();

    const engineSection = createChild(filterContainer as ObsidianHTMLElement, "div");
    engineSection.className = "reverysky-map-filter-section reverysky-map-filter-control-group";

    const engineSectionTitle = createChild(engineSection as ObsidianHTMLElement, "div");
    engineSectionTitle.className = "reverysky-map-filter-field-label";
    engineSectionTitle.textContent = "Engine";

    const engineSelectHost = createChild(engineSection as ObsidianHTMLElement, "div");
    engineSelectHost.className = "reverysky-map-engine-select-host";
    const engineDropdown = createChild(engineSelectHost as ObsidianHTMLElement, "select");
    this.engineDropdownEl = engineDropdown;
    for (const option of ENGINE_PREFERENCE_OPTIONS) {
      const optionEl = createChild(engineDropdown as ObsidianHTMLElement, "option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
    }
    engineDropdown.classList.add("reverysky-map-engine-select");
    engineDropdown.setAttribute("aria-label", "Select engine");
    engineDropdown.addEventListener("change", () => {
      this.setEnginePreference(this.normalizeEnginePreference(engineDropdown.value), { emit: true });
    });
    this.refreshEngineDropdownUi();
    this.setFilterPanelOpen(false);

    return iframeHost;
  }

  private setFilterPanelOpen(isOpen: boolean): void {
    this.filterPanelOpen = isOpen;
    if (!this.filterPanelEl || !this.filterToggleButtonEl) {
      return;
    }

    this.filterPanelEl.style.display = isOpen ? "grid" : "none";
    this.filterPanelEl.style.pointerEvents = isOpen ? "auto" : "none";
    this.filterToggleButtonEl.style.display = isOpen ? "none" : "inline-flex";
    this.filterToggleButtonEl.style.pointerEvents = isOpen ? "none" : "auto";
    if (!isOpen) {
      this.hideFilterSuggestions();
    }
  }

  private onPathFilterInputChanged(nextQuery: string): void {
    this.pathFilterQuery = typeof nextQuery === "string" ? nextQuery : "";
    const parseResult = GraphPathFilter.parsePathQuery(this.pathFilterQuery);
    this.applyParsedFilterResult(parseResult);
    this.refreshFilterMessage();
    this.refreshFilterSuggestions();

    if (!parseResult.isValid) {
      return;
    }

    this.scheduleFilterRefresh();
  }

  private showFilterSuggestions(mode: FilterSuggestionMode): void {
    if (!this.filterSuggestionsEl || !this.searchComponent) {
      return;
    }

    this.filterSuggestionMode = mode;
    this.setFilterPanelOpen(true);
    this.refreshFilterSuggestions();
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsEl.style.display = "block";
  }

  private resolveAutoSuggestionMode(): FilterSuggestionMode {
    const currentQuery = this.searchComponent?.inputEl?.value ?? this.searchComponent?.getValue() ?? this.pathFilterQuery;
    if (/\s$/.test(currentQuery)) {
      return 0;
    }
    if (/(^|\s)-?path:(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 1;
    }
    if (/(^|\s)-?date:[^\s]*$/i.test(currentQuery)) {
      return 2;
    }
    if (/(^|\s)-?tag:(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 3;
    }
    return 0;
  }

  private scheduleHideFilterSuggestions(): void {
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsHideTimer = setTimeout(() => {
      this.filterSuggestionsHideTimer = null;
      this.hideFilterSuggestions();
    }, FILTER_SUGGESTIONS_HIDE_DELAY_MS);
  }

  private hideFilterSuggestions(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    this.filterSuggestionMode = 0;
    this.filterSuggestionsEl.style.display = "none";
  }

  private applyPathSuggestionOperator(): void {
    if (!this.searchComponent) {
      return;
    }

    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsPathOperator = /(^|\s)-?path:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsPathOperator
      ? currentValue
      : trimmedCurrent.length === 0
        ? "path:"
        : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}path:`;

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(1);
  }

  private applyDateSuggestionOperator(): void {
    if (!this.searchComponent) {
      return;
    }

    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsDateOperator = /(^|\s)-?date:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsDateOperator
      ? currentValue
      : trimmedCurrent.length === 0
        ? "date:"
        : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}date:`;

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(2);
  }

  private applyTagSuggestionOperator(): void {
    if (!this.searchComponent) {
      return;
    }

    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const hasActiveTrailingTagOperator = /(^|\s)-?tag:(?:"[^"]*"|[^\s]*)$/i.test(currentValue);
    const nextValue = hasActiveTrailingTagOperator
      ? currentValue
      : trimmedCurrent.length === 0
        ? "tag:"
        : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}tag:`;

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(3);
  }

  private applyDateValueSuggestion(suffix: string): void {
    if (!this.searchComponent) {
      return;
    }

    const currentValue = this.searchComponent.getValue();
    const replaceActiveDateTermPattern = /(^|\s)(-?date:)[^\s]*$/i;

    let nextValue: string;
    if (replaceActiveDateTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActiveDateTermPattern,
        (_match, prefix: string, operator: string) => `${prefix}${operator}${suffix}`
      );
    } else if (/(^|\s)-?date:/i.test(currentValue)) {
      nextValue = `${currentValue}${/\s$/.test(currentValue) ? "" : " "}date:${suffix}`;
    } else {
      nextValue = `date:${suffix}`;
    }

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }

  private applyPathValueSuggestion(folderPath: string): void {
    if (!this.searchComponent) {
      return;
    }

    const term = this.formatPathFilterTerm(folderPath);
    const currentValue = this.searchComponent.getValue();
    const replaceActivePathTermPattern = /(^|\s)(-?path:)(?:"[^"]*"|[^\s]*)$/i;

    let nextValue: string;
    if (replaceActivePathTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActivePathTermPattern,
        (_match, prefix: string, operator: string) => `${prefix}${operator}${term}`
      );
    } else if (/(^|\s)-?path:/i.test(currentValue)) {
      nextValue = `${currentValue}${/\s$/.test(currentValue) ? "" : " "}path:${term}`;
    } else {
      nextValue = `path:${term}`;
    }

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }

  private applyTagValueSuggestion(tag: string): void {
    if (!this.searchComponent) {
      return;
    }

    const currentValue = this.searchComponent.getValue();
    const term = this.formatTagFilterTerm(tag);
    const replaceActiveTagTermPattern = /(^|\s)(-?tag:)(?:"[^"]*"|[^\s]*)$/i;

    let nextValue: string;
    if (replaceActiveTagTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActiveTagTermPattern,
        (_match, prefix: string, operator: string) => `${prefix}${operator}${term}`
      );
    } else {
      nextValue = `${currentValue}${/\s$/.test(currentValue) || currentValue.length === 0 ? "" : " "}tag:${term}`;
    }

    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }

  private refreshFilterSuggestions(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    this.filterSuggestionsEl.replaceChildren();
    if (this.filterSuggestionMode === 1) {
      const currentQuery = this.searchComponent?.getValue() ?? this.pathFilterQuery;
      this.renderFolderSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    if (this.filterSuggestionMode === 2) {
      this.renderDateSuggestions(this.filterSuggestionsEl);
      return;
    }
    if (this.filterSuggestionMode === 3) {
      const currentQuery = this.searchComponent?.getValue() ?? this.pathFilterQuery;
      this.renderTagSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }

    this.renderOperatorSuggestions(this.filterSuggestionsEl);
  }

  private renderOperatorSuggestions(host: HTMLElement): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Search settings";

    const pathOption = createChild(host as ObsidianHTMLElement, "div");
    pathOption.className = "reverysky-map-filter-suggestion-option";
    pathOption.setAttribute("role", "button");

    const strong = createChild(pathOption as ObsidianHTMLElement, "span");
    strong.className = "reverysky-map-suggestion-key";
    strong.textContent = "path:";

    const desc = createChild(pathOption as ObsidianHTMLElement, "span");
    desc.className = "reverysky-map-suggestion-desc";
    desc.textContent = " match in file path";

    pathOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyPathSuggestionOperator();
    });

    const dateOption = createChild(host as ObsidianHTMLElement, "div");
    dateOption.className = "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked";
    dateOption.setAttribute("role", "button");

    const dateStrong = createChild(dateOption as ObsidianHTMLElement, "span");
    dateStrong.className = "reverysky-map-suggestion-key";
    dateStrong.textContent = "date:";

    const dateDesc = createChild(dateOption as ObsidianHTMLElement, "span");
    dateDesc.className = "reverysky-map-suggestion-desc";
    dateDesc.textContent = " match note date";

    dateOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyDateSuggestionOperator();
    });

    const tagOption = createChild(host as ObsidianHTMLElement, "div");
    tagOption.className = "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked";
    tagOption.setAttribute("role", "button");

    const tagStrong = createChild(tagOption as ObsidianHTMLElement, "span");
    tagStrong.className = "reverysky-map-suggestion-key";
    tagStrong.textContent = "tag:";

    const tagDesc = createChild(tagOption as ObsidianHTMLElement, "span");
    tagDesc.className = "reverysky-map-suggestion-desc";
    tagDesc.textContent = " match note tag";

    tagOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyTagSuggestionOperator();
    });
  }

  private renderDateSuggestions(host: HTMLElement): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Date presets";

    const presets = this.buildDateFilterPresetSuggestions();
    for (const suggestion of presets) {
      const option = createChild(host as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-date-suggestion-option";
      option.setAttribute("role", "button");

      const valuePart = createChild(option as ObsidianHTMLElement, "span");
      valuePart.className = "reverysky-map-date-suggestion-value";
      valuePart.textContent = `date:${suggestion.suffix}`;

      const labelPart = createChild(option as ObsidianHTMLElement, "span");
      labelPart.className = "reverysky-map-date-suggestion-label";
      labelPart.textContent = `  ${suggestion.label}`;

      option.title = suggestion.description;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyDateValueSuggestion(suggestion.suffix);
      });
    }
  }

  private renderFolderSuggestions(host: HTMLElement, query: string): void {
    this.ensureFolderSuggestionsReady();

    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Folders";

    const activePathValue = this.extractActivePathFilterTermValue(query);
    const normalizedActive = this.normalizeSearchTerm(activePathValue);

    const ranked = this.folderPathSuggestions
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

    if (!ranked.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No folders found";
      return;
    }

    for (const suggestion of ranked) {
      const option = createChild(host as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option";
      option.setAttribute("role", "button");
      option.textContent = suggestion.path;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyPathValueSuggestion(suggestion.path);
      });
    }
  }

  private renderTagSuggestions(host: HTMLElement, query: string): void {
    this.ensureTagSuggestionsReady();

    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Tags";

    const activeTagValue = this.extractActiveTagFilterTermValue(query);
    const normalizedActive = this.normalizeTagSuggestionSearchTerm(activeTagValue);
    const ranked = this.tagSuggestions
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

    if (!ranked.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No tags found";
      return;
    }

    for (const suggestion of ranked) {
      const option = createChild(host as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option reverysky-map-tag-suggestion-option";
      option.setAttribute("role", "button");
      option.textContent = suggestion.displayTag;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyTagValueSuggestion(suggestion.tag);
      });
    }
  }

  private buildDateFilterPresetSuggestions(): DateFilterPresetSuggestion[] {
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

  private formatPathFilterTerm(folderPath: string): string {
    const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
    const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  private formatTagFilterTerm(tag: string): string {
    return `#${tag.trim().replace(/^#/, "")}`;
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

  private syncSearchComponentValue(): void {
    if (!this.searchComponent) {
      return;
    }

    if (this.searchComponent.getValue() === this.pathFilterQuery) {
      return;
    }

    this.searchComponent.setValue(this.pathFilterQuery);
  }

  private refreshFilterMessage(): void {
    if (!this.filterMessageEl) {
      return;
    }

    const hasCustomMessage = this.pathFilterMessage.trim().length > 0;
    this.filterMessageEl.textContent = hasCustomMessage ? this.pathFilterMessage : "";
    this.filterMessageEl.style.display = hasCustomMessage ? "block" : "none";
    this.filterMessageEl.style.color = this.pathFilterParseValid
      ? "var(--text-muted)"
      : "var(--text-error)";
  }

  private setShowTags(showTags: boolean, options: { emit: boolean }): void {
    this.showTags = showTags;
    this.refreshTagsToggleUi();
    if (!options.emit) {
      return;
    }
    this.emitGraphFromSource();
  }

  private setEnginePreference(
    enginePreference: GraphEnginePreference,
    options: { emit: boolean }
  ): void {
    this.enginePreference = enginePreference;
    this.refreshEngineDropdownUi();
    if (!options.emit) {
      return;
    }
    this.emitGraphFromSource();
  }

  private refreshTagsToggleUi(): void {
    if (!this.tagsToggleButtonEl) {
      return;
    }

    this.tagsToggleButtonEl.setAttribute("role", "switch");
    this.tagsToggleButtonEl.setAttribute("aria-checked", this.showTags ? "true" : "false");
  }

  private refreshEngineDropdownUi(): void {
    if (!this.engineDropdownEl) {
      return;
    }

    if (this.engineDropdownEl.value === this.enginePreference) {
      return;
    }

    this.engineDropdownEl.value = this.enginePreference;
  }

  private normalizeEnginePreference(value: unknown): GraphEnginePreference {
    return value === "forces" || value === "static25d" || value === "auto"
      ? value
      : DEFAULT_ENGINE_PREFERENCE;
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
