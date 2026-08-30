import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { extract as tarExtract } from "tar/extract";
import { list as tarList } from "tar/list";
import {
  getEmbeddedUnityRuntimeArchiveBase64,
  getEmbeddedUnityRuntimeArchiveSha256
} from "./EmbeddedUnityRuntimeArchive";

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

type ReadArchiveEntry = {
  path: string;
  type?: string;
  typeKey?: string;
  linkpath?: string;
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectoryExists(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

function isLinkEntry(entry: ReadArchiveEntry): boolean {
  return (
    entry.type === "SymbolicLink" ||
    entry.type === "Link" ||
    entry.typeKey === "1" ||
    entry.typeKey === "2"
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

async function collectArchiveEntries(archivePath: string): Promise<ReadArchiveEntry[]> {
  const entries: ReadArchiveEntry[] = [];
  await tarList({
    file: archivePath,
    strict: true,
    preservePaths: true,
    onReadEntry: (entry) => {
      entries.push({
        path: entry.path,
        type: entry.type,
        typeKey: (entry as { typeKey?: string }).typeKey,
        linkpath: entry.linkpath
      });
      entry.resume();
    }
  });
  return entries;
}

async function findUniqueMatchingFile(buildDir: string, prefix: string): Promise<RuntimeFileMatch> {
  const matches: RuntimeFileMatch[] = [];
  const entries = await readdir(buildDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix)) {
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

async function validateRuntimeDirectory(runtimeDir: string): Promise<void> {
  const indexHtmlPath = path.join(runtimeDir, "index.html");
  const buildDir = path.join(runtimeDir, "Build");
  const requiredBuildFiles = [
    "build-config.json",
    "runtime-entry.js",
    "runtime-core.js"
  ];

  if (!(await pathExists(indexHtmlPath))) {
    throw new Error(`Missing runtime file: ${indexHtmlPath}`);
  }
  if (!(await pathExists(buildDir))) {
    throw new Error(`Missing runtime directory: ${buildDir}`);
  }
  for (const relativePath of requiredBuildFiles) {
    const absolutePath = path.join(buildDir, relativePath);
    if (!(await pathExists(absolutePath))) {
      throw new Error(`Missing runtime file: ${absolutePath}`);
    }
  }

  await findUniqueMatchingFile(buildDir, "runtime-data.");
  await findUniqueMatchingFile(buildDir, "runtime-code.");
}

/**
 * The ready marker is written only after extraction and shape validation.
 * A cache without a valid marker is treated as incomplete and rebuilt.
 */
async function readRuntimeReadyMarker(markerPath: string): Promise<{
  schemaVersion?: unknown;
  pluginVersion?: unknown;
  archiveSha256?: unknown;
} | null> {
  try {
    const raw = await readFile(markerPath, "utf8");
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
  async resolveRuntimeDirectory(pluginDir: string, pluginVersion: string): Promise<EmbeddedUnityRuntimeResolution> {
    const pluginDirResolved = path.resolve(pluginDir);
    const runtimeRoot = path.join(pluginDirResolved, RUNTIME_VERSION_ROOT_NAME);
    const devRuntimeDir = path.join(pluginDirResolved, RUNTIME_ROOT_NAME);

    if (!this.archiveBase64 || !this.archiveSha256) {
      await validateRuntimeDirectory(devRuntimeDir);
      return {
        runtimeDir: devRuntimeDir,
        extracted: false
      };
    }

    const versionDir = path.join(runtimeRoot, pluginVersion);
    const runtimeDir = path.join(versionDir, RUNTIME_ROOT_NAME);

    if (await this.isValidCachedRuntime(versionDir, pluginVersion)) {
      return {
        runtimeDir,
        extracted: false
      };
    }

    const archiveBuffer = this.decodeAndValidateArchive();
    await ensureDirectoryExists(runtimeRoot);

    const tempRoot = await mkdtemp(path.join(runtimeRoot, `.extracting-${Date.now()}-`));
    const archivePath = path.join(tempRoot, "runtime.tar.gz");
    const tempMarkerPath = path.join(tempRoot, RUNTIME_READY_MARKER_NAME);

    try {
      await writeFile(archivePath, archiveBuffer);
      const entries = await collectArchiveEntries(archivePath);
      this.validateArchiveEntries(entries);

      await tarExtract({
        file: archivePath,
        cwd: tempRoot,
        strict: true
      });

      const stagedRuntimeDir = path.join(tempRoot, RUNTIME_ROOT_NAME);
      await validateRuntimeDirectory(stagedRuntimeDir);

      const marker = {
        schemaVersion: 1,
        pluginVersion,
        archiveSha256: this.archiveSha256
      };
      await writeFile(tempMarkerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");

      if (await pathExists(versionDir)) {
        await rm(versionDir, { recursive: true, force: true });
      }

      await rename(tempRoot, versionDir);
      return {
        runtimeDir,
        extracted: true
      };
    } catch (error) {
      await rm(tempRoot, { recursive: true, force: true });
      throw new Error(
        `Failed to prepare embedded Unity runtime cache for ${pluginVersion}: ${(error as Error).message}`
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

  private validateArchiveEntries(entries: ReadArchiveEntry[]): void {
    for (const entry of entries) {
      validateArchiveEntryPath(entry.path);
      if (isLinkEntry(entry)) {
        throw new Error(`Embedded runtime archive contains a link entry: ${entry.path}`);
      }
      if (typeof entry.linkpath === "string" && entry.linkpath.length > 0) {
        throw new Error(`Embedded runtime archive unexpectedly sets a link target: ${entry.path}`);
      }
    }
  }

  private async isValidCachedRuntime(versionDir: string, pluginVersion: string): Promise<boolean> {
    const markerPath = path.join(versionDir, RUNTIME_READY_MARKER_NAME);
    const runtimeDir = path.join(versionDir, RUNTIME_ROOT_NAME);

    if (!(await pathExists(versionDir)) || !(await pathExists(markerPath))) {
      return false;
    }

    const marker = await readRuntimeReadyMarker(markerPath);
    if (!marker || marker.schemaVersion !== 1) {
      return false;
    }
    if (marker.pluginVersion !== pluginVersion || marker.archiveSha256 !== this.archiveSha256) {
      return false;
    }

    try {
      await validateRuntimeDirectory(runtimeDir);
      return true;
    } catch {
      return false;
    }
  }
}
