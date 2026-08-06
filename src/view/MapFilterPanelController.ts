import { SearchComponent, setIcon } from "obsidian";
import { FRAME_RATE_MODE_OPTIONS } from "../bridge/FrameRateMode";
import { MAP_LAYOUT_PREFERENCE_OPTIONS } from "../bridge/LayoutPreference";
import {
  MAX_RENDER_SCALE,
  MIN_RENDER_SCALE,
  MapSession,
  RENDER_SCALE_STEP
} from "./MapSession";
import { MapFilterSuggestionsController } from "./MapFilterSuggestionsController";

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

type MapFilterPanelControllerDependencies = {
  onCopyScreenshotRequested?: () => Promise<void> | void;
};

/**
 * Owns the filter-panel UI state machine and keeps the DOM synchronized with `MapSession`.
 */
export class MapFilterPanelController {
  private filterMessageEl: HTMLElement | null = null;
  private filterPanelEl: HTMLElement | null = null;
  private filterScrollAreaEl: HTMLElement | null = null;
  private filterToggleButtonEl: HTMLButtonElement | null = null;
  private settingsSectionEl: HTMLElement | null = null;
  private settingsSectionToggleButtonEl: HTMLButtonElement | null = null;
  private settingsSectionContentEl: HTMLElement | null = null;
  private graphicsSectionEl: HTMLElement | null = null;
  private graphicsSectionToggleButtonEl: HTMLButtonElement | null = null;
  private graphicsSectionContentEl: HTMLElement | null = null;
  private screenshotSectionEl: HTMLElement | null = null;
  private screenshotSectionToggleButtonEl: HTMLButtonElement | null = null;
  private screenshotSectionContentEl: HTMLElement | null = null;
  private tagsToggleButtonEl: HTMLButtonElement | null = null;
  private layoutDropdownEl: HTMLSelectElement | null = null;
  private frameRateModeDropdownEl: HTMLSelectElement | null = null;
  private renderScaleInputEl: HTMLInputElement | null = null;
  private renderScaleValueEl: HTMLElement | null = null;
  private renderScaleMessageEl: HTMLElement | null = null;
  private searchComponent: SearchComponent | null = null;
  private filterSuggestionsController: MapFilterSuggestionsController | null = null;
  private screenshotButtonEl: HTMLButtonElement | null = null;
  private filterPanelOpen = false;
  private settingsSectionCollapsed = true;
  private graphicsSectionCollapsed = true;
  private screenshotSectionCollapsed = true;

  constructor(
    private readonly session: MapSession,
    private readonly deps: MapFilterPanelControllerDependencies = {}
  ) {}

  render(container: ObsidianHTMLElement): ObsidianHTMLElement {
    const root = createChild(container, "div") as ObsidianHTMLElement;
    root.className = "reverysky-map-root";

    const iframeFallback = createChild(root, "div");
    iframeFallback.className = "reverysky-map-iframe-fallback";
    iframeFallback.textContent = "Loading graph runtime...";

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
      if (event.detail !== 0) {
        return;
      }
      event.preventDefault();
      toggleFilterPanel();
    });

    const filterContainer = createChild(root, "div");
    filterContainer.className = "reverysky-map-filter-panel";
    this.filterPanelEl = filterContainer;
    const filterScrollArea = createChild(filterContainer as ObsidianHTMLElement, "div");
    filterScrollArea.className = "reverysky-map-filter-panel-body";
    this.filterScrollAreaEl = filterScrollArea;
    filterScrollArea.addEventListener("scroll", () => {
      this.filterSuggestionsController?.position();
    });

    const filterSection = createChild(filterScrollArea as ObsidianHTMLElement, "div");
    filterSection.className = "reverysky-map-filter-section reverysky-map-settings-section";
    this.settingsSectionEl = filterSection;

    const filterSectionHeader = createChild(filterSection as ObsidianHTMLElement, "div");
    filterSectionHeader.className = "reverysky-map-filter-header";

    const filterSectionToggleButton = createChild(filterSectionHeader as ObsidianHTMLElement, "button");
    filterSectionToggleButton.type = "button";
    filterSectionToggleButton.className = "reverysky-map-filter-section-toggle";
    filterSectionToggleButton.tabIndex = -1;
    this.settingsSectionToggleButtonEl = filterSectionToggleButton;

    const filterSectionChevron = createChild(filterSectionToggleButton as ObsidianHTMLElement, "span");
    filterSectionChevron.className = "reverysky-map-filter-section-chevron";
    setIcon(filterSectionChevron, "chevron-right");

    const filterSectionTitle = createChild(filterSectionToggleButton as ObsidianHTMLElement, "span");
    filterSectionTitle.className = "reverysky-map-filter-title";
    filterSectionTitle.textContent = "Selection";
    this.registerSectionToggle(filterSectionToggleButton, () => {
      this.setSettingsSectionCollapsed(!this.settingsSectionCollapsed);
    });

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

    const filterSectionContent = createChild(filterSection as ObsidianHTMLElement, "div");
    filterSectionContent.className = "reverysky-map-filter-section-content";
    this.settingsSectionContentEl = filterSectionContent;

    const filterSearchArea = createChild(filterSectionContent as ObsidianHTMLElement, "div");
    filterSearchArea.className = "reverysky-map-filter-search-area";

    const filterSearchLabel = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    filterSearchLabel.className = "reverysky-map-filter-field-label";
    filterSearchLabel.textContent = "Filter";

    const searchHost = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    this.searchComponent = new SearchComponent(searchHost);
    this.searchComponent.setPlaceholder("Search in...");
    this.filterSuggestionsController = new MapFilterSuggestionsController({
      session: this.session,
      inputEl: this.searchComponent.inputEl,
      rootEl: root,
      anchorEl: filterSearchArea,
      getQuery: () => this.searchComponent?.getValue() ?? this.session.getFilterUiState().filterQuery,
      setQueryValue: (value) => {
        this.searchComponent?.setValue(value);
      },
      commitQuery: (query) => {
        this.commitFilterQuery(query);
      },
      openPanel: () => {
        this.setFilterPanelOpen(true);
      }
    });
    this.searchComponent.onChange((value) => {
      this.filterSuggestionsController?.handleInputChanged(value);
    });

    this.filterMessageEl = createChild(filterSectionContent as ObsidianHTMLElement, "div");
    this.filterMessageEl.className = "reverysky-map-filter-message";

    const tagsToggleRow = createChild(filterSectionContent as ObsidianHTMLElement, "div");
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
      const uiState = this.session.getFilterUiState();
      this.session.setShowTags(!uiState.showTags);
      this.refreshTagsToggleUi();
    };
    tagsToggleButton.addEventListener("mousedown", toggleTags);
    tagsToggleButton.addEventListener("click", (event) => {
      if (event.detail !== 0) {
        return;
      }
      toggleTags(event);
    });

    const layoutSection = createChild(filterSectionContent as ObsidianHTMLElement, "div");
    layoutSection.className = "reverysky-map-filter-section reverysky-map-filter-control-group";

    const layoutSectionTitle = createChild(layoutSection as ObsidianHTMLElement, "div");
    layoutSectionTitle.className = "reverysky-map-filter-field-label";
    layoutSectionTitle.textContent = "Layout";

    const layoutSelectHost = createChild(layoutSection as ObsidianHTMLElement, "div");
    layoutSelectHost.className = "reverysky-map-engine-select-host";
    const layoutDropdown = createChild(layoutSelectHost as ObsidianHTMLElement, "select");
    this.layoutDropdownEl = layoutDropdown;
    for (const option of MAP_LAYOUT_PREFERENCE_OPTIONS) {
      const optionEl = createChild(layoutDropdown as ObsidianHTMLElement, "option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
    }
    layoutDropdown.classList.add("reverysky-map-engine-select");
    layoutDropdown.setAttribute("aria-label", "Select layout");
    layoutDropdown.addEventListener("change", () => {
      this.session.setMapLayoutPreference(layoutDropdown.value);
      this.refreshLayoutDropdownUi();
    });

    const graphicsSection = createChild(filterScrollArea as ObsidianHTMLElement, "div");
    graphicsSection.className = "reverysky-map-filter-section reverysky-map-graphics-section";
    this.graphicsSectionEl = graphicsSection;

    const graphicsSectionHeader = createChild(graphicsSection as ObsidianHTMLElement, "div");
    graphicsSectionHeader.className = "reverysky-map-filter-header";

    const graphicsSectionToggleButton = createChild(graphicsSectionHeader as ObsidianHTMLElement, "button");
    graphicsSectionToggleButton.type = "button";
    graphicsSectionToggleButton.className = "reverysky-map-filter-section-toggle";
    graphicsSectionToggleButton.tabIndex = -1;
    this.graphicsSectionToggleButtonEl = graphicsSectionToggleButton;

    const graphicsSectionChevron = createChild(graphicsSectionToggleButton as ObsidianHTMLElement, "span");
    graphicsSectionChevron.className = "reverysky-map-filter-section-chevron";
    setIcon(graphicsSectionChevron, "chevron-right");

    const graphicsSectionTitle = createChild(graphicsSectionToggleButton as ObsidianHTMLElement, "span");
    graphicsSectionTitle.className = "reverysky-map-filter-title";
    graphicsSectionTitle.textContent = "Graphics";
    this.registerSectionToggle(graphicsSectionToggleButton, () => {
      this.setGraphicsSectionCollapsed(!this.graphicsSectionCollapsed);
    });

    const graphicsSectionContent = createChild(graphicsSection as ObsidianHTMLElement, "div");
    graphicsSectionContent.className = "reverysky-map-filter-section-content";
    this.graphicsSectionContentEl = graphicsSectionContent;

    const renderScaleSection = createChild(graphicsSectionContent as ObsidianHTMLElement, "div");
    renderScaleSection.className =
      "reverysky-map-filter-section reverysky-map-filter-control-group reverysky-map-render-scale-section";

    const renderScaleHeader = createChild(renderScaleSection as ObsidianHTMLElement, "div");
    renderScaleHeader.className = "reverysky-map-render-scale-header";

    const renderScaleTitle = createChild(renderScaleHeader as ObsidianHTMLElement, "div");
    renderScaleTitle.className = "reverysky-map-filter-field-label";
    renderScaleTitle.textContent = "Render scale";

    this.renderScaleValueEl = createChild(renderScaleHeader as ObsidianHTMLElement, "div");
    this.renderScaleValueEl.className = "reverysky-map-render-scale-value";

    const renderScaleInput = createChild(renderScaleSection as ObsidianHTMLElement, "input");
    renderScaleInput.type = "range";
    renderScaleInput.min = String(MIN_RENDER_SCALE);
    renderScaleInput.max = String(MAX_RENDER_SCALE);
    renderScaleInput.step = String(RENDER_SCALE_STEP);
    renderScaleInput.className = "reverysky-map-render-scale-input";
    renderScaleInput.setAttribute("aria-label", "Render scale");
    this.renderScaleInputEl = renderScaleInput;
    renderScaleInput.addEventListener("input", () => {
      this.session.setRenderScale(renderScaleInput.value);
      this.refreshRenderScaleUi();
    });
    renderScaleInput.addEventListener("change", () => {
      this.session.persistRenderScale();
    });

    this.renderScaleMessageEl = createChild(renderScaleSection as ObsidianHTMLElement, "div");
    this.renderScaleMessageEl.className =
      "reverysky-map-render-scale-message reverysky-map-render-scale-message--hidden";

    const frameRateModeSection = createChild(graphicsSectionContent as ObsidianHTMLElement, "div");
    frameRateModeSection.className = "reverysky-map-filter-section reverysky-map-filter-control-group";

    const frameRateModeTitle = createChild(frameRateModeSection as ObsidianHTMLElement, "div");
    frameRateModeTitle.className = "reverysky-map-filter-field-label";
    frameRateModeTitle.textContent = "Frame rate";

    const frameRateModeSelectHost = createChild(frameRateModeSection as ObsidianHTMLElement, "div");
    frameRateModeSelectHost.className = "reverysky-map-engine-select-host";
    const frameRateModeDropdown = createChild(frameRateModeSelectHost as ObsidianHTMLElement, "select");
    this.frameRateModeDropdownEl = frameRateModeDropdown;
    for (const option of FRAME_RATE_MODE_OPTIONS) {
      const optionEl = createChild(frameRateModeDropdown as ObsidianHTMLElement, "option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
    }
    frameRateModeDropdown.classList.add("reverysky-map-engine-select", "reverysky-map-frame-rate-mode-select");
    frameRateModeDropdown.setAttribute("aria-label", "Select frame rate");
    frameRateModeDropdown.addEventListener("change", () => {
      this.session.setFrameRateMode(frameRateModeDropdown.value);
      this.refreshFrameRateModeDropdownUi();
    });

    const screenshotSection = createChild(filterScrollArea as ObsidianHTMLElement, "div");
    screenshotSection.className = "reverysky-map-filter-section reverysky-map-screenshot-section";
    this.screenshotSectionEl = screenshotSection;

    const screenshotSectionHeader = createChild(screenshotSection as ObsidianHTMLElement, "div");
    screenshotSectionHeader.className = "reverysky-map-filter-header";

    const screenshotSectionToggleButton = createChild(screenshotSectionHeader as ObsidianHTMLElement, "button");
    screenshotSectionToggleButton.type = "button";
    screenshotSectionToggleButton.className = "reverysky-map-filter-section-toggle";
    screenshotSectionToggleButton.tabIndex = -1;
    this.screenshotSectionToggleButtonEl = screenshotSectionToggleButton;

    const screenshotSectionChevron = createChild(screenshotSectionToggleButton as ObsidianHTMLElement, "span");
    screenshotSectionChevron.className = "reverysky-map-filter-section-chevron";
    setIcon(screenshotSectionChevron, "chevron-right");

    const screenshotSectionTitle = createChild(screenshotSectionToggleButton as ObsidianHTMLElement, "span");
    screenshotSectionTitle.className = "reverysky-map-filter-title";
    screenshotSectionTitle.textContent = "Screenshot";
    this.registerSectionToggle(screenshotSectionToggleButton, () => {
      this.setScreenshotSectionCollapsed(!this.screenshotSectionCollapsed);
    });

    const screenshotSectionContent = createChild(screenshotSection as ObsidianHTMLElement, "div");
    screenshotSectionContent.className = "reverysky-map-filter-section-content";
    this.screenshotSectionContentEl = screenshotSectionContent;

    const screenshotButton = createChild(screenshotSectionContent as ObsidianHTMLElement, "button");
    screenshotButton.type = "button";
    screenshotButton.className = "reverysky-map-screenshot-button";
    screenshotButton.textContent = "Copy screenshot";
    screenshotButton.setAttribute("aria-label", "Copy graph screenshot");
    this.screenshotButtonEl = screenshotButton;
    screenshotButton.addEventListener("click", () => {
      void this.deps.onCopyScreenshotRequested?.();
    });

    this.setFilterPanelOpen(false);
    this.refreshCollapsibleSections();
    this.syncFromSession();
    return iframeHost;
  }

  syncFromSession(): void {
    this.syncSearchComponentValue();
    this.refreshFilterMessage();
    this.refreshTagsToggleUi();
    this.refreshLayoutDropdownUi();
    this.refreshRenderScaleUi();
    this.refreshFrameRateModeDropdownUi();
  }

  refreshSuggestions(): void {
    this.filterSuggestionsController?.refresh();
  }

  dispose(): void {
    this.filterSuggestionsController?.dispose();
    this.filterSuggestionsController = null;
    this.searchComponent = null;
    this.filterMessageEl = null;
    this.filterPanelEl = null;
    this.filterScrollAreaEl = null;
    this.filterToggleButtonEl = null;
    this.settingsSectionEl = null;
    this.settingsSectionToggleButtonEl = null;
    this.settingsSectionContentEl = null;
    this.graphicsSectionEl = null;
    this.graphicsSectionToggleButtonEl = null;
    this.graphicsSectionContentEl = null;
    this.screenshotSectionEl = null;
    this.screenshotSectionToggleButtonEl = null;
    this.screenshotSectionContentEl = null;
    this.tagsToggleButtonEl = null;
    this.layoutDropdownEl = null;
    this.frameRateModeDropdownEl = null;
    this.renderScaleInputEl = null;
    this.renderScaleValueEl = null;
    this.renderScaleMessageEl = null;
    this.screenshotButtonEl = null;
    this.filterPanelOpen = false;
    this.settingsSectionCollapsed = true;
    this.graphicsSectionCollapsed = true;
    this.screenshotSectionCollapsed = true;
  }

  private setFilterPanelOpen(isOpen: boolean): void {
    this.filterPanelOpen = isOpen;
    if (!this.filterPanelEl || !this.filterToggleButtonEl) {
      return;
    }

    this.filterPanelEl.classList.toggle("reverysky-map-filter-panel--closed", !isOpen);
    this.filterToggleButtonEl.classList.toggle("reverysky-map-filter-toggle--hidden", isOpen);
    if (!isOpen) {
      this.filterSuggestionsController?.hide();
    }
  }

  private registerSectionToggle(button: HTMLButtonElement, toggle: () => void): void {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggle();
    });
    button.addEventListener("click", (event) => {
      if (event.detail !== 0) {
        return;
      }

      event.preventDefault();
      toggle();
    });
  }

  private setSettingsSectionCollapsed(isCollapsed: boolean): void {
    this.settingsSectionCollapsed = isCollapsed;
    if (isCollapsed) {
      this.filterSuggestionsController?.hide();
    }
    this.refreshCollapsibleSections();
  }

  private setGraphicsSectionCollapsed(isCollapsed: boolean): void {
    this.graphicsSectionCollapsed = isCollapsed;
    this.refreshCollapsibleSections();
  }

  private setScreenshotSectionCollapsed(isCollapsed: boolean): void {
    this.screenshotSectionCollapsed = isCollapsed;
    this.refreshCollapsibleSections();
  }

  private refreshCollapsibleSections(): void {
    this.refreshCollapsibleSection(
      this.settingsSectionEl,
      this.settingsSectionToggleButtonEl,
      this.settingsSectionContentEl,
      this.settingsSectionCollapsed,
      "Selection"
    );
    this.refreshCollapsibleSection(
      this.graphicsSectionEl,
      this.graphicsSectionToggleButtonEl,
      this.graphicsSectionContentEl,
      this.graphicsSectionCollapsed,
      "Graphics"
    );
    this.refreshCollapsibleSection(
      this.screenshotSectionEl,
      this.screenshotSectionToggleButtonEl,
      this.screenshotSectionContentEl,
      this.screenshotSectionCollapsed,
      "Screenshot"
    );
  }

  private refreshCollapsibleSection(
    section: HTMLElement | null,
    toggleButton: HTMLButtonElement | null,
    content: HTMLElement | null,
    isCollapsed: boolean,
    label: string
  ): void {
    section?.classList.toggle("reverysky-map-filter-section--collapsed", isCollapsed);
    content?.classList.toggle("reverysky-map-filter-section-content--collapsed", isCollapsed);
    toggleButton?.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    toggleButton?.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${label}`);
  }

  private commitFilterQuery(nextQuery: string): void {
    this.session.setFilterQuery(nextQuery);
    this.refreshFilterMessage();
  }

  private syncSearchComponentValue(): void {
    if (!this.searchComponent) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.searchComponent.getValue() === uiState.filterQuery) {
      return;
    }

    this.searchComponent.setValue(uiState.filterQuery);
  }

  private refreshFilterMessage(): void {
    if (!this.filterMessageEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    const hasCustomMessage = uiState.filterMessage.trim().length > 0;
    this.filterMessageEl.textContent = hasCustomMessage ? uiState.filterMessage : "";
    this.filterMessageEl.classList.toggle("reverysky-map-filter-message--hidden", !hasCustomMessage);
    this.filterMessageEl.classList.toggle(
      "reverysky-map-filter-message--invalid",
      !uiState.filterParseValid
    );
  }

  private refreshTagsToggleUi(): void {
    if (!this.tagsToggleButtonEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    this.tagsToggleButtonEl.setAttribute("role", "switch");
    this.tagsToggleButtonEl.setAttribute("aria-checked", uiState.showTags ? "true" : "false");
  }

  private refreshLayoutDropdownUi(): void {
    if (!this.layoutDropdownEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.layoutDropdownEl.value === uiState.mapLayout) {
      return;
    }

    this.layoutDropdownEl.value = uiState.mapLayout;
  }

  private refreshRenderScaleUi(): void {
    if (!this.renderScaleInputEl || !this.renderScaleValueEl || !this.renderScaleMessageEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    const formattedValue = this.formatRenderScale(uiState.renderScale);
    if (this.renderScaleInputEl.value !== formattedValue) {
      this.renderScaleInputEl.value = formattedValue;
    }
    this.renderScaleValueEl.textContent = `${formattedValue}x`;

    const restartRequired = uiState.renderScaleRestartRequired;
    this.renderScaleMessageEl.textContent = restartRequired ? "Reopen the graph view to apply." : "";
    this.renderScaleMessageEl.classList.toggle(
      "reverysky-map-render-scale-message--hidden",
      !restartRequired
    );
  }

  private refreshFrameRateModeDropdownUi(): void {
    if (!this.frameRateModeDropdownEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.frameRateModeDropdownEl.value === uiState.frameRateMode) {
      return;
    }

    this.frameRateModeDropdownEl.value = uiState.frameRateMode;
  }

  private formatRenderScale(value: number): string {
    return value.toFixed(1);
  }
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return element.createEl(tagName);
}
