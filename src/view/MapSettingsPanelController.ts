import { SearchComponent, setIcon } from "obsidian";
import { FRAME_RATE_MODE_OPTIONS } from "../bridge/FrameRateMode";
import { MAP_LAYOUT_PREFERENCE_OPTIONS } from "../bridge/LayoutPreference";
import {
  createActionButton,
  createCollapsibleSection,
  createRangeControl,
  createSelectControl,
  createToggleControl
} from "./MapSettingsUiElements";
import {
  MAX_RENDER_SCALE,
  MIN_RENDER_SCALE,
  MapSession,
  RENDER_SCALE_STEP
} from "./MapSession";
import { MapFilterSuggestionsController } from "./MapFilterSuggestionsController";
import { LandmarkSuggestionsController } from "./LandmarkSuggestionsController";

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

type MapSettingsPanelControllerDependencies = {
  onCopyScreenshotRequested?: () => Promise<void> | void;
};

const README_BASE_URL = "https://github.com/moonskorch/ReverySky-Plugin";
const SETTINGS_SECTION_HELP_URLS = {
  selection: `${README_BASE_URL}#filter`,
  egoGraph: `${README_BASE_URL}#ego-graph`,
  landmarks: `${README_BASE_URL}#landmarks`,
  graphics: `${README_BASE_URL}#visual-quality`,
  screenshot: `${README_BASE_URL}#screenshot`
} as const;

/**
 * Owns the settings-panel UI state machine and keeps the DOM synchronized with `MapSession`.
 */
export class MapSettingsPanelController {
  private filterMessageEl: HTMLElement | null = null;
  private settingsPanelEl: HTMLElement | null = null;
  private settingsScrollAreaEl: HTMLElement | null = null;
  private settingsToggleButtonEl: HTMLButtonElement | null = null;
  private settingsSectionEl: HTMLElement | null = null;
  private settingsSectionToggleButtonEl: HTMLButtonElement | null = null;
  private settingsSectionContentEl: HTMLElement | null = null;
  private egoSectionEl: HTMLElement | null = null;
  private egoSectionToggleButtonEl: HTMLButtonElement | null = null;
  private egoSectionContentEl: HTMLElement | null = null;
  private egoMainToggleButtonEl: HTMLButtonElement | null = null;
  private egoDepthInputEl: HTMLInputElement | null = null;
  private egoDepthValueEl: HTMLElement | null = null;
  private egoNeighborLinksToggleButtonEl: HTMLButtonElement | null = null;
  private landmarksSectionEl: HTMLElement | null = null;
  private landmarksSectionToggleButtonEl: HTMLButtonElement | null = null;
  private landmarksSectionContentEl: HTMLElement | null = null;
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
  private landmarkSourceComponent: SearchComponent | null = null;
  private filterSuggestionsController: MapFilterSuggestionsController | null = null;
  private landmarkSourceSuggestionsController: LandmarkSuggestionsController | null = null;
  private screenshotButtonEl: HTMLButtonElement | null = null;
  private settingsPanelOpen = false;
  private settingsSectionCollapsed = true;
  private egoSectionCollapsed = true;
  private landmarksSectionCollapsed = true;
  private graphicsSectionCollapsed = true;
  private screenshotSectionCollapsed = true;

  constructor(
    private readonly session: MapSession,
    private readonly deps: MapSettingsPanelControllerDependencies = {}
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
    settingsToggleButton.className = "reverysky-map-settings-toggle";
    this.settingsToggleButtonEl = settingsToggleButton;
    settingsToggleButton.setAttribute("aria-label", "Open filters");
    setIcon(settingsToggleButton, "settings");
    const toggleSettingsPanel = () => {
      const nextOpen = !this.settingsPanelOpen;
      this.setSettingsPanelOpen(nextOpen);
      if (nextOpen) {
        this.syncSearchComponentValue();
        this.refreshFilterMessage();
      }
    };
    settingsToggleButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleSettingsPanel();
    });
    settingsToggleButton.addEventListener("click", (event) => {
      if (event.detail !== 0) {
        return;
      }
      event.preventDefault();
      toggleSettingsPanel();
    });

    const settingsContainer = createChild(root, "div");
    settingsContainer.className = "reverysky-map-settings-panel";
    this.settingsPanelEl = settingsContainer;
    const settingsScrollArea = createChild(settingsContainer as ObsidianHTMLElement, "div");
    settingsScrollArea.className = "reverysky-map-settings-panel-body";
    this.settingsScrollAreaEl = settingsScrollArea;
    settingsScrollArea.addEventListener("scroll", () => {
      this.filterSuggestionsController?.position();
      this.landmarkSourceSuggestionsController?.position();
    });

    const settingsSection = createCollapsibleSection(settingsScrollArea, {
      className: "reverysky-map-selection-section",
      label: "Selection",
      helpUrl: SETTINGS_SECTION_HELP_URLS.selection,
      onToggle: () => {
        this.setSettingsSectionCollapsed(!this.settingsSectionCollapsed);
      }
    });
    this.settingsSectionEl = settingsSection.section;
    this.settingsSectionToggleButtonEl = settingsSection.toggleButton;
    this.settingsSectionContentEl = settingsSection.content;

    const panelCloseButton = createChild(settingsSection.actions as ObsidianHTMLElement, "button");
    panelCloseButton.type = "button";
    panelCloseButton.className = "reverysky-map-settings-close";
    panelCloseButton.setAttribute("aria-label", "Close filters");
    setIcon(panelCloseButton, "x");
    const closeSettingsPanel = (event?: Event) => {
      event?.preventDefault();
      this.setSettingsPanelOpen(false);
    };
    panelCloseButton.addEventListener("mousedown", (event) => {
      closeSettingsPanel(event);
    });
    panelCloseButton.addEventListener("click", (event) => {
      closeSettingsPanel(event);
    });

    const selectionSectionContent = settingsSection.content;

    const filterSearchArea = createChild(selectionSectionContent as ObsidianHTMLElement, "div");
    filterSearchArea.className = "reverysky-map-filter-search-area";

    const filterSearchLabel = createChild(filterSearchArea as ObsidianHTMLElement, "div");
    filterSearchLabel.className = "reverysky-map-settings-field-label";
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
        this.setSettingsPanelOpen(true);
      }
    });
    this.searchComponent.onChange((value) => {
      this.filterSuggestionsController?.handleInputChanged(value);
    });

    this.filterMessageEl = createChild(selectionSectionContent as ObsidianHTMLElement, "div");
    this.filterMessageEl.className = "reverysky-map-filter-message";

    const toggleTags = (event: Event) => {
      event.preventDefault();
      const uiState = this.session.getFilterUiState();
      this.session.setShowTags(!uiState.showTags);
      this.refreshTagsToggleUi();
    };
    const tagsToggle = createToggleControl(selectionSectionContent, {
      rowClassName: "reverysky-map-tags-toggle-row",
      buttonClassName: "reverysky-map-tags-toggle",
      thumbClassName: "reverysky-map-tags-toggle-thumb",
      label: "Tags",
      ariaLabel: "Toggle tags",
      onToggle: toggleTags
    });
    this.tagsToggleButtonEl = tagsToggle.button;

    const layoutControl = createSelectControl(selectionSectionContent, {
      label: "Layout",
      ariaLabel: "Select layout",
      options: MAP_LAYOUT_PREFERENCE_OPTIONS,
      onChange: (select) => {
        this.session.setMapLayoutPreference(select.value);
        this.refreshLayoutDropdownUi();
      }
    });
    this.layoutDropdownEl = layoutControl.select;

    const egoSection = createCollapsibleSection(settingsScrollArea, {
      className: "reverysky-map-ego-section",
      label: "Ego Graph",
      helpUrl: SETTINGS_SECTION_HELP_URLS.egoGraph,
      onToggle: () => {
        this.setEgoSectionCollapsed(!this.egoSectionCollapsed);
      }
    });
    this.egoSectionEl = egoSection.section;
    this.egoSectionToggleButtonEl = egoSection.toggleButton;
    this.egoSectionContentEl = egoSection.content;
    const egoSectionContent = egoSection.content;

    const toggleEgo = (event: Event) => {
      event.preventDefault();
      const uiState = this.session.getFilterUiState();
      this.session.setEgoEnabled(!uiState.egoEnabled);
      this.refreshEgoControlsUi();
    };
    const egoToggle = createToggleControl(egoSectionContent, {
      rowClassName: "reverysky-map-ego-toggle-row",
      buttonClassName: "reverysky-map-ego-toggle",
      thumbClassName: "reverysky-map-ego-toggle-thumb",
      label: "Ego mode",
      ariaLabel: "Toggle Ego mode",
      onToggle: toggleEgo
    });
    this.egoMainToggleButtonEl = egoToggle.button;

    const egoDepth = createRangeControl(egoSectionContent, {
      sectionClassName: "reverysky-map-ego-depth-section",
      inputClassName: "reverysky-map-ego-depth-input",
      valueClassName: "reverysky-map-ego-depth-value",
      messageClassName: "reverysky-map-ego-depth-message reverysky-map-range-control-message--hidden",
      label: "Depth",
      ariaLabel: "Ego Graph depth",
      min: "1",
      max: "5",
      step: "1",
      onInput: (input) => {
        this.session.setEgoDepth(input.value);
        this.refreshEgoControlsUi();
      }
    });
    this.egoDepthInputEl = egoDepth.input;
    this.egoDepthValueEl = egoDepth.value;

    const toggleEgoNeighborLinks = (event: Event) => {
      event.preventDefault();
      const uiState = this.session.getFilterUiState();
      this.session.setEgoNeighborLinksEnabled(!uiState.egoNeighborLinksEnabled);
      this.refreshEgoControlsUi();
    };
    const neighborLinksToggle = createToggleControl(egoSectionContent, {
      rowClassName: "reverysky-map-ego-neighbor-links-toggle-row",
      buttonClassName: "reverysky-map-ego-neighbor-links-toggle",
      thumbClassName: "reverysky-map-ego-neighbor-links-toggle-thumb",
      label: "Neighbor links",
      ariaLabel: "Toggle neighbor links",
      onToggle: toggleEgoNeighborLinks
    });
    this.egoNeighborLinksToggleButtonEl = neighborLinksToggle.button;

    const landmarksSection = createCollapsibleSection(settingsScrollArea, {
      className: "reverysky-map-landmarks-section",
      label: "Landmarks",
      helpUrl: SETTINGS_SECTION_HELP_URLS.landmarks,
      onToggle: () => {
        this.setLandmarksSectionCollapsed(!this.landmarksSectionCollapsed);
      }
    });
    this.landmarksSectionEl = landmarksSection.section;
    this.landmarksSectionToggleButtonEl = landmarksSection.toggleButton;
    this.landmarksSectionContentEl = landmarksSection.content;
    const landmarksSectionContent = landmarksSection.content;

    const landmarkSourceArea = createChild(landmarksSectionContent as ObsidianHTMLElement, "div");
    landmarkSourceArea.className = "reverysky-map-filter-search-area reverysky-map-landmark-source-search-area";

    const landmarkSourceLabel = createChild(landmarkSourceArea as ObsidianHTMLElement, "div");
    landmarkSourceLabel.className = "reverysky-map-settings-field-label";
    landmarkSourceLabel.textContent = "Landmark source";

    const landmarkSourceHost = createChild(landmarkSourceArea as ObsidianHTMLElement, "div");
    this.landmarkSourceComponent = new SearchComponent(landmarkSourceHost);
    this.landmarkSourceComponent.setPlaceholder("Property name");
    this.landmarkSourceSuggestionsController = new LandmarkSuggestionsController({
      inputEl: this.landmarkSourceComponent.inputEl,
      rootEl: root,
      anchorEl: landmarkSourceArea,
      getValue: () => this.landmarkSourceComponent?.getValue() ?? this.session.getFilterUiState().landmarkSource,
      getCommittedValue: () => this.session.getFilterUiState().landmarkSource,
      setValue: (value) => {
        this.landmarkSourceComponent?.setValue(value);
      },
      commitValue: (value) => {
        this.session.setLandmarkSource(value);
      },
      getSuggestions: (query) => this.session.getLandmarkSourcePropertySuggestions(query),
      openPanel: () => {
        this.setSettingsPanelOpen(true);
      }
    });
    this.landmarkSourceComponent.onChange((value) => {
      this.landmarkSourceSuggestionsController?.handleInputChanged(value);
    });

    const graphicsSection = createCollapsibleSection(settingsScrollArea, {
      className: "reverysky-map-graphics-section",
      label: "Graphics",
      helpUrl: SETTINGS_SECTION_HELP_URLS.graphics,
      onToggle: () => {
        this.setGraphicsSectionCollapsed(!this.graphicsSectionCollapsed);
      }
    });
    this.graphicsSectionEl = graphicsSection.section;
    this.graphicsSectionToggleButtonEl = graphicsSection.toggleButton;
    this.graphicsSectionContentEl = graphicsSection.content;
    const graphicsSectionContent = graphicsSection.content;

    const renderScale = createRangeControl(graphicsSectionContent, {
      sectionClassName: "reverysky-map-render-scale-section",
      inputClassName: "reverysky-map-render-scale-input",
      valueClassName: "reverysky-map-render-scale-value",
      messageClassName: "reverysky-map-render-scale-message reverysky-map-render-scale-message--hidden",
      label: "Render scale",
      ariaLabel: "Render scale",
      min: String(MIN_RENDER_SCALE),
      max: String(MAX_RENDER_SCALE),
      step: String(RENDER_SCALE_STEP),
      onInput: (input) => {
        this.session.setRenderScale(input.value);
        this.refreshRenderScaleUi();
      },
      onChange: () => {
        this.session.persistRenderScale();
      }
    });
    this.renderScaleInputEl = renderScale.input;
    this.renderScaleValueEl = renderScale.value;
    this.renderScaleMessageEl = renderScale.message;

    const frameRateModeControl = createSelectControl(graphicsSectionContent, {
      selectClassName: "reverysky-map-frame-rate-mode-select",
      label: "Frame rate",
      ariaLabel: "Select frame rate",
      options: FRAME_RATE_MODE_OPTIONS,
      onChange: (select) => {
        this.session.setFrameRateMode(select.value);
        this.refreshFrameRateModeDropdownUi();
      }
    });
    this.frameRateModeDropdownEl = frameRateModeControl.select;

    const screenshotSection = createCollapsibleSection(settingsScrollArea, {
      className: "reverysky-map-screenshot-section",
      label: "Screenshot",
      helpUrl: SETTINGS_SECTION_HELP_URLS.screenshot,
      onToggle: () => {
        this.setScreenshotSectionCollapsed(!this.screenshotSectionCollapsed);
      }
    });
    this.screenshotSectionEl = screenshotSection.section;
    this.screenshotSectionToggleButtonEl = screenshotSection.toggleButton;
    this.screenshotSectionContentEl = screenshotSection.content;
    const screenshotSectionContent = screenshotSection.content;

    this.screenshotButtonEl = createActionButton(screenshotSectionContent, {
      className: "reverysky-map-screenshot-button",
      label: "Copy screenshot",
      ariaLabel: "Copy graph screenshot",
      onClick: () => {
        void this.deps.onCopyScreenshotRequested?.();
      }
    });

    this.setSettingsPanelOpen(false);
    this.refreshCollapsibleSections();
    this.syncFromSession();
    return iframeHost;
  }

  syncFromSession(): void {
    this.syncSearchComponentValue();
    this.syncLandmarkSourceComponentValue();
    this.refreshFilterMessage();
    this.refreshTagsToggleUi();
    this.refreshLayoutDropdownUi();
    this.refreshEgoControlsUi();
    this.refreshRenderScaleUi();
    this.refreshFrameRateModeDropdownUi();
  }

  refreshSuggestions(): void {
    this.filterSuggestionsController?.refresh();
    this.landmarkSourceSuggestionsController?.refresh();
  }

  dispose(): void {
    this.filterSuggestionsController?.dispose();
    this.filterSuggestionsController = null;
    this.landmarkSourceSuggestionsController?.dispose();
    this.landmarkSourceSuggestionsController = null;
    this.searchComponent = null;
    this.landmarkSourceComponent = null;
    this.filterMessageEl = null;
    this.settingsPanelEl = null;
    this.settingsScrollAreaEl = null;
    this.settingsToggleButtonEl = null;
    this.settingsSectionEl = null;
    this.settingsSectionToggleButtonEl = null;
    this.settingsSectionContentEl = null;
    this.egoSectionEl = null;
    this.egoSectionToggleButtonEl = null;
    this.egoSectionContentEl = null;
    this.egoMainToggleButtonEl = null;
    this.egoDepthInputEl = null;
    this.egoDepthValueEl = null;
    this.egoNeighborLinksToggleButtonEl = null;
    this.landmarksSectionEl = null;
    this.landmarksSectionToggleButtonEl = null;
    this.landmarksSectionContentEl = null;
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
    this.settingsPanelOpen = false;
    this.settingsSectionCollapsed = true;
    this.egoSectionCollapsed = true;
    this.landmarksSectionCollapsed = true;
    this.graphicsSectionCollapsed = true;
    this.screenshotSectionCollapsed = true;
  }

  private setSettingsPanelOpen(isOpen: boolean): void {
    this.settingsPanelOpen = isOpen;
    if (!this.settingsPanelEl || !this.settingsToggleButtonEl) {
      return;
    }

    this.settingsPanelEl.classList.toggle("reverysky-map-settings-panel--closed", !isOpen);
    this.settingsToggleButtonEl.classList.toggle("reverysky-map-settings-toggle--hidden", isOpen);
    if (!isOpen) {
      this.filterSuggestionsController?.hide();
      this.landmarkSourceSuggestionsController?.hide();
    }
  }

  private setSettingsSectionCollapsed(isCollapsed: boolean): void {
    this.settingsSectionCollapsed = isCollapsed;
    if (isCollapsed) {
      this.filterSuggestionsController?.hide();
    }
    this.refreshCollapsibleSections();
  }

  private setLandmarksSectionCollapsed(isCollapsed: boolean): void {
    this.landmarksSectionCollapsed = isCollapsed;
    if (isCollapsed) {
      this.landmarkSourceSuggestionsController?.hide();
    }
    this.refreshCollapsibleSections();
  }

  private setGraphicsSectionCollapsed(isCollapsed: boolean): void {
    this.graphicsSectionCollapsed = isCollapsed;
    this.refreshCollapsibleSections();
  }

  private setEgoSectionCollapsed(isCollapsed: boolean): void {
    this.egoSectionCollapsed = isCollapsed;
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
      this.egoSectionEl,
      this.egoSectionToggleButtonEl,
      this.egoSectionContentEl,
      this.egoSectionCollapsed,
      "Ego Graph"
    );
    this.refreshCollapsibleSection(
      this.landmarksSectionEl,
      this.landmarksSectionToggleButtonEl,
      this.landmarksSectionContentEl,
      this.landmarksSectionCollapsed,
      "Landmarks"
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
    section?.classList.toggle("reverysky-map-settings-section--collapsed", isCollapsed);
    content?.classList.toggle("reverysky-map-settings-section-content--collapsed", isCollapsed);
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

  private syncLandmarkSourceComponentValue(): void {
    if (!this.landmarkSourceComponent) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.landmarkSourceComponent.getValue() === uiState.landmarkSource) {
      return;
    }

    this.landmarkSourceComponent.setValue(uiState.landmarkSource);
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

  private refreshEgoControlsUi(): void {
    const uiState = this.session.getFilterUiState();
    this.egoMainToggleButtonEl?.setAttribute("role", "switch");
    this.egoMainToggleButtonEl?.setAttribute("aria-checked", uiState.egoEnabled ? "true" : "false");
    if (this.egoDepthInputEl) {
      this.egoDepthInputEl.value = String(uiState.egoDepth);
    }
    if (this.egoDepthValueEl) {
      this.egoDepthValueEl.textContent = String(uiState.egoDepth);
    }
    this.egoNeighborLinksToggleButtonEl?.setAttribute("role", "switch");
    this.egoNeighborLinksToggleButtonEl?.setAttribute(
      "aria-checked",
      uiState.egoNeighborLinksEnabled ? "true" : "false"
    );
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
