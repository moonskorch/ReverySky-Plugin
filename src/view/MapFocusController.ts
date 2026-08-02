import {
  MarkdownView,
  type App,
  type EventRef,
  type WorkspaceLeaf
} from "obsidian";

const FOCUS_GATE_WINDOW_MS = 250;

export type MapFocusControllerDependencies = {
  app: App;
  now: () => number;
  requestFocus: (path: string, options?: { skipGraphCheck?: boolean }) => boolean;
  getFocusPath: () => string;
};

export class MapFocusController {
  private workspaceFocusRegistered = false;
  // One short-lived gate covers both Unity-open focus echoes and duplicate Obsidian focus signals.
  private gatePath = "";
  private gateAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: MapFocusControllerDependencies) {}

  start(registerEvent: (eventRef: EventRef) => void): void {
    if (this.workspaceFocusRegistered) {
      return;
    }

    const workspace = this.deps.app.workspace;
    if (!workspace) {
      return;
    }

    this.workspaceFocusRegistered = true;
    registerEvent(
      workspace.on("file-open", (file) => {
        this.sendFocusForPath(file?.path);
      })
    );
  }

  reset(): void {
    this.clearGate();
  }

  expectFocusEchoForPath(path: unknown): void {
    const normalizedPath = this.normalizePath(path);
    if (this.isRelevantPath(normalizedPath)) {
      // Obsidian will often emit file-open/editor focus after we open a Unity-requested note.
      this.rememberGate(normalizedPath);
    } else {
      this.clearGate();
    }
  }

  clearExpectedFocusEchoForPath(path: unknown): void {
    const normalizedPath = this.normalizePath(path);
    if (this.gatePath === normalizedPath) {
      this.clearGate();
    }
  }

  resolveOpenLinkSourcePath(): string {
    return this.getLeafSourcePath(this.resolveOpenLinkSourceLeaf());
  }

  onMarkdownFocus(path: unknown): void {
    const normalizedPath = this.normalizePath(path);
    if (!this.isRelevantPath(normalizedPath)) {
      return;
    }

    this.sendFocusForPath(normalizedPath);
  }

  onRename(_oldPath: unknown, newPath: unknown): void {
    const normalizedOldPath = this.normalizePath(_oldPath);
    const normalizedNewPath = this.normalizePath(newPath);
    const focusPath = this.normalizePath(this.deps.getFocusPath());
    if (focusPath === normalizedOldPath) {
      // Rename is the only focus source allowed to outrun the current graph:
      // the new path-derived id may not exist in MapSession.outgoingGraphPayload yet.
      this.deps.requestFocus(normalizedNewPath, { skipGraphCheck: true });
    }
  }

  private sendFocusForPath(path: unknown): boolean {
    const normalizedPath = this.normalizePath(path);
    if (!this.isRelevantPath(normalizedPath)) {
      return false;
    }

    if (this.isGatedFocus(normalizedPath)) {
      // Slide the gate forward so file-open and editor-focus bursts collapse into one decision.
      this.rememberGate(normalizedPath);
      return false;
    }

    if (!this.deps.requestFocus(normalizedPath)) {
      return false;
    }

    this.rememberGate(normalizedPath);
    return true;
  }

  private isGatedFocus(path: string): boolean {
    return this.gatePath === path &&
      this.deps.now() - this.gateAt <= FOCUS_GATE_WINDOW_MS;
  }

  private rememberGate(path: string): void {
    this.gatePath = path;
    this.gateAt = this.deps.now();
  }

  private clearGate(): void {
    this.gatePath = "";
    this.gateAt = Number.NEGATIVE_INFINITY;
  }

  private resolveOpenLinkSourceLeaf(): WorkspaceLeaf | null {
    const workspace = this.deps.app.workspace;
    if (!workspace) {
      return null;
    }

    const activeMarkdownLeaf = this.getActiveMarkdownLeaf();
    if (this.isMarkdownLeaf(activeMarkdownLeaf)) {
      return activeMarkdownLeaf;
    }

    const markdownLeaf = workspace.getLeavesOfType("markdown")[0] ?? null;
    if (this.isMarkdownLeaf(markdownLeaf)) {
      return markdownLeaf;
    }

    let fallbackLeaf: WorkspaceLeaf | null = null;
    workspace.iterateAllLeaves((leaf) => {
      if (!fallbackLeaf && this.isMarkdownLeaf(leaf)) {
        fallbackLeaf = leaf;
      }
    });

    return fallbackLeaf;
  }

  private getActiveMarkdownLeaf(): WorkspaceLeaf | null {
    const workspace = this.deps.app.workspace as Partial<Pick<App["workspace"], "getActiveViewOfType">> & {
      activeLeaf?: WorkspaceLeaf | null;
    };
    const activeLeaf = workspace.getActiveViewOfType?.(MarkdownView)?.leaf ?? null;
    if (this.isMarkdownLeaf(activeLeaf)) {
      return activeLeaf;
    }
    return this.isMarkdownLeaf(workspace.activeLeaf ?? null) ? workspace.activeLeaf ?? null : null;
  }

  private getActiveMarkdownPath(): string {
    return this.getLeafSourcePath(this.getActiveMarkdownLeaf());
  }

  private isMarkdownLeaf(leaf: WorkspaceLeaf | null): leaf is WorkspaceLeaf {
    if (!leaf) {
      return false;
    }

    const viewType = leaf.view?.getViewType?.();
    if (viewType === "markdown") {
      return true;
    }

    const stateType = leaf.getViewState?.().type;
    return stateType === "markdown";
  }

  private getLeafSourcePath(leaf: WorkspaceLeaf | null): string {
    const view = (leaf?.view as { file?: { path?: string } } | null) ?? null;
    const path = view?.file?.path;
    return typeof path === "string" ? path : "";
  }

  private normalizePath(path: unknown): string {
    if (typeof path !== "string") {
      return "";
    }
    return path.trim().replace(/\\/g, "/");
  }

  private isRelevantPath(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
  }
}
