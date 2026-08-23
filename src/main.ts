import { Plugin, WorkspaceLeaf, type Tasks } from "obsidian";
import { MAP_VIEW_TYPE, MapView } from "./view/MapView";
import { createMarkdownEditorFocusListener } from "./view/MarkdownEditorFocus";
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
import {
  registerEditorMenuCommands,
  registerCommands,
  forwardFocusToViews
} from "./commands/MapCommands";
import path from "node:path";

type PersistedPluginData = {
  mapViewState?: Record<string, unknown>;
};

/**
 * Obsidian plugin entry point.
 * Registers the custom view, user actions, and the local WebGL runtime host.
 */
export default class ReverySkyMapPlugin extends Plugin {
  /**
   * Single loopback WebGL host shared by every open graph view in this plugin instance.
   */
  private unityWebglServer: UnityWebglLocalServer | null = null;

  /**
   * In-flight runtime URL resolution.
   *
   * This is deliberately not a permanent URL cache: it exists only while the
   * server source is being prepared or the local server is binding to a port.
   * Concurrent graph views await the same promise so a cold start cannot create
   * more than one local server.
   */
  private unityRuntimeUrlPromise: Promise<string> | null = null;

  /**
   * Prepares an `embedded-archive` runtime folder before it is handed to the local server.
   *
   * The installer verifies and extracts the archive payload when present; it does
   * not own the HTTP server lifecycle.
   */
  private readonly unityRuntimeInstaller = new EmbeddedUnityRuntimeInstaller();

  /**
   * Active graph view holds on the shared runtime server.
   *
   * These are not Obsidian leaves. Each Symbol is a short-lived lease returned
   * to one MapView on open and released on close. The server stays alive while
   * at least one lease remains.
   */
  private readonly serverLeases = new Set<symbol>();

  /**
   * Last plugin-level graph view state loaded from or written to Obsidian plugin data.
   *
   * This intentionally remains a single shared snapshot rather than per-window
   * state: duplicate graph views are tolerated as a recovery edge case, but the
   * supported reopen path restores the most recently persisted filter/layout
   * settings.
   */
  private mapViewState: Record<string, unknown> | null = null;

  async onload(): Promise<void> {
    const persistedData = this.normalizePersistedData(await this.loadData());
    this.mapViewState = persistedData.mapViewState ?? null;

    this.registerView(
      MAP_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new MapView(leaf, this, {
        initialState: this.mapViewState ? { ...this.mapViewState } : null,
        onStateChanged: (state, options) => {
          this.updateMapViewState(state, options?.persist ?? true);
        },
        onLifecycleOpen: () => this.acquireMapViewRuntimeLease(),
        onLifecycleClose: async (lease) => {
          await this.releaseMapViewRuntimeLease(lease);
        }
      })
    );

    registerCommands(this);
    registerEditorMenuCommands(this);

    this.registerEditorExtension(
      createMarkdownEditorFocusListener((path) => {
        forwardFocusToViews(this, path);
      })
    );

    this.registerEvent(
      this.app.workspace.on("quit", (tasks: Tasks) => {
        tasks.addPromise(this.flushPersistedMapViewState());
      })
    );
  }

  onunload(): void {
    void this.cleanupOnUnload().catch((error: unknown) => {
      console.error("Failed to unload ReverySky 3D Graph plugin.", error);
    });
  }

  private async cleanupOnUnload(): Promise<void> {
    try {
      await this.flushPersistedMapViewState();
    } finally {
      try {
        this.app.workspace.detachLeavesOfType(MAP_VIEW_TYPE);
      } finally {
        await this.forceStopUnityRuntimeServer();
      }
    }
  }

  /**
   * Start the WebGL host lazily and reuse it for every iframe load.
   *
   * If two Obsidian windows restore graph views at the same time, both calls must
   * join the same startup work instead of racing to create separate servers.
   */
  async getUnityRuntimeUrl(): Promise<string> {
    if (this.unityRuntimeUrlPromise) {
      return this.unityRuntimeUrlPromise;
    }

    const runtimeUrlPromise = this.resolveUnityRuntimeUrl();
    this.unityRuntimeUrlPromise = runtimeUrlPromise;
    try {
      return await runtimeUrlPromise;
    } finally {
      if (this.unityRuntimeUrlPromise === runtimeUrlPromise) {
        this.unityRuntimeUrlPromise = null;
      }
    }
  }

  acquireMapViewRuntimeLease(): symbol {
    const lease = Symbol("reverysky-map-runtime-lease");
    this.serverLeases.add(lease);
    return lease;
  }

  /**
   * Release one MapView's hold on the shared server and stop it after the last view closes.
   */
  async releaseMapViewRuntimeLease(lease: symbol): Promise<void> {
    const wasReleased = this.serverLeases.delete(lease);
    if (!wasReleased) {
      return;
    }
    if (this.serverLeases.size > 0) {
      return;
    }

    await this.stopUnityRuntimeServer();
  }

  private async resolveUnityRuntimeUrl(): Promise<string> {
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

  private async stopUnityRuntimeServer(): Promise<void> {
    // A view can close while the first runtime URL is still being resolved.
    // Wait for that startup attempt before deciding whether there is a server to stop.
    if (this.unityRuntimeUrlPromise) {
      try {
        await this.unityRuntimeUrlPromise;
      } catch {
        // A failed start leaves no listener to close.
      }
    }
    if (this.serverLeases.size > 0) {
      return;
    }

    const unityWebglServer = this.unityWebglServer;
    if (!unityWebglServer) {
      return;
    }

    this.unityWebglServer = null;
    await unityWebglServer.stop();
  }

  private async forceStopUnityRuntimeServer(): Promise<void> {
    // Plugin unload owns final cleanup, so any remaining view leases are no longer meaningful.
    this.serverLeases.clear();
    await this.stopUnityRuntimeServer();
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

  private updateMapViewState(state: Record<string, unknown>, persist: boolean = true): void {
    this.mapViewState = { ...state };
    if (!persist) {
      return;
    }

    void this.persistMapViewState().catch((error: unknown) => {
      console.error("Failed to persist ReverySky 3D Graph state.", error);
    });
  }

  async flushPersistedMapViewState(): Promise<void> {
    await this.persistMapViewState();
  }

  private persistMapViewState(): Promise<void> {
    const data = {
      mapViewState: this.mapViewState ?? undefined
    } satisfies PersistedPluginData;
    return this.saveData(data);
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
