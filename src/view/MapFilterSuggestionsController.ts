import { MapSession } from "./MapSession";

const FILTER_SUGGESTIONS_HIDE_DELAY_MS = 120;
let nextFilterSuggestionsId = 0;

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
};

// 0..3 map to the default, path, date, and tag suggestion panes.
type FilterSuggestionMode = 0 | 1 | 2 | 3;

type MapFilterSuggestionsControllerOptions = {
  session: MapSession;
  inputEl: HTMLInputElement;
  rootEl: ObsidianHTMLElement;
  anchorEl: HTMLElement;
  getQuery: () => string;
  setQueryValue: (value: string) => void;
  commitQuery: (query: string) => void;
  openPanel: () => void;
};

export class MapFilterSuggestionsController {
  private readonly filterSuggestionsId = `reverysky-map-filter-suggestions-${++nextFilterSuggestionsId}`;
  private readonly session: MapSession;
  private readonly inputEl: HTMLInputElement;
  private readonly rootEl: ObsidianHTMLElement;
  private readonly anchorEl: HTMLElement;
  private readonly getQuery: () => string;
  private readonly setQueryValue: (value: string) => void;
  private readonly commitQuery: (query: string) => void;
  private readonly openPanel: () => void;
  private filterSuggestionsHideTimer: number | null = null;
  private filterSuggestionsHideTimerWindow: Window | null = null;
  private filterSuggestionsEl: HTMLElement | null = null;
  private filterSuggestionsListboxEl: HTMLElement | null = null;
  private filterSuggestionMode: FilterSuggestionMode = 0;
  private filterSuggestionActiveIndex = -1;

  constructor(options: MapFilterSuggestionsControllerOptions) {
    this.session = options.session;
    this.inputEl = options.inputEl;
    this.rootEl = options.rootEl;
    this.anchorEl = options.anchorEl;
    this.getQuery = options.getQuery;
    this.setQueryValue = options.setQueryValue;
    this.commitQuery = options.commitQuery;
    this.openPanel = options.openPanel;

    this.inputEl.setAttribute("role", "combobox");
    this.inputEl.setAttribute("aria-label", "Search in filter");
    this.inputEl.setAttribute("aria-haspopup", "listbox");
    this.inputEl.setAttribute("aria-autocomplete", "list");
    this.inputEl.setAttribute("aria-expanded", "false");
    this.inputEl.setAttribute("aria-controls", this.filterSuggestionsId);
    this.inputEl.addEventListener("focus", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.inputEl.addEventListener("click", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.inputEl.addEventListener("blur", () => {
      this.scheduleHideFilterSuggestions();
    });
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      this.handleKeydown(event);
    });

    this.filterSuggestionsEl = createChild(this.rootEl, "div");
    this.filterSuggestionsEl.className =
      "reverysky-map-filter-suggestions reverysky-map-filter-suggestions--overlay";
    this.filterSuggestionsEl.classList.add("reverysky-map-filter-suggestions--hidden");
  }

  handleInputChanged(nextQuery: string): void {
    this.commitQuery(nextQuery);
    this.refreshAutoFilterSuggestions();
  }

  refresh(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    const currentQuery = this.getQuery();
    // The controller renders suggestion DOM, but the ranked suggestion data comes from the session cache.
    this.filterSuggestionsListboxEl = null;
    this.filterSuggestionsEl.replaceChildren();
    if (this.filterSuggestionMode === 1) {
      this.renderFolderSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    if (this.filterSuggestionMode === 2) {
      this.renderDateSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    if (this.filterSuggestionMode === 3) {
      this.renderTagSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }

    this.renderOperatorSuggestions(this.filterSuggestionsEl, currentQuery);
  }

  hide(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    this.filterSuggestionMode = 0;
    this.filterSuggestionActiveIndex = -1;
    this.filterSuggestionsEl.classList.add("reverysky-map-filter-suggestions--hidden");
    this.inputEl.setAttribute("aria-expanded", "false");
    this.inputEl.removeAttribute("aria-activedescendant");
  }

  position(): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    const anchorRect = this.anchorEl.getBoundingClientRect();
    const rootRect = this.rootEl.getBoundingClientRect();
    const gapPx = 4;
    const rootPaddingPx = 8;
    const maxHeight = Math.max(0, rootRect.bottom - anchorRect.bottom - gapPx - rootPaddingPx);

    this.filterSuggestionsEl.setCssStyles({
      left: "auto",
      right: `${rootRect.right - anchorRect.right}px`,
      top: `${anchorRect.bottom - rootRect.top + gapPx}px`
    });
    this.filterSuggestionsEl.setCssProps({
      "--reverysky-filter-suggestions-anchor-width": `${anchorRect.width}px`,
      "--reverysky-filter-suggestions-max-height": `${maxHeight}px`
    });
  }

  dispose(): void {
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsEl = null;
    this.filterSuggestionsListboxEl = null;
    this.filterSuggestionMode = 0;
    this.filterSuggestionActiveIndex = -1;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.isFilterSuggestionsVisible()) {
        this.hide();
        return;
      }

      this.setQueryValue("");
      this.commitQuery("");
      this.showFilterSuggestions(0);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.moveOrOpenFilterSuggestionSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.moveOrOpenFilterSuggestionSelection(-1);
      return;
    }

    if (event.key === "Enter" && this.filterSuggestionActiveIndex >= 0) {
      event.preventDefault();
      this.activateFilterSuggestionAtIndex(this.filterSuggestionActiveIndex);
    }
  }

  private refreshAutoFilterSuggestions(): void {
    const autoSuggestionMode = this.resolveAutoSuggestionMode();
    if (autoSuggestionMode !== 0) {
      this.showFilterSuggestions(autoSuggestionMode);
      return;
    }

    if (this.isFilterSuggestionsVisible()) {
      this.filterSuggestionMode = 0;
      this.filterSuggestionActiveIndex = 0;
      this.refresh();
    }
  }

  private showFilterSuggestions(mode: FilterSuggestionMode): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    this.filterSuggestionMode = mode;
    this.filterSuggestionActiveIndex = 0;
    this.openPanel();
    this.refresh();
    this.clearFilterSuggestionsHideTimer();
    this.position();
    this.filterSuggestionsEl.classList.remove("reverysky-map-filter-suggestions--hidden");
    this.inputEl.setAttribute("aria-expanded", "true");
  }

  private resolveAutoSuggestionMode(): FilterSuggestionMode {
    const currentQuery = this.inputEl.value ?? this.getQuery();
    if (/(^|\s)-?path:\s*$/i.test(currentQuery)) {
      return 1;
    }
    if (/(^|\s)-?date:\s*$/i.test(currentQuery)) {
      return 2;
    }
    if (/(^|\s)-?tag:\s*$/i.test(currentQuery)) {
      return 3;
    }
    if (/\s$/.test(currentQuery)) {
      return 0;
    }
    if (/(^|\s)-?path:\s*(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 1;
    }
    if (/(^|\s)-?date:\s*[^\s]*$/i.test(currentQuery)) {
      return 2;
    }
    if (/(^|\s)-?tag:\s*(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 3;
    }
    return 0;
  }

  private scheduleHideFilterSuggestions(): void {
    this.clearFilterSuggestionsHideTimer();
    const timerWindow = this.filterSuggestionsEl?.ownerDocument.defaultView ?? window;
    this.filterSuggestionsHideTimerWindow = timerWindow;
    this.filterSuggestionsHideTimer = timerWindow.setTimeout(() => {
      this.filterSuggestionsHideTimer = null;
      this.filterSuggestionsHideTimerWindow = null;
      this.hide();
    }, FILTER_SUGGESTIONS_HIDE_DELAY_MS);
  }

  private isFilterSuggestionsVisible(): boolean {
    return (
      this.filterSuggestionsEl !== null &&
      !this.filterSuggestionsEl.classList.contains("reverysky-map-filter-suggestions--hidden")
    );
  }

  private applyPathSuggestionOperator(): void {
    const currentValue = this.getQuery();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsPathOperator = /(^|\s)-?path:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsPathOperator
      ? currentValue
      : this.applyFilterOperatorToActiveRootPrefix(currentValue, "path:");

    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(1);
  }

  private applyDateSuggestionOperator(): void {
    const currentValue = this.getQuery();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsDateOperator = /(^|\s)-?date:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsDateOperator
      ? currentValue
      : this.applyFilterOperatorToActiveRootPrefix(currentValue, "date:");

    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(2);
  }

  private applyTagSuggestionOperator(): void {
    const currentValue = this.getQuery();
    const hasActiveTrailingTagOperator = /(^|\s)-?tag:\s*(?:"[^"]*"|[^\s]*)$/i.test(currentValue);
    const nextValue = hasActiveTrailingTagOperator
      ? currentValue
      : this.applyFilterOperatorToActiveRootPrefix(currentValue, "tag:");

    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(3);
  }

  private applyDateValueSuggestion(suffix: string): void {
    const currentValue = this.getQuery();
    const replaceActiveDateTermPattern = /(^|\s)(-?date:)\s*[^\s]*$/i;

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

    nextValue = this.ensureTrailingSuggestionSeparator(nextValue);
    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(0);
  }

  private applyPathValueSuggestion(folderPath: string): void {
    const term = this.formatPathFilterTerm(folderPath);
    const currentValue = this.getQuery();
    const replaceActivePathTermPattern = /(^|\s)(-?path:)\s*(?:"[^"]*"|[^\s]*)$/i;

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

    nextValue = this.ensureTrailingSuggestionSeparator(nextValue);
    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(0);
  }

  private applyTagValueSuggestion(tag: string): void {
    const currentValue = this.getQuery();
    const term = this.formatTagFilterTerm(tag);
    const replaceActiveTagTermPattern = /(^|\s)(-?tag:)\s*(?:"[^"]*"|[^\s]*)$/i;

    let nextValue: string;
    if (replaceActiveTagTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActiveTagTermPattern,
        (_match, prefix: string, operator: string) => `${prefix}${operator}${term}`
      );
    } else {
      nextValue = `${currentValue}${/\s$/.test(currentValue) || currentValue.length === 0 ? "" : " "}tag:${term}`;
    }

    nextValue = this.ensureTrailingSuggestionSeparator(nextValue);
    this.setQueryValue(nextValue);
    this.commitQuery(nextValue);
    this.showFilterSuggestions(0);
  }

  private renderOperatorSuggestions(host: HTMLElement, query: string): void {
    const normalizedQuery = this.normalizeOperatorSuggestionSearchTerm(
      this.extractActiveRootFilterTermValue(query)
    );
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Search settings";
    const listbox = this.createFilterSuggestionsListbox(host);

    const options = [
      {
        key: "path",
        className: "reverysky-map-filter-suggestion-option",
        label: "path:",
        description: " match in file path",
        onSelect: () => this.applyPathSuggestionOperator()
      },
      {
        key: "date",
        className: "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked",
        label: "date:",
        description: " match note date",
        onSelect: () => this.applyDateSuggestionOperator()
      },
      {
        key: "tag",
        className: "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked",
        label: "tag:",
        description: " match note tag",
        onSelect: () => this.applyTagSuggestionOperator()
      }
    ].filter((option) => normalizedQuery.length === 0 || option.key.startsWith(normalizedQuery));

    if (!options.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No matches found";
      this.syncFilterSuggestionActiveState();
      return;
    }

    for (const optionData of options) {
      const option = createChild(listbox as ObsidianHTMLElement, "div");
      option.className = optionData.className;
      this.prepareFilterSuggestionOption(option);

      const strong = createChild(option as ObsidianHTMLElement, "span");
      strong.className = "reverysky-map-suggestion-key";
      strong.textContent = optionData.label;

      const desc = createChild(option as ObsidianHTMLElement, "span");
      desc.className = "reverysky-map-suggestion-desc";
      desc.textContent = optionData.description;

      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        optionData.onSelect();
      });
    }

    this.syncFilterSuggestionActiveState();
  }

  private renderDateSuggestions(host: HTMLElement, query: string): void {
    const normalizedQuery = this.normalizeDateFilterSearchTerm(this.extractActiveDateFilterTermValue(query));
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Date presets";
    const listbox = this.createFilterSuggestionsListbox(host);

    const presets = this.session.getDateFilterPresetSuggestions().filter((suggestion) => {
      if (normalizedQuery.length === 0) {
        return true;
      }

      const dateKey = this.normalizeDateFilterSearchTerm(`date:${suggestion.suffix}`);
      const labelKey = this.normalizeDateFilterSearchTerm(suggestion.label);
      return dateKey.startsWith(normalizedQuery) || labelKey.startsWith(normalizedQuery);
    });

    if (!presets.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No presets found";
      this.syncFilterSuggestionActiveState();
      return;
    }

    for (const suggestion of presets) {
      const option = createChild(listbox as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-date-suggestion-option";
      this.prepareFilterSuggestionOption(option);

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

    this.syncFilterSuggestionActiveState();
  }

  private renderFolderSuggestions(host: HTMLElement, query: string): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Folders";
    const listbox = this.createFilterSuggestionsListbox(host);

    const ranked = this.session.getFolderSuggestions(query);
    if (!ranked.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No folders found";
      this.syncFilterSuggestionActiveState();
      return;
    }

    for (const suggestion of ranked) {
      const option = createChild(listbox as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option";
      this.prepareFilterSuggestionOption(option);
      option.textContent = suggestion.path;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyPathValueSuggestion(suggestion.path);
      });
    }

    this.syncFilterSuggestionActiveState();
  }

  private renderTagSuggestions(host: HTMLElement, query: string): void {
    const suggestionsTitle = createChild(host as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Tags";
    const listbox = this.createFilterSuggestionsListbox(host);

    const ranked = this.session.getTagSuggestions(query);
    if (!ranked.length) {
      const emptyHint = createChild(host as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No tags found";
      this.syncFilterSuggestionActiveState();
      return;
    }

    for (const suggestion of ranked) {
      const option = createChild(listbox as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option reverysky-map-tag-suggestion-option";
      this.prepareFilterSuggestionOption(option);
      option.textContent = suggestion.displayTag;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyTagValueSuggestion(suggestion.tag);
      });
    }

    this.syncFilterSuggestionActiveState();
  }

  private formatPathFilterTerm(folderPath: string): string {
    const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
    const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    return needsQuotes ? `"${escaped}"` : escaped;
  }

  private formatTagFilterTerm(tag: string): string {
    return `#${tag.trim().replace(/^#/, "")}`;
  }

  private normalizeOperatorSuggestionSearchTerm(value: string): string {
    return value.trim().toLowerCase().replace(/^-/, "").replace(/:$/, "");
  }

  private extractActiveRootFilterTermValue(query: string): string {
    const activePattern = /(^|\s)(-?[^\s:]*)$/;
    const match = query.match(activePattern);
    const activeTerm = match?.[2] ?? "";
    return activeTerm.includes(":") ? "" : activeTerm;
  }

  private applyFilterOperatorToActiveRootPrefix(currentValue: string, operator: string): string {
    if (currentValue.trim().length === 0) {
      return operator;
    }

    const activePrefixMatch = currentValue.match(/(^|\s)(-?[^\s:]*)$/);
    const activePrefix = activePrefixMatch?.[2] ?? "";
    const normalizedActivePrefix = this.normalizeOperatorSuggestionSearchTerm(activePrefix);
    const operatorKey = operator.replace(/:$/, "");
    if (normalizedActivePrefix.length > 0 && operatorKey.startsWith(normalizedActivePrefix)) {
      return currentValue.replace(/(^|\s)(-?[^\s:]*)$/, (_match, prefix: string) => `${prefix}${operator}`);
    }

    return `${currentValue}${/\s$/.test(currentValue) ? "" : " "}${operator}`;
  }

  private normalizeDateFilterSearchTerm(value: string): string {
    return value.trim().toLowerCase().replace(/^(-?date:)/, "").replace(/^[<>=]+/, "").trim();
  }

  private ensureTrailingSuggestionSeparator(value: string): string {
    return /\s$/.test(value) ? value : `${value} `;
  }

  private extractActiveDateFilterTermValue(query: string): string {
    const activePattern = /(^|\s)-?date:\s*([^\s]*)$/i;
    const match = query.match(activePattern);
    return match?.[2] ?? "";
  }

  private moveFilterSuggestionSelection(delta: number): void {
    if (!this.filterSuggestionsEl || this.filterSuggestionsEl.classList.contains("reverysky-map-filter-suggestions--hidden")) {
      return;
    }

    const options = this.getFilterSuggestionOptionElements();
    if (!options.length) {
      return;
    }

    const currentIndex = this.filterSuggestionActiveIndex >= 0 ? this.filterSuggestionActiveIndex : 0;
    const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
    this.filterSuggestionActiveIndex = nextIndex;
    this.syncFilterSuggestionActiveState();
  }

  private moveOrOpenFilterSuggestionSelection(delta: number): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    if (!this.filterSuggestionsEl.classList.contains("reverysky-map-filter-suggestions--hidden")) {
      this.moveFilterSuggestionSelection(delta);
      return;
    }

    this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    const options = this.getFilterSuggestionOptionElements();
    if (options.length && delta < 0) {
      this.filterSuggestionActiveIndex = options.length - 1;
      this.syncFilterSuggestionActiveState();
    }
  }

  private activateFilterSuggestionAtIndex(index: number): void {
    const option = this.getFilterSuggestionOptionElements()[index];
    if (!option) {
      return;
    }

    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  private getFilterSuggestionOptionElements(): HTMLElement[] {
    if (!this.filterSuggestionsListboxEl) {
      return [];
    }

    return Array.from(this.filterSuggestionsListboxEl.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  private syncFilterSuggestionActiveState(): void {
    if (!this.filterSuggestionsEl || !this.filterSuggestionsListboxEl) {
      return;
    }

    const options = this.getFilterSuggestionOptionElements();
    if (!options.length) {
      this.filterSuggestionActiveIndex = -1;
      this.inputEl.removeAttribute("aria-activedescendant");
      return;
    }

    if (this.filterSuggestionActiveIndex < 0 || this.filterSuggestionActiveIndex >= options.length) {
      this.filterSuggestionActiveIndex = 0;
    }

    for (const [index, option] of options.entries()) {
      const isActive = index === this.filterSuggestionActiveIndex;
      option.classList.toggle("reverysky-map-filter-suggestion-option--active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
      option.id = `${this.filterSuggestionsListboxEl.id}-option-${index}`;
      if (isActive) {
        this.scrollActiveSuggestionIntoPane(option);
        this.inputEl.setAttribute("aria-activedescendant", option.id);
      }
    }
  }

  private scrollActiveSuggestionIntoPane(option: HTMLElement): void {
    if (!this.filterSuggestionsEl) {
      return;
    }

    const pane = this.filterSuggestionsEl;
    const paneTop = pane.scrollTop;
    const paneBottom = paneTop + pane.clientHeight;
    const optionTop = option.offsetTop;
    const optionBottom = optionTop + option.offsetHeight;

    if (optionTop < paneTop) {
      pane.scrollTop = optionTop;
      return;
    }

    if (optionBottom > paneBottom) {
      pane.scrollTop = optionBottom - pane.clientHeight;
    }
  }

  private createFilterSuggestionsListbox(host: HTMLElement): HTMLElement {
    const listbox = createChild(host as ObsidianHTMLElement, "div");
    listbox.id = this.filterSuggestionsId;
    listbox.setAttribute("role", "listbox");
    this.filterSuggestionsListboxEl = listbox;
    return listbox;
  }

  private prepareFilterSuggestionOption(option: HTMLElement): void {
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
  }

  private clearFilterSuggestionsHideTimer(): void {
    if (!this.filterSuggestionsHideTimer) {
      return;
    }

    (this.filterSuggestionsHideTimerWindow ?? window).clearTimeout(this.filterSuggestionsHideTimer);
    this.filterSuggestionsHideTimer = null;
    this.filterSuggestionsHideTimerWindow = null;
  }
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return element.createEl(tagName);
}
