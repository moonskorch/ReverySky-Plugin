import { Plugin, WorkspaceLeaf } from "obsidian";
import { MAP_VIEW_TYPE, MapView } from "./view/MapView";
import { UnityWebglLocalServer } from "./runtime/UnityWebglLocalServer";
import path from "node:path";

/**
 * Obsidian plugin entry point.
 * Registers the custom view, user actions, and the local WebGL runtime host.
 */
export default class ReverySkyMapPlugin extends Plugin {
  private unityWebglServer: UnityWebglLocalServer | null = null;

  async onload(): Promise<void> {
    this.registerView(
      MAP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MapView(leaf, this)
    );

    this.addRibbonIcon("sparkles", "Toggle ReverySky Map", async () => {
      await this.toggleMapView();
    });

    this.addCommand({
      id: "open-reverysky-map",
      name: "Open ReverySky Map",
      callback: async () => {
        await this.activateMapView();
      }
    });
  }

  async onunload(): Promise<void> {
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
      this.unityWebglServer = new UnityWebglLocalServer(path.join(pluginDir, "unity-webgl"));
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
        active: true
      });
    }

    await workspace.revealLeaf(leaf);
  }

  private async toggleMapView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(MAP_VIEW_TYPE);

    if (leaves.length > 0) {
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
}
