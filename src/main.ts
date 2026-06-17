import { Plugin, WorkspaceLeaf } from "obsidian";
import { MAP_VIEW_TYPE, MapView } from "./view/MapView";
import {
  UnityWebglLocalServer,
  type UnityWebglRuntimeSource
} from "./runtime/UnityWebglLocalServer";
import {
  hasEmbeddedUnityRuntimeArchive
} from "./runtime/EmbeddedUnityRuntimeArchive";
import {
  EmbeddedUnityRuntimeInstaller
} from "./runtime/EmbeddedUnityRuntimeInstaller";
import { getEmbeddedUnityIndexHtml } from "./runtime/EmbeddedUnityIndexHtml";
import path from "node:path";

type PersistedPluginData = {
  mapViewState?: Record<string, unknown>;
};

/**
 * Obsidian plugin entry point.
 * Registers the custom view, user actions, and the local WebGL runtime host.
 */
export default class ReverySkyMapPlugin extends Plugin {
  private unityWebglServer: UnityWebglLocalServer | null = null;
  private readonly unityRuntimeInstaller = new EmbeddedUnityRuntimeInstaller();
  private lastMapViewState: Record<string, unknown> | null = null;

  async onload(): Promise<void> {
    const persistedData = this.normalizePersistedData(await this.loadData());
    this.lastMapViewState = persistedData.mapViewState ?? null;

    this.registerView(
      MAP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MapView(leaf, this)
    );

    this.addRibbonIcon("sparkles", "Toggle ReverySky Map", async () => {
      await this.toggleMapView();
    });

    this.addCommand({
      id: "open-map",
      name: "Open map",
      callback: async () => {
        await this.activateMapView();
      }
    });
  }

  async onunload(): Promise<void> {
    await this.captureAndPersistMapViewState();
    this.app.workspace.detachLeavesOfType(MAP_VIEW_TYPE);
    if (this.unityWebglServer) {
      await this.unityWebglServer.stop();
      this.unityWebglServer = null;
    }
  }

  /**
   * Start the WebGL host lazily and reuse it for every iframe load.
   */
  async getUnityRuntimeUrl(): Promise<string> {
    if (!this.unityWebglServer) {
      const pluginDir = this.resolvePluginDirectory();
      const embeddedIndexHtml = getEmbeddedUnityIndexHtml();
      const runtimeSource: UnityWebglRuntimeSource = hasEmbeddedUnityRuntimeArchive()
        ? {
            kind: "directory",
            rootDir: await this.unityRuntimeInstaller.resolveRuntimeDirectory(
              pluginDir,
              this.manifest.version
            )
          }
        : embeddedIndexHtml
          ? {
              kind: "embedded-index",
              indexHtml: embeddedIndexHtml
            }
          : {
              kind: "directory",
              rootDir: path.join(pluginDir, "unity-webgl")
            };

      this.unityWebglServer = new UnityWebglLocalServer(runtimeSource);
    }

    const baseUrl = await this.unityWebglServer.getBaseUrl();
    return `${baseUrl}/index.html`;
  }

  private async activateMapView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(MAP_VIEW_TYPE)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({
        type: MAP_VIEW_TYPE,
        active: true,
        state: this.lastMapViewState ?? undefined
      });
    }

    await workspace.revealLeaf(leaf);
  }

  private async toggleMapView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(MAP_VIEW_TYPE);

    if (leaves.length > 0) {
      await this.captureAndPersistMapViewState();
      workspace.detachLeavesOfType(MAP_VIEW_TYPE);
      return;
    }

    await this.activateMapView();
  }

  /**
   * Resolve the installed plugin folder so the bundled WebGL export can be served from disk.
   */
  private resolvePluginDirectory(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (!adapter.getBasePath) {
      throw new Error("File adapter base path is unavailable.");
    }

    return path.join(adapter.getBasePath(), this.app.vault.configDir, "plugins", this.manifest.id);
  }

  private async captureAndPersistMapViewState(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
    this.lastMapViewState = this.captureMapViewState(leaves);
    await this.saveData({
      mapViewState: this.lastMapViewState ?? undefined
    } satisfies PersistedPluginData);
  }

  private captureMapViewState(leaves: WorkspaceLeaf[]): Record<string, unknown> | null {
    for (const leaf of leaves) {
      const state = (leaf.view as { getState?: () => Record<string, unknown> } | undefined)?.getState?.();
      if (state && typeof state === "object") {
        return state;
      }
    }

    return this.lastMapViewState;
  }

  private normalizePersistedData(data: unknown): PersistedPluginData {
    if (!data || typeof data !== "object") {
      return {};
    }

    const mapViewState = (data as { mapViewState?: unknown }).mapViewState;
    return {
      mapViewState: mapViewState && typeof mapViewState === "object"
        ? (mapViewState as Record<string, unknown>)
        : undefined
    };
  }
}
