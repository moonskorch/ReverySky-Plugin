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

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

type MapSettingsPanelControllerDependencies = {
  onCopyScreenshotRequested?: () => Promise<void> | void;
};

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
  private localSectionEl: HTMLElement | null = null;
  private localSectionToggleButtonEl: HTMLButtonElement | null = null;
  private localSectionContentEl: HTMLElement | null = null;
  private localMainToggleButtonEl: HTMLButtonElement | null = null;
  private localDepthInputEl: HTMLInputElement | null = null;
  private localDepthValueEl: HTMLElement | null = null;
  private localNeighborLinksToggleButtonEl: HTMLButtonElement | null = null;
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
  private settingsPanelOpen = false;
  private settingsSectionCollapsed = true;
  private localSectionCollapsed = true;
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
    });

    const settingsSection = createCollapsibleSection(settingsScrollArea as ObsidianHTMLElement, {
      className: "reverysky-map-selection-section",
      label: "Selection",
      onToggle: () => {
        this.setSettingsSectionCollapsed(!this.settingsSectionCollapsed);
      }
    });
    this.settingsSectionEl = settingsSection.section;
    this.settingsSectionToggleButtonEl = settingsSection.toggleButton;
    this.settingsSectionContentEl = settingsSection.content;

    const panelCloseButton = createChild(settingsSection.header as ObsidianHTMLElement, "button");
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
    const tagsToggle = createToggleControl(selectionSectionContent as ObsidianHTMLElement, {
      rowClassName: "reverysky-map-tags-toggle-row",
      buttonClassName: "reverysky-map-tags-toggle",
      thumbClassName: "reverysky-map-tags-toggle-thumb",
      label: "Tags",
      ariaLabel: "Toggle tags",
      onToggle: toggleTags
    });
    this.tagsToggleButtonEl = tagsToggle.button;

    const layoutControl = createSelectControl(selectionSectionContent as ObsidianHTMLElement, {
      label: "Layout",
      ariaLabel: "Select layout",
      options: MAP_LAYOUT_PREFERENCE_OPTIONS,
      onChange: (select) => {
        this.session.setMapLayoutPreference(select.value);
        this.refreshLayoutDropdownUi();
      }
    });
    this.layoutDropdownEl = layoutControl.select;

    const localSection = createCollapsibleSection(settingsScrollArea as ObsidianHTMLElement, {
      className: "reverysky-map-local-section",
      label: "Ego Graph",
      onToggle: () => {
        this.setLocalSectionCollapsed(!this.localSectionCollapsed);
      }
    });
    this.localSectionEl = localSection.section;
    this.localSectionToggleButtonEl = localSection.toggleButton;
    this.localSectionContentEl = localSection.content;
    const localSectionContent = localSection.content;

    const toggleLocal = (event: Event) => {
      event.preventDefault();
      const uiState = this.session.getFilterUiState();
      this.session.setLocalEnabled(!uiState.localEnabled);
      this.refreshLocalControlsUi();
    };
    const localToggle = createToggleControl(localSectionContent as ObsidianHTMLElement, {
      rowClassName: "reverysky-map-local-toggle-row",
      buttonClassName: "reverysky-map-local-toggle",
      thumbClassName: "reverysky-map-local-toggle-thumb",
      label: "Ego mode",
      ariaLabel: "Toggle Ego mode",
      onToggle: toggleLocal
    });
    this.localMainToggleButtonEl = localToggle.button;

    const localDepth = createRangeControl(localSectionContent as ObsidianHTMLElement, {
      sectionClassName: "reverysky-map-local-depth-section",
      inputClassName: "reverysky-map-local-depth-input",
      valueClassName: "reverysky-map-local-depth-value",
      messageClassName: "reverysky-map-local-depth-message reverysky-map-range-control-message--hidden",
      label: "Depth",
      ariaLabel: "Ego Graph depth",
      min: "1",
      max: "5",
      step: "1",
      onInput: (input) => {
        this.session.setLocalDepth(input.value);
        this.refreshLocalControlsUi();
      }
    });
    this.localDepthInputEl = localDepth.input;
    this.localDepthValueEl = localDepth.value;

    const toggleNeighborLinks = (event: Event) => {
      event.preventDefault();
      const uiState = this.session.getFilterUiState();
      this.session.setLocalNeighborLinksEnabled(!uiState.localNeighborLinksEnabled);
      this.refreshLocalControlsUi();
    };
    const neighborLinksToggle = createToggleControl(localSectionContent as ObsidianHTMLElement, {
      rowClassName: "reverysky-map-neighbor-links-toggle-row",
      buttonClassName: "reverysky-map-neighbor-links-toggle",
      thumbClassName: "reverysky-map-neighbor-links-toggle-thumb",
      label: "Neighbor links",
      ariaLabel: "Toggle neighbor links",
      onToggle: toggleNeighborLinks
    });
    this.localNeighborLinksToggleButtonEl = neighborLinksToggle.button;

    const graphicsSection = createCollapsibleSection(settingsScrollArea as ObsidianHTMLElement, {
      className: "reverysky-map-graphics-section",
      label: "Graphics",
      onToggle: () => {
        this.setGraphicsSectionCollapsed(!this.graphicsSectionCollapsed);
      }
    });
    this.graphicsSectionEl = graphicsSection.section;
    this.graphicsSectionToggleButtonEl = graphicsSection.toggleButton;
    this.graphicsSectionContentEl = graphicsSection.content;
    const graphicsSectionContent = graphicsSection.content;

    const renderScale = createRangeControl(graphicsSectionContent as ObsidianHTMLElement, {
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

    const frameRateModeControl = createSelectControl(graphicsSectionContent as ObsidianHTMLElement, {
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

    const screenshotSection = createCollapsibleSection(settingsScrollArea as ObsidianHTMLElement, {
      className: "reverysky-map-screenshot-section",
      label: "Screenshot",
      onToggle: () => {
        this.setScreenshotSectionCollapsed(!this.screenshotSectionCollapsed);
      }
    });
    this.screenshotSectionEl = screenshotSection.section;
    this.screenshotSectionToggleButtonEl = screenshotSection.toggleButton;
    this.screenshotSectionContentEl = screenshotSection.content;
    const screenshotSectionContent = screenshotSection.content;

    this.screenshotButtonEl = createActionButton(screenshotSectionContent as ObsidianHTMLElement, {
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
    this.refreshFilterMessage();
    this.refreshTagsToggleUi();
    this.refreshLayoutDropdownUi();
    this.refreshLocalControlsUi();
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
    this.settingsPanelEl = null;
    this.settingsScrollAreaEl = null;
    this.settingsToggleButtonEl = null;
    this.settingsSectionEl = null;
    this.settingsSectionToggleButtonEl = null;
    this.settingsSectionContentEl = null;
    this.localSectionEl = null;
    this.localSectionToggleButtonEl = null;
    this.localSectionContentEl = null;
    this.localMainToggleButtonEl = null;
    this.localDepthInputEl = null;
    this.localDepthValueEl = null;
    this.localNeighborLinksToggleButtonEl = null;
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
    this.localSectionCollapsed = true;
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
    }
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

  private setLocalSectionCollapsed(isCollapsed: boolean): void {
    this.localSectionCollapsed = isCollapsed;
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
      this.localSectionEl,
      this.localSectionToggleButtonEl,
      this.localSectionContentEl,
      this.localSectionCollapsed,
      "Ego Graph"
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

  private refreshLocalControlsUi(): void {
    const uiState = this.session.getFilterUiState();
    this.localMainToggleButtonEl?.setAttribute("role", "switch");
    this.localMainToggleButtonEl?.setAttribute("aria-checked", uiState.localEnabled ? "true" : "false");
    if (this.localDepthInputEl) {
      this.localDepthInputEl.value = String(uiState.localDepth);
    }
    if (this.localDepthValueEl) {
      this.localDepthValueEl.textContent = String(uiState.localDepth);
    }
    this.localNeighborLinksToggleButtonEl?.setAttribute("role", "switch");
    this.localNeighborLinksToggleButtonEl?.setAttribute(
      "aria-checked",
      uiState.localNeighborLinksEnabled ? "true" : "false"
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
