const LANDMARK_SUGGESTIONS_HIDE_DELAY_MS = 120;
const LANDMARK_SOURCE_INPUT_DEBOUNCE_MS = 500;
let nextPropertySuggestionsId = 0;

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
};

type LandmarkSuggestionsControllerOptions = {
  inputEl: HTMLInputElement;
  rootEl: ObsidianHTMLElement;
  anchorEl: HTMLElement;
  getValue: () => string;
  getCommittedValue: () => string;
  setValue: (value: string) => void;
  commitValue: (value: string) => void;
  getSuggestions: (query: string) => string[];
  openPanel: () => void;
};

export class LandmarkSuggestionsController {
  private readonly propertySuggestionsId = `reverysky-map-property-suggestions-${++nextPropertySuggestionsId}`;
  private readonly inputEl: HTMLInputElement;
  private readonly rootEl: ObsidianHTMLElement;
  private readonly anchorEl: HTMLElement;
  private readonly getValue: () => string;
  private readonly getCommittedValue: () => string;
  private readonly setValue: (value: string) => void;
  private readonly commitValue: (value: string) => void;
  private readonly getSuggestions: (query: string) => string[];
  private readonly openPanel: () => void;
  private propertySuggestionsHideTimer: number | null = null;
  private propertySuggestionsHideTimerWindow: Window | null = null;
  private landmarkSourceInputTimer: number | null = null;
  private landmarkSourceInputTimerWindow: Window | null = null;
  private propertySuggestionsEl: HTMLElement | null = null;
  private propertySuggestionsListboxEl: HTMLElement | null = null;
  private propertySuggestionActiveIndex = -1;

  constructor(options: LandmarkSuggestionsControllerOptions) {
    this.inputEl = options.inputEl;
    this.rootEl = options.rootEl;
    this.anchorEl = options.anchorEl;
    this.getValue = options.getValue;
    this.getCommittedValue = options.getCommittedValue;
    this.setValue = options.setValue;
    this.commitValue = options.commitValue;
    this.getSuggestions = options.getSuggestions;
    this.openPanel = options.openPanel;

    this.inputEl.setAttribute("role", "combobox");
    this.inputEl.setAttribute("aria-label", "Landmark source");
    this.inputEl.setAttribute("aria-haspopup", "listbox");
    this.inputEl.setAttribute("aria-autocomplete", "list");
    this.inputEl.setAttribute("aria-expanded", "false");
    this.inputEl.setAttribute("aria-controls", this.propertySuggestionsId);
    this.inputEl.addEventListener("focus", () => {
      this.showPropertySuggestions();
    });
    this.inputEl.addEventListener("click", () => {
      this.showPropertySuggestions();
    });
    this.inputEl.addEventListener("blur", () => {
      this.commitLandmarkSourceInput(this.getValue());
      this.setValue(this.getCommittedValue());
      this.scheduleHidePropertySuggestions();
    });
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      this.handleKeydown(event);
    });

    this.propertySuggestionsEl = createChild(this.rootEl, "div");
    this.propertySuggestionsEl.className =
      "reverysky-map-filter-suggestions reverysky-map-filter-suggestions--overlay reverysky-map-property-suggestions";
    this.propertySuggestionsEl.classList.add("reverysky-map-filter-suggestions--hidden");
  }

  handleInputChanged(nextValue: string): void {
    this.scheduleLandmarkSourceCommit(nextValue);
    if (this.isPropertySuggestionsVisible()) {
      this.propertySuggestionActiveIndex = 0;
      this.refresh();
    }
  }

  refresh(): void {
    if (!this.propertySuggestionsEl) {
      return;
    }

    const currentValue = this.getValue();
    const suggestions = this.getSuggestions(currentValue);
    this.propertySuggestionsListboxEl = null;
    this.propertySuggestionsEl.replaceChildren();

    const suggestionsTitle = createChild(this.propertySuggestionsEl as ObsidianHTMLElement, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Properties";
    const listbox = this.createPropertySuggestionsListbox(this.propertySuggestionsEl);

    if (!suggestions.length) {
      const emptyHint = createChild(this.propertySuggestionsEl as ObsidianHTMLElement, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No properties found";
      this.syncPropertySuggestionActiveState();
      return;
    }

    for (const suggestion of suggestions) {
      const option = createChild(listbox as ObsidianHTMLElement, "div");
      option.className = "reverysky-map-folder-suggestion-option reverysky-map-property-suggestion-option";
      this.preparePropertySuggestionOption(option);
      option.textContent = suggestion;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyPropertySuggestion(suggestion);
      });
    }

    this.syncPropertySuggestionActiveState();
  }

  hide(): void {
    if (!this.propertySuggestionsEl) {
      return;
    }

    this.propertySuggestionActiveIndex = -1;
    this.propertySuggestionsEl.classList.add("reverysky-map-filter-suggestions--hidden");
    this.inputEl.setAttribute("aria-expanded", "false");
    this.inputEl.removeAttribute("aria-activedescendant");
  }

  position(): void {
    if (!this.propertySuggestionsEl) {
      return;
    }

    const anchorRect = this.anchorEl.getBoundingClientRect();
    const rootRect = this.rootEl.getBoundingClientRect();
    const gapPx = 4;
    const rootPaddingPx = 8;
    const maxHeight = Math.max(0, rootRect.bottom - anchorRect.bottom - gapPx - rootPaddingPx);

    this.propertySuggestionsEl.setCssStyles({
      left: "auto",
      right: `${rootRect.right - anchorRect.right}px`,
      top: `${anchorRect.bottom - rootRect.top + gapPx}px`
    });
    this.propertySuggestionsEl.setCssProps({
      "--reverysky-filter-suggestions-anchor-width": `${anchorRect.width}px`,
      "--reverysky-filter-suggestions-max-height": `${maxHeight}px`
    });
  }

  dispose(): void {
    this.clearPropertySuggestionsHideTimer();
    this.clearLandmarkSourceInputTimer();
    this.propertySuggestionsEl = null;
    this.propertySuggestionsListboxEl = null;
    this.propertySuggestionActiveIndex = -1;
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.moveOrOpenPropertySuggestionSelection(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.moveOrOpenPropertySuggestionSelection(-1);
      return;
    }

    if (event.key === "Enter" && this.propertySuggestionActiveIndex >= 0) {
      event.preventDefault();
      this.activatePropertySuggestionAtIndex(this.propertySuggestionActiveIndex);
    }
  }

  private showPropertySuggestions(): void {
    if (!this.propertySuggestionsEl) {
      return;
    }

    this.propertySuggestionActiveIndex = 0;
    this.openPanel();
    this.refresh();
    this.clearPropertySuggestionsHideTimer();
    this.position();
    this.propertySuggestionsEl.classList.remove("reverysky-map-filter-suggestions--hidden");
    this.inputEl.setAttribute("aria-expanded", "true");
  }

  private scheduleHidePropertySuggestions(): void {
    this.clearPropertySuggestionsHideTimer();
    const timerWindow = this.propertySuggestionsEl?.ownerDocument.defaultView ?? window;
    this.propertySuggestionsHideTimerWindow = timerWindow;
    this.propertySuggestionsHideTimer = timerWindow.setTimeout(() => {
      this.propertySuggestionsHideTimer = null;
      this.propertySuggestionsHideTimerWindow = null;
      this.hide();
    }, LANDMARK_SUGGESTIONS_HIDE_DELAY_MS);
  }

  private isPropertySuggestionsVisible(): boolean {
    return (
      this.propertySuggestionsEl !== null &&
      !this.propertySuggestionsEl.classList.contains("reverysky-map-filter-suggestions--hidden")
    );
  }

  private applyPropertySuggestion(propertyName: string): void {
    this.clearLandmarkSourceInputTimer();
    this.setValue(propertyName);
    this.commitValue(propertyName);
    this.hide();
  }

  private scheduleLandmarkSourceCommit(value: string): void {
    this.clearLandmarkSourceInputTimer();
    const timerWindow = this.inputEl.ownerDocument.defaultView ?? window;
    this.landmarkSourceInputTimerWindow = timerWindow;
    this.landmarkSourceInputTimer = timerWindow.setTimeout(() => {
      this.landmarkSourceInputTimer = null;
      this.landmarkSourceInputTimerWindow = null;
      this.commitLandmarkSourceInput(value);
    }, LANDMARK_SOURCE_INPUT_DEBOUNCE_MS);
  }

  private commitLandmarkSourceInput(value: string): void {
    this.clearLandmarkSourceInputTimer();
    this.commitValue(value);
  }

  private clearLandmarkSourceInputTimer(): void {
    if (!this.landmarkSourceInputTimer) {
      return;
    }

    (this.landmarkSourceInputTimerWindow ?? window).clearTimeout(this.landmarkSourceInputTimer);
    this.landmarkSourceInputTimer = null;
    this.landmarkSourceInputTimerWindow = null;
  }

  private movePropertySuggestionSelection(delta: number): void {
    if (!this.isPropertySuggestionsVisible()) {
      return;
    }

    const options = this.getPropertySuggestionOptionElements();
    if (!options.length) {
      return;
    }

    const currentIndex = this.propertySuggestionActiveIndex >= 0 ? this.propertySuggestionActiveIndex : 0;
    this.propertySuggestionActiveIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
    this.syncPropertySuggestionActiveState();
  }

  private moveOrOpenPropertySuggestionSelection(delta: number): void {
    if (this.isPropertySuggestionsVisible()) {
      this.movePropertySuggestionSelection(delta);
      return;
    }

    this.showPropertySuggestions();
    const options = this.getPropertySuggestionOptionElements();
    if (options.length && delta < 0) {
      this.propertySuggestionActiveIndex = options.length - 1;
      this.syncPropertySuggestionActiveState();
    }
  }

  private activatePropertySuggestionAtIndex(index: number): void {
    const option = this.getPropertySuggestionOptionElements()[index];
    if (!option) {
      return;
    }

    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  private getPropertySuggestionOptionElements(): HTMLElement[] {
    if (!this.propertySuggestionsListboxEl) {
      return [];
    }

    return Array.from(this.propertySuggestionsListboxEl.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  private syncPropertySuggestionActiveState(): void {
    if (!this.propertySuggestionsEl || !this.propertySuggestionsListboxEl) {
      return;
    }

    const options = this.getPropertySuggestionOptionElements();
    if (!options.length) {
      this.propertySuggestionActiveIndex = -1;
      this.inputEl.removeAttribute("aria-activedescendant");
      return;
    }

    if (this.propertySuggestionActiveIndex < 0 || this.propertySuggestionActiveIndex >= options.length) {
      this.propertySuggestionActiveIndex = 0;
    }

    for (const [index, option] of options.entries()) {
      const isActive = index === this.propertySuggestionActiveIndex;
      option.classList.toggle("reverysky-map-folder-suggestion-option--active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
      option.id = `${this.propertySuggestionsListboxEl.id}-option-${index}`;
      if (isActive) {
        this.scrollActiveSuggestionIntoPane(option);
        this.inputEl.setAttribute("aria-activedescendant", option.id);
      }
    }
  }

  private scrollActiveSuggestionIntoPane(option: HTMLElement): void {
    if (!this.propertySuggestionsEl) {
      return;
    }

    const pane = this.propertySuggestionsEl;
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

  private createPropertySuggestionsListbox(host: HTMLElement): HTMLElement {
    const listbox = createChild(host as ObsidianHTMLElement, "div");
    listbox.id = this.propertySuggestionsId;
    listbox.setAttribute("role", "listbox");
    this.propertySuggestionsListboxEl = listbox;
    return listbox;
  }

  private preparePropertySuggestionOption(option: HTMLElement): void {
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
  }

  private clearPropertySuggestionsHideTimer(): void {
    if (!this.propertySuggestionsHideTimer) {
      return;
    }

    (this.propertySuggestionsHideTimerWindow ?? window).clearTimeout(this.propertySuggestionsHideTimer);
    this.propertySuggestionsHideTimer = null;
    this.propertySuggestionsHideTimerWindow = null;
  }
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return element.createEl(tagName);
}
