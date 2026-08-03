if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.createEl !== "function") {
  HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
    tagName: K
  ): HTMLElementTagNameMap[K] {
    const child = document.createElement(tagName);
    this.appendChild(child);
    return child;
  };
}

if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.setCssStyles !== "function") {
  HTMLElement.prototype.setCssStyles = function (styles: Partial<CSSStyleDeclaration>): void {
    for (const [property, value] of Object.entries(styles)) {
      if (typeof value === "string") {
        this.style.setProperty(property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`), value);
      }
    }
  };
}

if (typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.setCssProps !== "function") {
  HTMLElement.prototype.setCssProps = function (props: Record<string, string>): void {
    for (const [property, value] of Object.entries(props)) {
      this.style.setProperty(property, value);
    }
  };
}

if (typeof Node !== "undefined" && !Object.getOwnPropertyDescriptor(Node.prototype, "win")) {
  Object.defineProperty(Node.prototype, "win", {
    configurable: true,
    get(this: Node): Window {
      return this.ownerDocument?.defaultView ?? window;
    }
  });
}

if (typeof Node !== "undefined" && !Object.getOwnPropertyDescriptor(Node.prototype, "doc")) {
  Object.defineProperty(Node.prototype, "doc", {
    configurable: true,
    get(this: Node): Document {
      return this.ownerDocument ?? document;
    }
  });
}

export class Plugin {
  public app: unknown;
  public manifest: { id: string };

  constructor(app?: unknown, manifest?: { id?: string }) {
    this.app = app ?? {};
    this.manifest = { id: manifest?.id ?? "reverysky-map" };
  }

  registerView(_type: string, _creator: (leaf: WorkspaceLeaf) => unknown): void {}

  addRibbonIcon(_icon: string, _title: string, _callback: () => unknown): void {}

  addCommand(_command: { id: string; name: string; callback: () => unknown }): void {}

  addSettingTab(_tab: unknown): void {}

  async loadData(): Promise<unknown> {
    return null;
  }

  async saveData(_data: unknown): Promise<void> {}
}

export class ItemView {
  public contentEl: HTMLElement;
  public app: unknown;
  public leaf: unknown;

  constructor(leaf: { app?: unknown }) {
    this.leaf = leaf;
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

export class PluginSettingTab {
  public containerEl: HTMLElement;

  constructor(public app: unknown, public plugin: unknown) {
    this.containerEl = document.createElement("div");
  }

  display(): void {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addButton(callback: (button: {
    setButtonText: (text: string) => unknown;
    setCta: () => unknown;
    onClick: (handler: () => unknown) => unknown;
  }) => unknown): this {
    callback({
      setButtonText: () => undefined,
      setCta: () => undefined,
      onClick: () => undefined
    });
    return this;
  }
}

export class WorkspaceLeaf {}

export abstract class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {}

export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.setAttribute("data-icon", iconId);
}

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
