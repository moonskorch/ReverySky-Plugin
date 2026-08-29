import {
  ItemView,
  MarkdownRenderer,
  WorkspaceLeaf,
  type ViewStateResult
} from "obsidian";

export const WHATS_NEW_VIEW_TYPE = "reverysky-whats-new-view";

export type WhatsNewViewState = {
  version?: unknown;
  markdown?: unknown;
  sourcePath?: unknown;
};

function emptyElement(element: HTMLElement): void {
  if (typeof (element as { empty?: unknown }).empty === "function") {
    (element as { empty: () => void }).empty();
    return;
  }

  element.replaceChildren();
}

export class WhatsNewView extends ItemView {
  navigation = false;
  private version = "";
  private markdown = "";
  private sourcePath = "whats-new/announcement.md";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return WHATS_NEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ReverySky 3D Graph: What's New";
  }

  getIcon(): string {
    return "sparkles";
  }

  getState(): Record<string, unknown> {
    return {
      version: this.version,
      markdown: this.markdown,
      sourcePath: this.sourcePath
    };
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const viewState = state && typeof state === "object"
      ? (state as WhatsNewViewState)
      : {};

    this.version = typeof viewState.version === "string" ? viewState.version : "";
    this.markdown = typeof viewState.markdown === "string" ? viewState.markdown : "";
    this.sourcePath = typeof viewState.sourcePath === "string" && viewState.sourcePath.length > 0
      ? viewState.sourcePath
      : this.sourcePath;
    await this.render();
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    emptyElement(this.contentEl);
    this.contentEl.classList.add("reverysky-whats-new-view");

    const markdownContainer = this.contentEl.ownerDocument.createElement("div");
    markdownContainer.classList.add("markdown-preview-view", "markdown-rendered");
    this.contentEl.appendChild(markdownContainer);

    if (!this.markdown) {
      return;
    }

    await MarkdownRenderer.render(this.app, this.markdown, markdownContainer, this.sourcePath, this);
  }
}
