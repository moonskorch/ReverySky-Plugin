export class ItemView {
  public contentEl: HTMLElement;
  public app: unknown;

  constructor(leaf: { app?: unknown }) {
    this.app = leaf?.app ?? {};
    this.contentEl = document.createElement("div");
  }

  registerEvent(_eventRef: unknown): void {}

  getState(): Record<string, unknown> {
    return {};
  }

  async setState(_state: unknown): Promise<void> {}
}

export class Notice {
  constructor(_message: string) {}
}

export class WorkspaceLeaf {}

export class SearchComponent {
  public inputEl: HTMLInputElement;
  public clearButtonEl: HTMLElement;
  private onChangeHandlers: Array<(value: string) => void> = [];

  constructor(containerEl: HTMLElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "search-input-container";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "search-input";
    wrapper.appendChild(input);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "search-input-clear-button";
    wrapper.appendChild(clearButton);

    containerEl.appendChild(wrapper);

    this.inputEl = input;
    this.clearButtonEl = clearButton;

    this.inputEl.addEventListener("input", () => {
      this.onChanged();
    });
    this.clearButtonEl.addEventListener("click", () => {
      this.setValue("");
      this.onChanged();
    });
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.onChangeHandlers.push(callback);
    return this;
  }

  onChanged(): void {
    const value = this.inputEl.value;
    for (const handler of this.onChangeHandlers) {
      handler(value);
    }
  }
}
