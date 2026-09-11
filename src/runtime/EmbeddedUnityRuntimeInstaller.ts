import { createHash } from "node:crypto";
import path from "node:path";
import {
  getEmbeddedUnityRuntimeArchiveBase64,
  getEmbeddedUnityRuntimeArchiveSha256
} from "./EmbeddedUnityRuntimeArchive";
import {
  collectArchiveEntries,
  createArchiveEntry,
  drainArchiveEntry,
  type EmbeddedRuntimeArchiveEntry,
  parseArchiveBuffer,
  readArchiveEntryArrayBuffer
} from "./EmbeddedUnityRuntimeArchiveParser";
import {
  createAdapterRuntimeFileSystem,
  type EmbeddedUnityRuntimeInstallContext,
  type RuntimeFileSystem
} from "./EmbeddedUnityRuntimeFileSystem";

export type EmbeddedUnityRuntimeInstallerOptions = {
  archiveBase64?: string;
  archiveSha256?: string;
};

export type EmbeddedUnityRuntimeResolution = {
  runtimeDir: string;
  extracted: boolean;
};

type RuntimeFileMatch = {
  name: string;
  absolutePath: string;
};

const RUNTIME_READY_MARKER_NAME = ".runtime-ready.json";
const RUNTIME_ROOT_NAME = "unity-webgl";
const RUNTIME_VERSION_ROOT_NAME = ".reverysky-runtime";

function normalizeSha256(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

function isLinkEntry(entry: EmbeddedRuntimeArchiveEntry): boolean {
  return (
    entry.type === "SymbolicLink" ||
    entry.type === "Link" ||
    entry.typeKey === "1" ||
    entry.typeKey === "2"
  );
}

function isDirectoryEntry(entry: EmbeddedRuntimeArchiveEntry): boolean {
  return entry.type === "Directory" || entry.type === "GNUDumpDir" || entry.typeKey === "5";
}

function isFileEntry(entry: EmbeddedRuntimeArchiveEntry): boolean {
  return (
    entry.type === "File" ||
    entry.type === "OldFile" ||
    entry.type === "ContiguousFile" ||
    entry.typeKey === "0" ||
    entry.typeKey === "" ||
    entry.typeKey === "7"
  );
}

function validateArchiveEntryPath(entryPath: string): void {
  if (typeof entryPath !== "string" || entryPath.length === 0) {
    throw new Error("Embedded runtime archive contains an entry with no path.");
  }
  if (entryPath.includes("\0")) {
    throw new Error(`Embedded runtime archive entry contains a null byte: ${entryPath}`);
  }
  if (entryPath.includes("\\")) {
    throw new Error(`Embedded runtime archive entry contains a backslash: ${entryPath}`);
  }
  if (path.posix.isAbsolute(entryPath)) {
    throw new Error(`Embedded runtime archive entry is absolute: ${entryPath}`);
  }

  const normalizedPath = path.posix.normalize(entryPath);
  // The embedded archive must behave like a packaged unity-webgl/ folder, not
  // like an arbitrary tarball that can write beside the plugin directory.
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    (normalizedPath !== RUNTIME_ROOT_NAME && !normalizedPath.startsWith(`${RUNTIME_ROOT_NAME}/`))
  ) {
    throw new Error(`Embedded runtime archive entry escapes ${RUNTIME_ROOT_NAME}/: ${entryPath}`);
  }
}

async function findUniqueMatchingFile(
  runtimeFileSystem: RuntimeFileSystem,
  buildDir: string,
  prefix: string
): Promise<RuntimeFileMatch> {
  const matches: RuntimeFileMatch[] = [];
  const entries = await runtimeFileSystem.listDirectory(buildDir);
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.startsWith(prefix)) {
      continue;
    }

    matches.push({
      name: entry.name,
      absolutePath: path.join(buildDir, entry.name)
    });
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${prefix}* file in ${buildDir}, found ${matches.length}.`
    );
  }

  return matches[0];
}

async function validateRuntimeDirectory(runtimeFileSystem: RuntimeFileSystem, runtimeDir: string): Promise<void> {
  const indexHtmlPath = path.join(runtimeDir, "index.html");
  const buildDir = path.join(runtimeDir, "Build");
  const requiredBuildFiles = [
    "build-config.json",
    "runtime-entry.js",
    "runtime-core.js"
  ];

  if (!(await runtimeFileSystem.exists(indexHtmlPath))) {
    throw new Error(`Missing runtime file: ${indexHtmlPath}`);
  }
  if (!(await runtimeFileSystem.exists(buildDir))) {
    throw new Error(`Missing runtime directory: ${buildDir}`);
  }
  for (const relativePath of requiredBuildFiles) {
    const absolutePath = path.join(buildDir, relativePath);
    if (!(await runtimeFileSystem.exists(absolutePath))) {
      throw new Error(`Missing runtime file: ${absolutePath}`);
    }
  }

  await findUniqueMatchingFile(runtimeFileSystem, buildDir, "runtime-data.");
  await findUniqueMatchingFile(runtimeFileSystem, buildDir, "runtime-code.");
}

/**
 * The ready marker is written only after extraction and shape validation.
 * A cache without a valid marker is treated as incomplete and rebuilt.
 */
async function readRuntimeReadyMarker(runtimeFileSystem: RuntimeFileSystem, markerPath: string): Promise<{
  schemaVersion?: unknown;
  pluginVersion?: unknown;
  archiveSha256?: unknown;
} | null> {
  try {
    const raw = await runtimeFileSystem.readText(markerPath);
    return JSON.parse(raw) as {
      schemaVersion?: unknown;
      pluginVersion?: unknown;
      archiveSha256?: unknown;
    };
  } catch {
    return null;
  }
}

/**
 * Reads and prepares the Unity WebGL runtime used by `embedded-archive` builds.
 *
 * Release packages carry a compressed runtime archive inside `main.js`; this
 * installer verifies that payload and extracts it once into
 * `.reverysky-runtime/<plugin-version>/unity-webgl`. Development and
 * folder-runtime installs bypass extraction and validate the adjacent
 * `unity-webgl/` directory instead.
 */
export class EmbeddedUnityRuntimeInstaller {
  private readonly archiveBase64: string | null;
  private readonly archiveSha256: string | null;

  constructor(options: EmbeddedUnityRuntimeInstallerOptions = {}) {
    this.archiveBase64 = options.archiveBase64 ?? getEmbeddedUnityRuntimeArchiveBase64();
    this.archiveSha256 = normalizeSha256(options.archiveSha256 ?? getEmbeddedUnityRuntimeArchiveSha256());
  }

  /**
   * Return a directory that `UnityWebglLocalServer` can serve as a normal WebGL export.
   *
   * Embedded-archive builds extract into a versioned cache. Dev and folder-runtime
   * builds do not have an archive payload, so they validate and return the local
   * `unity-webgl/` folder beside the plugin bundle.
   */
  async resolveRuntimeDirectory(
    pluginDir: string,
    pluginVersion: string,
    context: EmbeddedUnityRuntimeInstallContext
  ): Promise<EmbeddedUnityRuntimeResolution> {
    const pluginDirResolved = path.resolve(pluginDir);
    const runtimeFileSystem = createAdapterRuntimeFileSystem(pluginDirResolved, context);
    const runtimeRoot = path.join(pluginDirResolved, RUNTIME_VERSION_ROOT_NAME);
    const devRuntimeDir = path.join(pluginDirResolved, RUNTIME_ROOT_NAME);

    if (!this.archiveBase64 || !this.archiveSha256) {
      await validateRuntimeDirectory(runtimeFileSystem, devRuntimeDir);
      return {
        runtimeDir: devRuntimeDir,
        extracted: false
      };
    }

    const versionDir = path.join(runtimeRoot, pluginVersion);
    const runtimeDir = path.join(versionDir, RUNTIME_ROOT_NAME);

    if (await this.isValidCachedRuntime(versionDir, pluginVersion, runtimeFileSystem)) {
      await this.cleanupOldRuntimeCaches(runtimeRoot, pluginVersion, runtimeFileSystem);
      return {
        runtimeDir,
        extracted: false
      };
    }

    const archiveBuffer = this.decodeAndValidateArchive();
    const entries = await collectArchiveEntries(archiveBuffer);
    this.validateArchiveEntries(entries);

    try {
      await runtimeFileSystem.ensureDirectory(runtimeRoot);
      await runtimeFileSystem.removeDirectory(versionDir);
      await runtimeFileSystem.ensureDirectory(versionDir);

      await this.installArchiveEntries(archiveBuffer, versionDir, runtimeFileSystem);
      await validateRuntimeDirectory(runtimeFileSystem, runtimeDir);

      const marker = {
        schemaVersion: 1,
        pluginVersion,
        archiveSha256: this.archiveSha256
      };
      await runtimeFileSystem.writeText(
        path.join(versionDir, RUNTIME_READY_MARKER_NAME),
        `${JSON.stringify(marker, null, 2)}\n`
      );
      await this.cleanupOldRuntimeCaches(runtimeRoot, pluginVersion, runtimeFileSystem);
      return {
        runtimeDir,
        extracted: true
      };
    } catch (error) {
      const cleanupError = await this.removeIncompleteRuntimeCache(versionDir, runtimeFileSystem);
      const cleanupMessage = cleanupError ? ` Cleanup incomplete cache also failed: ${cleanupError.message}` : "";
      throw new Error(
        `Failed to prepare embedded Unity runtime cache for ${pluginVersion}: ${(error as Error).message}${cleanupMessage}`
      );
    }
  }

  private decodeAndValidateArchive(): Buffer {
    if (!this.archiveBase64 || !this.archiveSha256) {
      throw new Error("Embedded runtime archive is unavailable.");
    }

    const archiveBuffer = Buffer.from(this.archiveBase64.replace(/\s+/g, ""), "base64");
    const actualSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
    if (actualSha256 !== this.archiveSha256) {
      throw new Error(
        `Embedded Unity runtime archive SHA-256 mismatch: expected ${this.archiveSha256}, got ${actualSha256}.`
      );
    }

    return archiveBuffer;
  }

  private validateArchiveEntries(entries: EmbeddedRuntimeArchiveEntry[]): void {
    for (const entry of entries) {
      validateArchiveEntryPath(entry.path);
      if (isLinkEntry(entry)) {
        throw new Error(`Embedded runtime archive contains a link entry: ${entry.path}`);
      }
      if (typeof entry.linkpath === "string" && entry.linkpath.length > 0) {
        throw new Error(`Embedded runtime archive unexpectedly sets a link target: ${entry.path}`);
      }
      if (entry.meta) {
        continue;
      }
      if (!isDirectoryEntry(entry) && !isFileEntry(entry)) {
        throw new Error(`Embedded runtime archive contains an unsupported entry type: ${entry.path}`);
      }
    }
  }

  private async installArchiveEntries(
    archiveBuffer: Buffer,
    versionDir: string,
    runtimeFileSystem: RuntimeFileSystem
  ): Promise<void> {
    await parseArchiveBuffer(archiveBuffer, async (entry) => {
      const archiveEntry = createArchiveEntry(entry);
      this.validateArchiveEntries([archiveEntry]);

      if (archiveEntry.meta) {
        await drainArchiveEntry(entry);
        return;
      }

      const targetPath = path.join(versionDir, ...archiveEntry.path.split("/"));
      if (isDirectoryEntry(archiveEntry)) {
        await runtimeFileSystem.ensureDirectory(targetPath);
        await drainArchiveEntry(entry);
        return;
      }

      if (!isFileEntry(archiveEntry)) {
        throw new Error(`Embedded runtime archive contains an unsupported entry type: ${archiveEntry.path}`);
      }

      const content = await readArchiveEntryArrayBuffer(entry);
      await runtimeFileSystem.writeBinary(targetPath, content);
    });
  }

  private async removeIncompleteRuntimeCache(
    versionDir: string,
    runtimeFileSystem: RuntimeFileSystem
  ): Promise<Error | null> {
    try {
      await runtimeFileSystem.removeDirectory(versionDir);
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async cleanupOldRuntimeCaches(
    runtimeRoot: string,
    pluginVersion: string,
    runtimeFileSystem: RuntimeFileSystem
  ): Promise<void> {
    let entries;
    try {
      entries = await runtimeFileSystem.listDirectory(runtimeRoot);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isFile || entry.name === pluginVersion) {
        continue;
      }

      try {
        await runtimeFileSystem.removeDirectory(path.join(runtimeRoot, entry.name));
      } catch {
        // Old runtime cache cleanup must not break a valid current install.
      }
    }
  }

  private async isValidCachedRuntime(
    versionDir: string,
    pluginVersion: string,
    runtimeFileSystem: RuntimeFileSystem
  ): Promise<boolean> {
    const markerPath = path.join(versionDir, RUNTIME_READY_MARKER_NAME);
    const runtimeDir = path.join(versionDir, RUNTIME_ROOT_NAME);

    if (!(await runtimeFileSystem.exists(versionDir)) || !(await runtimeFileSystem.exists(markerPath))) {
      return false;
    }

    const marker = await readRuntimeReadyMarker(runtimeFileSystem, markerPath);
    if (!marker || marker.schemaVersion !== 1) {
      return false;
    }
    if (marker.pluginVersion !== pluginVersion || marker.archiveSha256 !== this.archiveSha256) {
      return false;
    }

    try {
      await validateRuntimeDirectory(runtimeFileSystem, runtimeDir);
      return true;
    } catch {
      return false;
    }
  }
}
