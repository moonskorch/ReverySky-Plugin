export type PersistedPluginData = {
  mapViewState?: Record<string, unknown>;
  whatsNewShownVersion?: string;
};

type RawPersistedPluginData = {
  mapViewState?: unknown;
  whatsNewShownVersion?: unknown;
};

export type PluginDataPersistenceHost = {
  loadData: () => Promise<unknown>;
  saveData: (data: PersistedPluginData) => Promise<void>;
};

export class PluginDataPersistence {
  private mapViewState: Record<string, unknown> | null = null;
  private whatsNewShownVersion: string | null = null;
  private savePromise: Promise<void> = Promise.resolve();

  constructor(private readonly host: PluginDataPersistenceHost) {}

  async load(): Promise<void> {
    const persistedData = this.normalize(await this.host.loadData());
    this.mapViewState = persistedData.mapViewState ?? null;
    this.whatsNewShownVersion = persistedData.whatsNewShownVersion ?? null;
  }

  getMapViewStateSnapshot(): Record<string, unknown> | null {
    return this.mapViewState ? { ...this.mapViewState } : null;
  }

  getWhatsNewShownVersion(): string | null {
    return this.whatsNewShownVersion;
  }

  setMapViewState(state: Record<string, unknown>): void {
    this.mapViewState = { ...state };
  }

  setWhatsNewShownVersion(version: string): void {
    this.whatsNewShownVersion = version;
  }

  persist(): Promise<void> {
    const nextSave = this.savePromise
      .catch(() => undefined)
      .then(() => this.saveCurrentSnapshot());
    this.savePromise = nextSave;
    return nextSave;
  }

  private saveCurrentSnapshot(): Promise<void> {
    const data: PersistedPluginData = {
      mapViewState: this.mapViewState ?? undefined
    };
    if (this.whatsNewShownVersion) {
      data.whatsNewShownVersion = this.whatsNewShownVersion;
    }

    return this.host.saveData(data);
  }

  private normalize(data: unknown): PersistedPluginData {
    if (!data || typeof data !== "object") {
      return {};
    }

    const persistedData = data as RawPersistedPluginData;
    return {
      mapViewState: persistedData.mapViewState && typeof persistedData.mapViewState === "object"
        ? (persistedData.mapViewState as Record<string, unknown>)
        : undefined,
      whatsNewShownVersion: typeof persistedData.whatsNewShownVersion === "string" && persistedData.whatsNewShownVersion.length > 0
        ? persistedData.whatsNewShownVersion
        : undefined
    };
  }
}
