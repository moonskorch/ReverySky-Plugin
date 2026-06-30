import {
  MarkdownView,
  type App,
  type EventRef,
  type WorkspaceLeaf
} from "obsidian";
import type { NoteFocusPayload } from "../bridge/BridgeTypes";
import { makeStableNoteId } from "../graph/VaultGraphBuilder";

export type MapFocusControllerDependencies = {
  app: App;
  isBridgeReady: () => boolean;
  sendFocus: (payload: NoteFocusPayload) => void;
};

export class MapFocusController {
  private workspaceFocusRegistered = false;

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

  reset(): void {}

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
    const activeMarkdownPath = this.getActiveMarkdownPath();
    if (activeMarkdownPath === normalizedOldPath || activeMarkdownPath === normalizedNewPath) {
      this.sendFocusForPath(normalizedNewPath);
    }
  }

  private sendFocusForPath(path: unknown): boolean {
    const normalizedPath = this.normalizePath(path);
    if (!this.deps.isBridgeReady() || !this.isRelevantPath(normalizedPath)) {
      return false;
    }

    this.deps.sendFocus({
      id: makeStableNoteId(normalizedPath),
      path: normalizedPath
    });
    return true;
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
