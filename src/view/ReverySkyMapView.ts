import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type { App } from "obsidian";
import type { GraphPayload } from "../bridge/BridgeTypes";
import { UnityIframeBridge } from "../bridge/UnityIframeBridge";
import { VaultGraphBuilder } from "../graph/VaultGraphBuilder";
import type ReverySkyMapPlugin from "../main";

export const REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";

type BridgePort = Pick<UnityIframeBridge, "attach" | "detach" | "sendGraphSet">;
type ObsidianHTMLElement = HTMLElement & {
  empty?: () => void;
  createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
  setAttr?: (name: string, value: string) => void;
};

export type ReverySkyMapViewDependencies = {
  createBridge?: () => BridgePort;
  buildGraph?: (app: App) => GraphPayload;
  notify?: (message: string) => void;
  now?: () => number;
};

export class ReverySkyMapView extends ItemView {
  private readonly bridge: BridgePort;
  private readonly buildGraph: (app: App) => GraphPayload;
  private readonly notify: (message: string) => void;
  private readonly now: () => number;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ReverySkyMapPlugin,
    deps: ReverySkyMapViewDependencies = {}
  ) {
    super(leaf);
    this.bridge = deps.createBridge?.() ?? new UnityIframeBridge();
    this.buildGraph = deps.buildGraph ?? VaultGraphBuilder.build;
    this.notify = deps.notify ?? ((message: string) => new Notice(message));
    this.now = deps.now ?? Date.now;
  }

  getViewType(): string {
    return REVERYSKY_MAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "ReverySky Map";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl as ObsidianHTMLElement;
    emptyElement(container);

    let iframeSrc: string;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }

    const iframe = createChild(container, "iframe");
    iframe.src = `${iframeSrc}?t=${this.now()}`;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    if (typeof (iframe as ObsidianHTMLElement).setAttr === "function") {
      (iframe as ObsidianHTMLElement).setAttr!("title", "ReverySky Map");
    } else {
      iframe.setAttribute("title", "ReverySky Map");
    }

    iframe.addEventListener("load", () => {
      if (!iframe.contentWindow) {
        this.notify("Failed to access iframe window.");
        return;
      }

      this.bridge.attach(iframe.contentWindow, {
        onReady: () => {
          const payload = this.buildGraph(this.app);
          this.bridge.sendGraphSet(payload);
        },
        onError: (message: string) => {
          this.notify(message);
        }
      });
    });
  }

  async onClose(): Promise<void> {
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

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  if (typeof element.createEl === "function") {
    return element.createEl(tagName);
  }

  const child = document.createElement(tagName);
  element.appendChild(child);
  return child as HTMLElementTagNameMap[K];
}
