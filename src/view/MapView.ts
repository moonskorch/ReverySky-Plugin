import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { GraphPayload, NoteOpenPayload } from "../bridge/BridgeTypes";
import { UnityIframeBridge } from "../bridge/UnityIframeBridge";
import { VaultGraphBuilder } from "../graph/VaultGraphBuilder";
import type ReverySkyMapPlugin from "../main";
import { MapFilterPanelController } from "./MapFilterPanelController";
import { MapNoteOpenRouter } from "./MapNoteOpenRouter";
import { MapSession } from "./MapSession";

export const MAP_VIEW_TYPE = "reverysky-map-view";

type BridgePort = Pick<
  UnityIframeBridge,
  "attach" | "detach" | "shutdown" | "sendGraphSet" | "sendNoteFocus" | "sendRuntimeSettings" | "sendStatus"
>;
type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  empty?: () => void;
  doc: Document;
  win: Window;
};
type RuntimeWindow = Window & {
  AbortController: typeof AbortController;
};

export type MapViewDependencies = {
  createBridge?: () => BridgePort;
  buildGraph?: (app: App) => GraphPayload;
  notify?: (message: string) => void;
  now?: () => number;
  initialState?: Record<string, unknown> | null;
  onStateChanged?: (state: Record<string, unknown>, options?: { persist?: boolean }) => void;
  onLifecycleOpen?: () => symbol;
  onLifecycleClose?: (lease: symbol) => Promise<void> | void;
};

/**
 * Own the Obsidian view shell and iframe bridge lifecycle around the Unity graph.
 * Filter-panel interactions and note-open routing live in dedicated collaborators.
 */
export class MapView extends ItemView {
  navigation = true;
  private readonly bridge: BridgePort;
  private readonly notify: (message: string) => void;
  private readonly now: () => number;
  private readonly session: MapSession;
  private readonly noteOpenRouter: MapNoteOpenRouter;
  private filterPanelController: MapFilterPanelController | null = null;
  private iframeLoadAbortController: AbortController | null = null;
  private windowMigrationCleanup: (() => void) | null = null;
  private deferredIframeRenderCleanup: (() => void) | null = null;
  private lifecycleGeneration = 0;
  private readonly initialState: Record<string, unknown> | null;
  private readonly onLifecycleOpen?: () => symbol;
  private readonly onLifecycleClose?: (lease: symbol) => Promise<void> | void;
  /**
   * Lease held while this view is one of the active users of the plugin-owned runtime server.
   */
  private runtimeLease: symbol | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ReverySkyMapPlugin,
    deps: MapViewDependencies = {}
  ) {
    super(leaf);
    this.bridge = deps.createBridge?.() ?? new UnityIframeBridge();
    const buildGraph = deps.buildGraph ?? ((app: App) => VaultGraphBuilder.build(app));
    this.notify = deps.notify ?? ((message: string) => new Notice(message));
    this.now = deps.now ?? Date.now;
    this.initialState = deps.initialState ? { ...deps.initialState } : null;
    this.onLifecycleOpen = deps.onLifecycleOpen;
    this.onLifecycleClose = deps.onLifecycleClose;
    this.session = new MapSession({
      app: this.app,
      buildGraph,
      now: this.now,
      sendGraph: (payload) => {
        this.bridge.sendGraphSet(payload);
        this.filterPanelController?.refreshSuggestions();
      },
      sendStatus: (message) => {
        this.bridge.sendStatus(message);
      },
      sendFocus: (payload) => {
        this.bridge.sendNoteFocus(payload);
      },
      sendRuntimeSettings: (payload) => {
        this.bridge.sendRuntimeSettings(payload);
      },
      onStateChanged: (state, options) => {
        deps.onStateChanged?.(state, options);
      }
    });
    this.noteOpenRouter = new MapNoteOpenRouter(this.app, this.session, this.notify);
  }

  getViewType(): string {
    return MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ReverySky 3D Graph";
  }

  requestEditorFocus(path: string): void {
    this.session.requestEditorFocus(path);
  }

  async onOpen(): Promise<void> {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    this.acquireRuntimeLease();
    if (this.initialState) {
      await this.session.setState(this.initialState);
    }
    this.session.start(this.registerEvent.bind(this));

    const container = this.contentEl as ObsidianHTMLElement;
    this.registerWindowMigrationHandler(container);
    await this.renderRuntimeIframe(container, lifecycleGeneration);
  }

  async onClose(): Promise<void> {
    const closeGeneration = ++this.lifecycleGeneration;
    let shouldNotifyLifecycleClose = true;
    const windowMigrationCleanup = this.windowMigrationCleanup;
    this.windowMigrationCleanup = null;
    windowMigrationCleanup?.();

    try {
      this.session.stop();
      this.cancelDeferredIframeRender();
      this.disposeRuntimeShell();

      await this.bridge.shutdown(300);

      if (closeGeneration !== this.lifecycleGeneration) {
        shouldNotifyLifecycleClose = false;
        return;
      }

      this.bridge.detach();
      emptyElement(this.contentEl);
    } finally {
      if (shouldNotifyLifecycleClose) {
        await this.notifyLifecycleClose();
      }
    }
  }

  private restartRuntimeAfterWindowMigration(): void {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    const container = this.contentEl as ObsidianHTMLElement;
    const renderWindow = container.win;
    this.session.handleRuntimeUnavailable();
    this.cancelDeferredIframeRender();
    this.disposeRuntimeFrame();
    this.bridge.detach();
    this.removeRuntimeIframe(container);

    // Exit Obsidian's migration callback before navigating a fresh iframe.
    this.deferredIframeRenderCleanup = this.deferIframeRender(renderWindow, () => {
      this.deferredIframeRenderCleanup = null;
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        return;
      }
      if (!container.isConnected) {
        return;
      }
      void this.renderRuntimeIframe(container, lifecycleGeneration);
    });
  }

  private async renderRuntimeIframe(
    container: ObsidianHTMLElement,
    lifecycleGeneration: number
  ): Promise<void> {
    this.filterPanelController?.dispose();
    this.filterPanelController = null;
    emptyElement(container);
    this.filterPanelController = new MapFilterPanelController(this.session);
    const iframeHost = this.filterPanelController.render(container);

    let iframeSrc: string;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        return;
      }
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      return;
    }

    const iframe = iframeHost.createEl("iframe");
    iframe.src = this.createRuntimeIframeSrc(iframeSrc, this.now());
    iframe.className = "reverysky-map-iframe";
    iframe.setAttribute("title", "ReverySky 3D Graph");
    const iframeWindow = iframeHost.win as RuntimeWindow;
    const iframeLoadAbortController = new iframeWindow.AbortController();
    this.iframeLoadAbortController = iframeLoadAbortController;
    iframe.addEventListener("load", () => {
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        return;
      }
      if (!iframe.contentWindow) {
        this.notify("Failed to access iframe window.");
        return;
      }

      const messageWindow = container.win;
      this.bridge.attach(iframe.contentWindow, {
        onReady: () => {
          if (lifecycleGeneration !== this.lifecycleGeneration) {
            return;
          }
          this.session.handleRuntimeReady();
        },
        onNoteOpen: (payload: NoteOpenPayload) => {
          if (lifecycleGeneration !== this.lifecycleGeneration) {
            return;
          }
          void this.noteOpenRouter.openRequestedNote(payload);
        },
        onError: (message: string) => {
          if (lifecycleGeneration !== this.lifecycleGeneration) {
            return;
          }
          this.notify(message);
        }
      }, messageWindow);
    }, { signal: iframeLoadAbortController.signal });
  }

  private createRuntimeIframeSrc(iframeSrc: string, cacheBust: number): string {
    const url = new URL(iframeSrc);
    url.searchParams.set("t", String(cacheBust));
    url.searchParams.set("renderScale", String(this.session.getRenderScale()));
    return url.toString();
  }

  private registerWindowMigrationHandler(container: ObsidianHTMLElement): void {
    this.windowMigrationCleanup?.();
    this.windowMigrationCleanup = null;

    this.windowMigrationCleanup = container.onWindowMigrated(() => {
      this.restartRuntimeAfterWindowMigration();
    });
  }

  private deferIframeRender(win: Window, callback: () => void): () => void {
    let cancelled = false;
    const timeoutId = win.setTimeout(() => {
      if (cancelled) {
        return;
      }
      callback();
    }, 0);

    return () => {
      cancelled = true;
      win.clearTimeout(timeoutId);
    };
  }

  private cancelDeferredIframeRender(): void {
    this.deferredIframeRenderCleanup?.();
    this.deferredIframeRenderCleanup = null;
  }

  private disposeRuntimeShell(): void {
    this.disposeRuntimeFrame();
    this.filterPanelController?.dispose();
    this.filterPanelController = null;
  }

  private disposeRuntimeFrame(): void {
    this.iframeLoadAbortController?.abort();
    this.iframeLoadAbortController = null;
  }

  private removeRuntimeIframe(container: ObsidianHTMLElement): void {
    container.querySelector("iframe.reverysky-map-iframe")?.remove();
  }

  private notifyLifecycleClose(): Promise<void> {
    if (!this.onLifecycleClose) {
      return Promise.resolve();
    }

    const lease = this.runtimeLease;
    if (!lease) {
      return Promise.resolve();
    }

    this.runtimeLease = null;
    try {
      return Promise.resolve(this.onLifecycleClose(lease));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error("Failed to close the graph runtime lifecycle."));
    }
  }

  private acquireRuntimeLease(): void {
    if (this.runtimeLease || !this.onLifecycleOpen) {
      return;
    }

    this.runtimeLease = this.onLifecycleOpen();
  }
}

function emptyElement(element: ObsidianHTMLElement): void {
  if (typeof element.empty === "function") {
    element.empty();
    return;
  }

  element.replaceChildren();
}
