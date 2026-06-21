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

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "shutdown" | "sendGraphSet" | "sendNoteFocus">;
type ObsidianHTMLElement = HTMLElement & {
  empty?: () => void;
  setAttr?: (name: string, value: string) => void;
};

export type MapViewDependencies = {
  createBridge?: () => BridgePort;
  buildGraph?: (app: App) => GraphPayload;
  notify?: (message: string) => void;
  now?: () => number;
};

/**
 * Own the Obsidian view shell and iframe bridge lifecycle around the Unity map.
 * Filter-panel interactions and note-open routing live in dedicated collaborators.
 */
export class MapView extends ItemView {
  navigation = false;
  private readonly bridge: BridgePort;
  private readonly notify: (message: string) => void;
  private readonly now: () => number;
  private readonly session: MapSession;
  private readonly noteOpenRouter: MapNoteOpenRouter;
  private filterPanelController: MapFilterPanelController | null = null;
  private iframeLoadAbortController: AbortController | null = null;
  private lifecycleGeneration = 0;

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
    this.session = new MapSession({
      app: this.app,
      buildGraph,
      now: this.now,
      sendGraph: (payload) => {
        this.bridge.sendGraphSet(payload);
        this.filterPanelController?.refreshSuggestions();
      },
      sendFocus: (payload) => {
        this.bridge.sendNoteFocus(payload);
      }
    });
    this.noteOpenRouter = new MapNoteOpenRouter(this.app, this.session, this.notify);
  }

  getViewType(): string {
    return MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ReverySky Map";
  }

  getState(): Record<string, unknown> {
    return this.session.getState();
  }

  async setState(state: unknown): Promise<void> {
    await this.session.setState(state);
    this.filterPanelController?.syncFromSession();
  }

  async onOpen(): Promise<void> {
    const lifecycleGeneration = ++this.lifecycleGeneration;
    this.session.start(this.registerEvent.bind(this));

    const container = this.contentEl as ObsidianHTMLElement;
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

    const iframe = container.ownerDocument.createElement("iframe");
    iframe.src = `${iframeSrc}?t=${this.now()}`;
    iframe.className = "reverysky-map-iframe";
    if (typeof iframe.setAttr === "function") {
      iframe.setAttr("title", "ReverySky Map");
    } else {
      iframe.setAttribute("title", "ReverySky Map");
    }
    iframeHost.appendChild(iframe);

    const iframeLoadAbortController = new AbortController();
    this.iframeLoadAbortController = iframeLoadAbortController;
    iframe.addEventListener("load", () => {
      if (lifecycleGeneration !== this.lifecycleGeneration) {
        return;
      }
      if (!iframe.contentWindow) {
        this.notify("Failed to access iframe window.");
        return;
      }

      const messageWindow = container.ownerDocument.defaultView ?? window;
      this.bridge.attach(iframe.contentWindow, {
        onReady: () => {
          if (lifecycleGeneration !== this.lifecycleGeneration) {
            return;
          }
          this.session.setBridgeReady(true);
          this.session.flushOrRefresh();
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

  async onClose(): Promise<void> {
    const closeGeneration = ++this.lifecycleGeneration;
    this.session.stop();
    this.filterPanelController?.dispose();
    this.filterPanelController = null;
    this.iframeLoadAbortController?.abort();
    this.iframeLoadAbortController = null;

    await this.bridge.shutdown(300);

    if (closeGeneration !== this.lifecycleGeneration) {
      return;
    }

    this.bridge.detach();
    emptyElement(this.contentEl as ObsidianHTMLElement);
  }
}

function emptyElement(element: ObsidianHTMLElement): void {
  if (typeof element.empty === "function") {
    element.empty();
    return;
  }

  element.replaceChildren();
}
