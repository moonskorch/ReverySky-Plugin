import { SearchComponent, setIcon } from "obsidian";
import type { GraphEnginePreference } from "../bridge/BridgeTypes";
import { MapSession } from "./MapSession";

const FILTER_SUGGESTIONS_HIDE_DELAY_MS = 120;
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

type ObsidianHTMLElement = HTMLElement & {
  createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

// 0..3 map to the default, path, date, and tag suggestion panes.
type FilterSuggestionMode = 0 | 1 | 2 | 3;

/**
 * Owns the filter-panel UI state machine and keeps the DOM synchronized with `MapSession`.
 */
export class MapFilterPanelController {
  private filterSuggestionsHideTimer: ReturnType<typeof setTimeout> | null = null;
  private filterMessageEl: HTMLElement | null = null;
  private filterSuggestionsEl: HTMLElement | null = null;
  private filterPanelEl: HTMLElement | null = null;
  private filterToggleButtonEl: HTMLButtonElement | null = null;
  private tagsToggleButtonEl: HTMLButtonElement | null = null;
  private engineDropdownEl: HTMLSelectElement | null = null;
  private filterSuggestionMode: FilterSuggestionMode = 0;
  private searchComponent: SearchComponent | null = null;
  private filterPanelOpen = false;

  constructor(private readonly session: MapSession) {}

  render(container: HTMLElement): HTMLElement {
    const root = createChild(container as ObsidianHTMLElement, "div") as ObsidianHTMLElement;
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
      const uiState = this.session.getFilterUiState();
      this.session.setShowTags(!uiState.showTags);
      this.refreshTagsToggleUi();
    };
    tagsToggleButton.addEventListener("mousedown", toggleTags);
    tagsToggleButton.addEventListener("click", (event) => {
      const mouseEvent = event as MouseEvent;
      if (mouseEvent.detail !== 0) {
        return;
      }
      toggleTags(event);
    });

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
      this.session.setEnginePreference(engineDropdown.value);
      this.refreshEngineDropdownUi();
    });

    this.setFilterPanelOpen(false);
    this.syncFromSession();
    return iframeHost;
  }

  syncFromSession(): void {
    this.syncSearchComponentValue();
    this.refreshFilterMessage();
    this.refreshTagsToggleUi();
    this.refreshEngineDropdownUi();
  }

  refreshSuggestions(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    // The controller renders suggestion DOM, but the ranked suggestion data comes from the session cache.
    this.filterSuggestionsEl.replaceChildren();
    if (this.filterSuggestionMode === 1) {
      const currentQuery =
        this.searchComponent?.getValue() ?? this.session.getFilterUiState().pathFilterQuery;
      this.renderFolderSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    if (this.filterSuggestionMode === 2) {
      this.renderDateSuggestions(this.filterSuggestionsEl);
      return;
    }
    if (this.filterSuggestionMode === 3) {
      const currentQuery =
        this.searchComponent?.getValue() ?? this.session.getFilterUiState().pathFilterQuery;
      this.renderTagSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }

    this.renderOperatorSuggestions(this.filterSuggestionsEl);
  }

  dispose(): void {
    this.clearFilterSuggestionsHideTimer();
    this.searchComponent = null;
    this.filterMessageEl = null;
    this.filterSuggestionsEl = null;
    this.filterPanelEl = null;
    this.filterToggleButtonEl = null;
    this.tagsToggleButtonEl = null;
    this.engineDropdownEl = null;
    this.filterSuggestionMode = 0;
    this.filterPanelOpen = false;
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
    this.session.setFilterQuery(nextQuery);
    this.refreshFilterMessage();
    this.refreshSuggestions();
  }

  private showFilterSuggestions(mode: FilterSuggestionMode): void {
    if (!this.filterSuggestionsEl || !this.searchComponent) {
      return;
    }

    this.filterSuggestionMode = mode;
    this.setFilterPanelOpen(true);
    this.refreshSuggestions();
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsEl.style.display = "block";
  }

  private resolveAutoSuggestionMode(): FilterSuggestionMode {
    const uiState = this.session.getFilterUiState();
    const currentQuery =
      this.searchComponent?.inputEl?.value ?? this.searchComponent?.getValue() ?? uiState.pathFilterQuery;
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

    const presets = this.session.getDateFilterPresetSuggestions();
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
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Folders";

    const ranked = this.session.getFolderSuggestions(query);
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
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Tags";

    const ranked = this.session.getTagSuggestions(query);
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

  private syncSearchComponentValue(): void {
    if (!this.searchComponent) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.searchComponent.getValue() === uiState.pathFilterQuery) {
      return;
    }

    this.searchComponent.setValue(uiState.pathFilterQuery);
  }

  private refreshFilterMessage(): void {
    if (!this.filterMessageEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    const hasCustomMessage = uiState.pathFilterMessage.trim().length > 0;
    this.filterMessageEl.textContent = hasCustomMessage ? uiState.pathFilterMessage : "";
    this.filterMessageEl.style.display = hasCustomMessage ? "block" : "none";
    this.filterMessageEl.style.color = uiState.pathFilterParseValid
      ? "var(--text-muted)"
      : "var(--text-error)";
  }

  private refreshTagsToggleUi(): void {
    if (!this.tagsToggleButtonEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    this.tagsToggleButtonEl.setAttribute("role", "switch");
    this.tagsToggleButtonEl.setAttribute("aria-checked", uiState.showTags ? "true" : "false");
  }

  private refreshEngineDropdownUi(): void {
    if (!this.engineDropdownEl) {
      return;
    }

    const uiState = this.session.getFilterUiState();
    if (this.engineDropdownEl.value === uiState.enginePreference) {
      return;
    }

    this.engineDropdownEl.value = uiState.enginePreference;
  }

  private formatPathFilterTerm(folderPath: string): string {
    const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
    const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  private formatTagFilterTerm(tag: string): string {
    return `#${tag.trim().replace(/^#/, "")}`;
  }

  private clearFilterSuggestionsHideTimer(): void {
    if (!this.filterSuggestionsHideTimer) {
      return;
    }

    clearTimeout(this.filterSuggestionsHideTimer);
    this.filterSuggestionsHideTimer = null;
  }
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
