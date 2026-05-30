export class ItemView {
  public contentEl: HTMLElement;
  public app: unknown;

  constructor(leaf: { app?: unknown }) {
    this.app = leaf?.app ?? {};
    this.contentEl = document.createElement("div");
  }

  registerEvent(_eventRef: unknown): void {}
}

export class Notice {
  constructor(_message: string) {}
}

export class WorkspaceLeaf {}
