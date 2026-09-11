import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { DataAdapter, ListedFiles } from "obsidian";
import { describe, expect, it } from "vitest";
import { EmbeddedUnityRuntimeInstaller } from "../../src/runtime/EmbeddedUnityRuntimeInstaller";

const repoRoot = process.cwd();

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    throw new Error(`Missing installer payload file: ${path.relative(repoRoot, targetPath)}`);
  }
}

async function findUniqueFileByPrefix(directoryPath: string, prefix: string): Promise<string> {
  const matches: string[] = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix)) {
      matches.push(entry.name);
    }
  }

  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${prefix}* in ${path.relative(repoRoot, directoryPath)}, found ${matches.length}`);
  }

  return matches[0];
}

async function copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported installer payload entry: ${sourcePath}`);
    }
    await copyFile(sourcePath, targetPath);
  }
}

async function createRealRuntimeArchive(tempRoot: string): Promise<{ base64: string; sha256: string; bytes: number }> {
  const sourceBuildDir = path.join(repoRoot, "unity-webgl", "Build");
  const sourceStreamingAssetsDir = path.join(repoRoot, "unity-webgl", "StreamingAssets");
  const droidSansFallbackLicensePath = path.join(
    repoRoot,
    "unity",
    "ReverySkyMap",
    "Assets",
    "Fonts",
    "DroidSans",
    "Apache-2.0.txt"
  );
  const stagedRuntimeDir = path.join(tempRoot, "unity-webgl");
  const stagedBuildDir = path.join(stagedRuntimeDir, "Build");
  const archivePath = path.join(tempRoot, "runtime.tar.gz");
  const runtimeDataFile = await findUniqueFileByPrefix(sourceBuildDir, "runtime-data.");
  const runtimeCodeFile = await findUniqueFileByPrefix(sourceBuildDir, "runtime-code.");
  const runtimeFiles = [
    ["unity-webgl/index.disk-runtime.template.html", path.join(stagedRuntimeDir, "index.html")],
    ["unity-webgl/Build/build-config.json", path.join(stagedBuildDir, "build-config.json")],
    ["unity-webgl/Build/runtime-entry.js", path.join(stagedBuildDir, "runtime-entry.js")],
    ["unity-webgl/Build/runtime-core.js", path.join(stagedBuildDir, "runtime-core.js")],
    [`unity-webgl/Build/${runtimeDataFile}`, path.join(stagedBuildDir, runtimeDataFile)],
    [`unity-webgl/Build/${runtimeCodeFile}`, path.join(stagedBuildDir, runtimeCodeFile)],
    [
      "unity/ReverySkyMap/Assets/Fonts/DroidSans/Apache-2.0.txt",
      path.join(stagedRuntimeDir, "DroidSansFallback-LICENSE.txt")
    ]
  ] satisfies Array<[string, string]>;

  await mkdir(stagedBuildDir, { recursive: true });
  await ensureFile(droidSansFallbackLicensePath);
  for (const [sourceRelativePath, targetPath] of runtimeFiles) {
    const sourcePath = path.join(repoRoot, ...sourceRelativePath.split("/"));
    await ensureFile(sourcePath);
    await copyFile(sourcePath, targetPath);
  }

  if (await pathExists(sourceStreamingAssetsDir)) {
    await copyDirectoryRecursive(sourceStreamingAssetsDir, path.join(stagedRuntimeDir, "StreamingAssets"));
  }

  await tar.c({
    cwd: tempRoot,
    file: archivePath,
    gzip: true,
    portable: true,
    strict: true,
    noMtime: true
  }, ["unity-webgl"]);

  const archiveBuffer = await readFile(archivePath);
  return {
    base64: archiveBuffer.toString("base64"),
    sha256: createHash("sha256").update(archiveBuffer).digest("hex"),
    bytes: archiveBuffer.byteLength
  };
}

type AdapterOperation = {
  method: string;
  path: string;
};

type ReadyMarker = {
  schemaVersion: number;
  pluginVersion: string;
  archiveSha256: string;
};

class InstallerRuntimeAdapter {
  readonly operations: AdapterOperation[] = [];

  constructor(private readonly basePath: string) {}

  async exists(normalizedPath: string): Promise<boolean> {
    this.operations.push({ method: "exists", path: normalizedPath });
    return pathExists(this.absolutePath(normalizedPath));
  }

  async list(normalizedPath: string): Promise<ListedFiles> {
    this.operations.push({ method: "list", path: normalizedPath });
    const entries = await readdir(this.absolutePath(normalizedPath), { withFileTypes: true });
    return {
      files: entries
        .filter((entry) => entry.isFile())
        .map((entry) => this.joinVaultPath(normalizedPath, entry.name)),
      folders: entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.joinVaultPath(normalizedPath, entry.name))
    };
  }

  async read(normalizedPath: string): Promise<string> {
    this.operations.push({ method: "read", path: normalizedPath });
    return readFile(this.absolutePath(normalizedPath), "utf8");
  }

  async write(normalizedPath: string, data: string): Promise<void> {
    this.operations.push({ method: "write", path: normalizedPath });
    await writeFile(this.absolutePath(normalizedPath), data, "utf8");
  }

  async writeBinary(normalizedPath: string, data: ArrayBuffer): Promise<void> {
    this.operations.push({ method: "writeBinary", path: normalizedPath });
    await writeFile(this.absolutePath(normalizedPath), Buffer.from(data));
  }

  async mkdir(normalizedPath: string): Promise<void> {
    this.operations.push({ method: "mkdir", path: normalizedPath });
    await mkdir(this.absolutePath(normalizedPath));
  }

  async rmdir(normalizedPath: string, recursive: boolean): Promise<void> {
    this.operations.push({ method: "rmdir", path: normalizedPath });
    await rm(this.absolutePath(normalizedPath), { recursive, force: false });
  }

  asDataAdapter(): DataAdapter {
    return this as unknown as DataAdapter;
  }

  private absolutePath(normalizedPath: string): string {
    return path.join(this.basePath, ...normalizedPath.split("/"));
  }

  private joinVaultPath(parent: string, child: string): string {
    return parent ? `${parent}/${child}` : child;
  }
}

describe("EmbeddedUnityRuntimeInstaller real payload", () => {
  it("extracts and reuses the tracked embedded archive runtime payload", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "reverysky-installer-real-payload-"));
    try {
      const pluginVersion = "real-payload-installer";
      const vaultRoot = path.join(tempRoot, "Vault");
      const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "reverysky-map");
      const runtimeRoot = path.join(pluginDir, ".reverysky-runtime");
      const versionDir = path.join(runtimeRoot, pluginVersion);
      const previousVersionDir = path.join(runtimeRoot, "previous-installer-version");
      const adapter = new InstallerRuntimeAdapter(vaultRoot);
      await mkdir(pluginDir, { recursive: true });
      await mkdir(path.join(previousVersionDir, "unity-webgl"), { recursive: true });
      await writeFile(path.join(previousVersionDir, "old-cache.txt"), "old runtime cache", "utf8");
      const archive = await createRealRuntimeArchive(tempRoot);
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const firstResolution = await installer.resolveRuntimeDirectory(pluginDir, pluginVersion, {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: vaultRoot
      });
      const firstOperationCount = adapter.operations.length;
      const firstWriteBinaryCount = adapter.operations.filter((operation) => operation.method === "writeBinary").length;
      const secondResolution = await installer.resolveRuntimeDirectory(pluginDir, pluginVersion, {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: vaultRoot
      });
      const reuseOperations = adapter.operations.slice(firstOperationCount);
      const runtimeCodePath = path.join(firstResolution.runtimeDir, "Build", "runtime-code.wasm");
      const runtimeDataPath = path.join(firstResolution.runtimeDir, "Build", "runtime-data.data");
      const readyMarker = JSON.parse(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")) as ReadyMarker;

      expect(archive.bytes).toBeGreaterThan(10 * 1024 * 1024);
      expect(firstResolution.extracted).toBe(true);
      expect(secondResolution).toEqual({
        runtimeDir: firstResolution.runtimeDir,
        extracted: false
      });
      expect(readyMarker).toEqual({
        schemaVersion: 1,
        pluginVersion,
        archiveSha256: archive.sha256
      });
      expect((await stat(runtimeCodePath)).size).toBeGreaterThan(40 * 1024 * 1024);
      expect((await stat(runtimeDataPath)).size).toBeGreaterThan(20 * 1024 * 1024);
      expect(await pathExists(previousVersionDir)).toBe(false);
      expect(await pathExists(path.join(versionDir, "runtime.tar.gz"))).toBe(false);
      expect(firstWriteBinaryCount).toBeGreaterThan(0);
      expect(reuseOperations.some((operation) => operation.method === "writeBinary" || operation.method === "write")).toBe(false);
      expect(adapter.operations.every((operation) => !path.isAbsolute(operation.path))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("\\"))).toBe(true);
      expect(adapter.operations.some((operation) =>
        operation.method === "writeBinary" && operation.path.endsWith("unity-webgl/Build/runtime-code.wasm")
      )).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
