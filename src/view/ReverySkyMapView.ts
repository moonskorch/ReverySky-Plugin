import { ItemView, Notice, SearchComponent, WorkspaceLeaf, setIcon } from "obsidian";
import type { App, CachedMetadata, TAbstractFile, TFile } from "obsidian";
import type { GraphPayload, NoteFocusPayload, NoteOpenPayload } from "../bridge/BridgeTypes";
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

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "sendGraphSet" | "sendNoteFocus">;
type ObsidianHTMLElement = HTMLElement & {
  empty?: () => void;
  createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

type ReverySkyMapViewState = {
  pathFilterQuery?: unknown;
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

type FilterSuggestionMode = 0 | 1 | 2;

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
  private activePathFilter: ParsedPathFilter | null = null;
  private pathFilterParseValid = true;
  private pathFilterMessage = "";
  private filterInputDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private filterSuggestionsHideTimer: ReturnType<typeof setTimeout> | null = null;
  private filterMessageEl: HTMLElement | null = null;
  private filterSuggestionsEl: HTMLElement | null = null;
  private filterPanelEl: HTMLElement | null = null;
  private filterToggleButtonEl: HTMLButtonElement | null = null;
  private filterSuggestionMode: FilterSuggestionMode = 0;
  private folderPathSuggestions: FolderPathSuggestion[] = [];
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
      pathFilterQuery: this.pathFilterQuery
    };
  }

  async setState(state: unknown): Promise<void> {
    const nextState = (state ?? {}) as ReverySkyMapViewState;
    const nextQuery =
      typeof nextState.pathFilterQuery === "string" ? nextState.pathFilterQuery : "";
    this.pathFilterQuery = nextQuery;
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

    const outgoingPayload = this.applyActivePathFilter(this.sourceGraphPayload);
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

  private applyActivePathFilter(payload: GraphPayload): GraphPayload {
    return GraphPathFilter.applyPathFilter(payload, this.activePathFilter);
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
    root.style.position = "relative";
    root.style.height = "100%";
    root.style.width = "100%";
    root.style.overflow = "hidden";

    const iframeHost = createChild(root, "div") as ObsidianHTMLElement;
    iframeHost.style.height = "100%";
    iframeHost.style.width = "100%";
    iframeHost.style.position = "relative";
    iframeHost.style.zIndex = "1";

    const overlayControls = createChild(root, "div");
    overlayControls.className = "reverysky-map-overlay-controls";
    overlayControls.style.position = "absolute";
    overlayControls.style.top = "8px";
    overlayControls.style.right = "10px";
    overlayControls.style.zIndex = "40";
    overlayControls.style.pointerEvents = "auto";

    const settingsToggleButton = createChild(overlayControls as ObsidianHTMLElement, "button");
    const gearBaseBackground = "var(--background-secondary)";
    const gearHoverBackground = "color-mix(in srgb, var(--background-secondary) 82%, #000 18%)";
    settingsToggleButton.type = "button";
    settingsToggleButton.className = "reverysky-map-filter-toggle";
    this.filterToggleButtonEl = settingsToggleButton;
    settingsToggleButton.setAttribute("aria-label", "Open filters");
    settingsToggleButton.style.width = "36px";
    settingsToggleButton.style.height = "36px";
    settingsToggleButton.style.border = "1px solid var(--background-modifier-border)";
    settingsToggleButton.style.borderRadius = "10px";
    settingsToggleButton.style.background = gearBaseBackground;
    settingsToggleButton.style.color = "var(--text-muted)";
    settingsToggleButton.style.padding = "0";
    settingsToggleButton.style.cursor = "pointer";
    settingsToggleButton.style.display = "inline-flex";
    settingsToggleButton.style.alignItems = "center";
    settingsToggleButton.style.justifyContent = "center";
    settingsToggleButton.style.boxShadow = "none";
    settingsToggleButton.style.opacity = "1";
    settingsToggleButton.style.transition = "background-color 120ms ease, border-color 120ms ease";
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
    settingsToggleButton.addEventListener("mouseenter", () => {
      settingsToggleButton.style.background = gearHoverBackground;
    });
    settingsToggleButton.addEventListener("mouseleave", () => {
      settingsToggleButton.style.background = gearBaseBackground;
    });

    const filterContainer = createChild(root, "div");
    filterContainer.className = "reverysky-map-filter-panel";
    this.filterPanelEl = filterContainer;
    filterContainer.style.position = "absolute";
    filterContainer.style.top = "8px";
    filterContainer.style.right = "10px";
    filterContainer.style.width = "min(380px, calc(100% - 20px))";
    filterContainer.style.maxHeight = "min(520px, calc(100% - 64px))";
    filterContainer.style.overflow = "visible";
    filterContainer.style.background = "var(--background-primary)";
    filterContainer.style.border = "1px solid var(--background-modifier-border)";
    filterContainer.style.borderRadius = "12px";
    filterContainer.style.boxShadow = "0 4px 18px rgba(0, 0, 0, 0.16)";
    filterContainer.style.padding = "10px";
    filterContainer.style.display = "grid";
    filterContainer.style.gap = "6px";
    filterContainer.style.zIndex = "120";

    const panelHeader = createChild(filterContainer as ObsidianHTMLElement, "div");
    panelHeader.style.display = "flex";
    panelHeader.style.alignItems = "center";
    panelHeader.style.justifyContent = "space-between";
    panelHeader.style.marginBottom = "4px";

    const filterTitle = createChild(panelHeader as ObsidianHTMLElement, "div");
    filterTitle.textContent = "Filters";
    filterTitle.style.fontSize = "14px";
    filterTitle.style.fontWeight = "600";
    filterTitle.style.color = "var(--text-normal)";

    const panelCloseButton = createChild(panelHeader as ObsidianHTMLElement, "button");
    panelCloseButton.type = "button";
    panelCloseButton.className = "reverysky-map-filter-close";
    panelCloseButton.setAttribute("aria-label", "Close filters");
    panelCloseButton.style.width = "22px";
    panelCloseButton.style.height = "22px";
    panelCloseButton.style.border = "0";
    panelCloseButton.style.borderRadius = "5px";
    panelCloseButton.style.background = "transparent";
    panelCloseButton.style.color = "var(--text-muted)";
    panelCloseButton.style.padding = "0";
    panelCloseButton.style.cursor = "pointer";
    panelCloseButton.style.boxShadow = "none";
    panelCloseButton.style.display = "inline-flex";
    panelCloseButton.style.alignItems = "center";
    panelCloseButton.style.justifyContent = "center";
    panelCloseButton.style.transition = "background-color 120ms ease";
    panelCloseButton.style.setProperty("appearance", "none");
    setIcon(panelCloseButton, "x");
    for (const icon of Array.from(panelCloseButton.querySelectorAll("svg"))) {
      icon.style.width = "13px";
      icon.style.height = "13px";
    }
    panelCloseButton.addEventListener("mouseenter", () => {
      panelCloseButton.style.background = "var(--background-modifier-hover)";
      panelCloseButton.style.color = "var(--text-normal)";
    });
    panelCloseButton.addEventListener("mouseleave", () => {
      panelCloseButton.style.background = "transparent";
      panelCloseButton.style.color = "var(--text-muted)";
    });
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

    const searchHost = createChild(filterContainer as ObsidianHTMLElement, "div");
    this.searchComponent = new SearchComponent(searchHost);
    this.searchComponent.setPlaceholder("Search files...");
    this.searchComponent.onChange((value) => {
      this.onPathFilterInputChanged(value);
    });
    this.searchComponent.inputEl.setAttribute("aria-label", "Search files filter");
    this.searchComponent.inputEl.addEventListener("focus", () => {
      this.showFilterSuggestions(0);
    });
    this.searchComponent.inputEl.addEventListener("click", () => {
      this.showFilterSuggestions(0);
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

    this.filterSuggestionsEl = createChild(filterContainer as ObsidianHTMLElement, "div");
    this.filterSuggestionsEl.className = "reverysky-map-filter-suggestions";
    this.filterSuggestionsEl.style.display = "none";
    this.filterSuggestionsEl.style.position = "absolute";
    this.filterSuggestionsEl.style.left = "10px";
    this.filterSuggestionsEl.style.right = "10px";
    this.filterSuggestionsEl.style.top = "calc(100% + 2px)";
    this.filterSuggestionsEl.style.background = "var(--background-primary)";
    this.filterSuggestionsEl.style.border = "1px solid var(--background-modifier-border)";
    this.filterSuggestionsEl.style.borderRadius = "10px";
    this.filterSuggestionsEl.style.padding = "8px";
    this.filterSuggestionsEl.style.boxShadow = "none";
    this.filterSuggestionsEl.style.zIndex = "30";
    this.filterSuggestionsEl.style.maxHeight = "44vh";
    this.filterSuggestionsEl.style.overflowY = "auto";

    this.filterMessageEl = createChild(filterContainer as ObsidianHTMLElement, "div");
    this.filterMessageEl.className = "reverysky-map-filter-message";
    this.filterMessageEl.style.fontSize = "12px";
    this.filterMessageEl.style.opacity = "0.85";
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

    this.renderOperatorSuggestions(this.filterSuggestionsEl);
  }

  private renderOperatorSuggestions(host: HTMLElement): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.textContent = "Search settings";
    suggestionsTitle.style.fontSize = "13px";
    suggestionsTitle.style.fontWeight = "600";
    suggestionsTitle.style.color = "var(--text-muted)";
    suggestionsTitle.style.marginBottom = "6px";

    const pathOption = createChild(host as ObsidianHTMLElement, "div");
    pathOption.className = "reverysky-map-filter-suggestion-option";
    pathOption.setAttribute("role", "button");
    pathOption.style.display = "block";
    pathOption.style.width = "100%";
    pathOption.style.textAlign = "left";
    pathOption.style.padding = "6px 8px";
    pathOption.style.border = "0";
    pathOption.style.borderRadius = "6px";
    pathOption.style.background = "var(--background-secondary-alt)";
    pathOption.style.color = "var(--text-normal)";
    pathOption.style.cursor = "pointer";
    pathOption.style.fontSize = "13px";
    pathOption.style.lineHeight = "1.2";
    pathOption.style.font = "inherit";
    this.attachSuggestionHoverStyle(pathOption, "var(--background-secondary-alt)");

    const strong = createChild(pathOption as ObsidianHTMLElement, "span");
    strong.textContent = "path:";
    strong.style.color = "var(--text-normal)";
    strong.style.marginRight = "4px";

    const desc = createChild(pathOption as ObsidianHTMLElement, "span");
    desc.textContent = " match in file path";
    desc.style.color = "var(--text-muted)";

    pathOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyPathSuggestionOperator();
    });

    const dateOption = createChild(host as ObsidianHTMLElement, "div");
    dateOption.className = "reverysky-map-filter-suggestion-option";
    dateOption.setAttribute("role", "button");
    dateOption.style.display = "block";
    dateOption.style.width = "100%";
    dateOption.style.textAlign = "left";
    dateOption.style.padding = "6px 8px";
    dateOption.style.border = "0";
    dateOption.style.borderRadius = "6px";
    dateOption.style.background = "var(--background-secondary-alt)";
    dateOption.style.color = "var(--text-normal)";
    dateOption.style.cursor = "pointer";
    dateOption.style.fontSize = "13px";
    dateOption.style.lineHeight = "1.2";
    dateOption.style.font = "inherit";
    dateOption.style.marginTop = "4px";
    this.attachSuggestionHoverStyle(dateOption, "var(--background-secondary-alt)");

    const dateStrong = createChild(dateOption as ObsidianHTMLElement, "span");
    dateStrong.textContent = "date:";
    dateStrong.style.color = "var(--text-normal)";
    dateStrong.style.marginRight = "4px";

    const dateDesc = createChild(dateOption as ObsidianHTMLElement, "span");
    dateDesc.textContent = " match note date";
    dateDesc.style.color = "var(--text-muted)";

    dateOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyDateSuggestionOperator();
    });
  }

  private renderDateSuggestions(host: HTMLElement): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.textContent = "Date presets";
    suggestionsTitle.style.fontSize = "13px";
    suggestionsTitle.style.fontWeight = "600";
    suggestionsTitle.style.color = "var(--text-muted)";
    suggestionsTitle.style.marginBottom = "6px";

    const presets = this.buildDateFilterPresetSuggestions();
    for (const suggestion of presets) {
      const option = createChild(host as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-date-suggestion-option";
      option.setAttribute("role", "button");
      option.style.display = "block";
      option.style.width = "100%";
      option.style.textAlign = "left";
      option.style.padding = "6px 8px";
      option.style.border = "1px solid transparent";
      option.style.borderRadius = "6px";
      option.style.background = "transparent";
      option.style.color = "var(--text-normal)";
      option.style.cursor = "pointer";
      option.style.fontSize = "13px";
      option.style.lineHeight = "1.2";
      option.style.font = "inherit";
      option.style.marginBottom = "0";
      this.attachSuggestionHoverStyle(option, "transparent");

      const valuePart = createChild(option as ObsidianHTMLElement, "span");
      valuePart.textContent = `date:${suggestion.suffix}`;
      valuePart.style.color = "var(--text-normal)";

      const labelPart = createChild(option as ObsidianHTMLElement, "span");
      labelPart.textContent = `  ${suggestion.label}`;
      labelPart.style.color = "var(--text-muted)";
      labelPart.style.fontSize = "12px";
      labelPart.style.marginLeft = "6px";

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
    suggestionsTitle.textContent = "Folders";
    suggestionsTitle.style.fontSize = "13px";
    suggestionsTitle.style.fontWeight = "600";
    suggestionsTitle.style.color = "var(--text-muted)";
    suggestionsTitle.style.marginBottom = "6px";

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
      emptyHint.textContent = "No folders found";
      emptyHint.style.color = "var(--text-muted)";
      emptyHint.style.fontSize = "13px";
      return;
    }

    for (const suggestion of ranked) {
      const option = createChild(host as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option";
      option.setAttribute("role", "button");
      option.textContent = suggestion.path;
      option.style.display = "block";
      option.style.width = "100%";
      option.style.textAlign = "left";
      option.style.padding = "6px 8px";
      option.style.border = "1px solid transparent";
      option.style.borderRadius = "6px";
      option.style.background = "transparent";
      option.style.color = "var(--text-normal)";
      option.style.cursor = "pointer";
      option.style.font = "inherit";
      option.style.fontSize = "13px";
      option.style.lineHeight = "1.2";
      option.style.marginBottom = "0";
      this.attachSuggestionHoverStyle(option, "transparent");
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyPathValueSuggestion(suggestion.path);
      });
    }
  }

  private attachSuggestionHoverStyle(
    element: HTMLElement,
    baseBackground: string
  ): void {
    const hoverBackground = "var(--background-modifier-hover)";
    const baseBorderColor = element.style.borderColor || "transparent";
    const hoverBorderColor = "var(--background-modifier-border-hover)";
    element.style.background = baseBackground;
    element.style.opacity = "1";
    element.style.transition = "background-color 120ms ease, border-color 120ms ease";
    element.addEventListener("mouseenter", () => {
      element.style.background = hoverBackground;
      element.style.borderColor = hoverBorderColor;
      element.style.opacity = "1";
    });
    element.addEventListener("mouseleave", () => {
      element.style.background = baseBackground;
      element.style.borderColor = baseBorderColor;
      element.style.opacity = "1";
    });
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

  private formatPathFilterTerm(folderPath: string): string {
    const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
    const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  private normalizeSearchTerm(value: string): string {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }

  private applyParsedFilterResult(parseResult: PathFilterParseResult): void {
    this.pathFilterParseValid = parseResult.isValid;

    if (!parseResult.isValid) {
      this.pathFilterMessage = "";
      return;
    }

    this.pathFilterMessage = parseResult.hasUnsupportedTokens
      ? "Only path: and date: terms are applied in this view."
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
