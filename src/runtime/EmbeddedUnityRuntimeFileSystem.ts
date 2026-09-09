import path from "node:path";
import type { DataAdapter } from "obsidian";

export type EmbeddedUnityRuntimeInstallContext = {
  adapter: DataAdapter;
  vaultBasePath: string;
};

export type RuntimeDirectoryEntry = {
  name: string;
  isFile: boolean;
};

export type RuntimeFileSystem = {
  exists(targetPath: string): Promise<boolean>;
  readText(targetPath: string): Promise<string>;
  listDirectory(targetPath: string): Promise<RuntimeDirectoryEntry[]>;
  ensureDirectory(targetPath: string): Promise<void>;
  removeDirectory(targetPath: string): Promise<void>;
  writeText(targetPath: string, content: string): Promise<void>;
  writeBinary(targetPath: string, content: Buffer): Promise<void>;
};

function isInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toVaultPath(absoluteVaultRoot: string, absolutePath: string): string {
  const relativePath = path.relative(absoluteVaultRoot, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Runtime path is outside the vault: ${absolutePath}`);
  }

  return relativePath.split(path.sep).join("/");
}

function toArrayBuffer(content: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(content.byteLength);
  new Uint8Array(arrayBuffer).set(content);
  return arrayBuffer;
}

class AdapterRuntimeFileSystem implements RuntimeFileSystem {
  private readonly absoluteVaultRoot: string;
  private readonly absolutePluginDir: string;

  constructor(
    private readonly adapter: DataAdapter,
    vaultBasePath: string,
    pluginDir: string
  ) {
    this.absoluteVaultRoot = path.resolve(vaultBasePath);
    this.absolutePluginDir = path.resolve(pluginDir);
    if (!isInsideOrEqual(this.absoluteVaultRoot, this.absolutePluginDir)) {
      throw new Error(`Plugin directory is outside the vault: ${pluginDir}`);
    }
  }

  async exists(targetPath: string): Promise<boolean> {
    return this.adapter.exists(this.toPluginVaultPath(targetPath));
  }

  async readText(targetPath: string): Promise<string> {
    return this.adapter.read(this.toPluginVaultPath(targetPath));
  }

  async listDirectory(targetPath: string): Promise<RuntimeDirectoryEntry[]> {
    const listedFiles = await this.adapter.list(this.toPluginVaultPath(targetPath));
    return listedFiles.files.map((filePath) => ({
      name: path.posix.basename(filePath),
      isFile: true
    }));
  }

  async ensureDirectory(targetPath: string): Promise<void> {
    const vaultPath = this.toPluginVaultPath(targetPath);
    const parts = vaultPath.split("/").filter((part) => part.length > 0);
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!(await this.adapter.exists(currentPath))) {
        try {
          await this.adapter.mkdir(currentPath);
        } catch (error) {
          if (!(await this.adapter.exists(currentPath))) {
            throw error;
          }
        }
      }
    }
  }

  async removeDirectory(targetPath: string): Promise<void> {
    const vaultPath = this.toPluginVaultPath(targetPath);
    if (await this.adapter.exists(vaultPath)) {
      await this.adapter.rmdir(vaultPath, true);
    }
  }

  async writeText(targetPath: string, content: string): Promise<void> {
    await this.ensureDirectory(path.dirname(targetPath));
    await this.adapter.write(this.toPluginVaultPath(targetPath), content);
  }

  async writeBinary(targetPath: string, content: Buffer): Promise<void> {
    await this.ensureDirectory(path.dirname(targetPath));
    await this.adapter.writeBinary(this.toPluginVaultPath(targetPath), toArrayBuffer(content));
  }

  private toPluginVaultPath(targetPath: string): string {
    const absolutePath = path.resolve(targetPath);
    if (!isInsideOrEqual(this.absolutePluginDir, absolutePath)) {
      throw new Error(`Runtime path is outside the plugin directory: ${targetPath}`);
    }

    return toVaultPath(this.absoluteVaultRoot, absolutePath);
  }
}

export function createAdapterRuntimeFileSystem(
  pluginDir: string,
  context: EmbeddedUnityRuntimeInstallContext
): RuntimeFileSystem {
  if (!context?.adapter || !context.vaultBasePath) {
    throw new Error("Runtime installation requires both an Obsidian adapter and a vault base path.");
  }

  return new AdapterRuntimeFileSystem(context.adapter, context.vaultBasePath, pluginDir);
}
