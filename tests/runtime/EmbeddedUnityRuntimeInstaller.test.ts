import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { DataAdapter, ListedFiles } from "obsidian";
import { describe, expect, it } from "vitest";
import { EmbeddedUnityRuntimeInstaller } from "../../src/runtime/EmbeddedUnityRuntimeInstaller";

type TarEntry = {
  path: string;
  content?: string | Buffer;
  type?: "0" | "1" | "2" | "5";
  linkpath?: string;
};

function writeTarField(buffer: Buffer, value: string, offset: number, length: number): void {
  const bytes = Buffer.from(value, "utf8");
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeTarOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const octal = value.toString(8).padStart(length - 1, "0");
  buffer.write(octal, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function createTarEntry(entry: TarEntry): Buffer {
  const body = Buffer.isBuffer(entry.content)
    ? entry.content
    : Buffer.from(entry.content ?? "", "utf8");
  const type = entry.type ?? "0";
  const size = type === "0" ? body.length : 0;
  const header = Buffer.alloc(512, 0);

  writeTarField(header, entry.path, 0, 100);
  writeTarOctal(header, 0o644, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  if (entry.linkpath) {
    writeTarField(header, entry.linkpath, 157, 100);
  }
  writeTarField(header, "ustar", 257, 6);
  writeTarField(header, "00", 263, 2);

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumField = `${checksum.toString(8).padStart(6, "0")}\0 `;
  header.write(checksumField, 148, checksumField.length, "ascii");

  const bodyPadding = size % 512 === 0 ? 0 : 512 - (size % 512);
  return Buffer.concat([header, body, Buffer.alloc(bodyPadding, 0)]);
}

function createTarGz(entries: TarEntry[]): Buffer {
  const chunks = entries.map((entry) => createTarEntry(entry));
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

function createFakeRuntimeArchive(options?: {
  missingRuntimeCode?: boolean;
  extraEntries?: TarEntry[];
  symlinkEntry?: boolean;
  hardlinkEntry?: boolean;
  traversalEntry?: boolean;
}): { base64: string; sha256: string } {
  const entries: TarEntry[] = [
    {
      path: "unity-webgl/index.html",
      content: "<!doctype html><html><body>runtime</body></html>\n"
    },
    {
      path: "unity-webgl/Build/build-config.json",
      content: JSON.stringify(
        {
          loaderFile: "runtime-entry.js",
          dataFile: "runtime-data.data",
          frameworkFile: "runtime-core.js",
          codeFile: "runtime-code.wasm",
          streamingAssetsUrl: "StreamingAssets",
          companyName: "MoonSkorch Studio",
          productName: "ReverySky Map",
          productVersion: "0.0.1"
        },
        null,
        2
      )
    },
    {
      path: "unity-webgl/Build/runtime-entry.js",
      content: "window.createUnityInstance = async () => ({ SendMessage() {} });\n"
    },
    {
      path: "unity-webgl/Build/runtime-core.js",
      content: "console.log('runtime-core');\n"
    },
    {
      path: "unity-webgl/Build/runtime-data.data",
      content: Buffer.from([1, 2, 3, 4])
    }
  ];

  if (!options?.missingRuntimeCode) {
    entries.push({
      path: "unity-webgl/Build/runtime-code.wasm",
      content: Buffer.from([5, 6, 7, 8])
    });
  }

  if (options?.traversalEntry) {
    entries.push({
      path: "unity-webgl/../evil.txt",
      content: "evil"
    });
  }

  if (options?.symlinkEntry) {
    entries.push({
      path: "unity-webgl/Build/runtime-code.link",
      type: "2",
      linkpath: "../../outside"
    });
  }

  if (options?.hardlinkEntry) {
    entries.push({
      path: "unity-webgl/Build/runtime-code.hardlink",
      type: "1",
      linkpath: "unity-webgl/Build/runtime-code.wasm"
    });
  }

  if (options?.extraEntries) {
    entries.push(...options.extraEntries);
  }

  const archive = createTarGz(entries);
  return {
    base64: archive.toString("base64"),
    sha256: createHash("sha256").update(archive).digest("hex")
  };
}

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reverysky-runtime-installer-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createDevRuntime(pluginDir: string): Promise<void> {
  const buildDir = path.join(pluginDir, "unity-webgl", "Build");
  await mkdir(buildDir, { recursive: true });
  await writeFile(path.join(pluginDir, "unity-webgl", "index.html"), "<!doctype html><html>dev</html>\n", "utf8");
  await writeFile(
    path.join(buildDir, "build-config.json"),
    JSON.stringify(
      {
        loaderFile: "runtime-entry.js",
        dataFile: "runtime-data.data",
        frameworkFile: "runtime-core.js",
        codeFile: "runtime-code.wasm",
        streamingAssetsUrl: "StreamingAssets",
        companyName: "MoonSkorch Studio",
        productName: "ReverySky Map",
        productVersion: "0.0.1"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(buildDir, "runtime-entry.js"), "console.log('dev entry');\n", "utf8");
  await writeFile(path.join(buildDir, "runtime-core.js"), "console.log('dev core');\n", "utf8");
  await writeFile(path.join(buildDir, "runtime-data.data"), "dev-data", "utf8");
  await writeFile(path.join(buildDir, "runtime-code.wasm"), "dev-code", "utf8");
}

async function createValidCache(pluginDir: string, pluginVersion: string, archiveSha256: string): Promise<string> {
  const versionDir = path.join(pluginDir, ".reverysky-runtime", pluginVersion);
  const buildDir = path.join(versionDir, "unity-webgl", "Build");
  await mkdir(buildDir, { recursive: true });
  await writeFile(path.join(versionDir, ".runtime-ready.json"), JSON.stringify({
    schemaVersion: 1,
    pluginVersion,
    archiveSha256
  }), "utf8");
  await writeFile(path.join(versionDir, "unity-webgl", "index.html"), "<!doctype html><html>cached</html>\n", "utf8");
  await writeFile(
    path.join(buildDir, "build-config.json"),
    JSON.stringify(
      {
        loaderFile: "runtime-entry.js",
        dataFile: "runtime-data.data",
        frameworkFile: "runtime-core.js",
        codeFile: "runtime-code.wasm",
        streamingAssetsUrl: "StreamingAssets",
        companyName: "MoonSkorch Studio",
        productName: "ReverySky Map",
        productVersion: "0.0.1"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.join(buildDir, "runtime-entry.js"), "console.log('cached entry');\n", "utf8");
  await writeFile(path.join(buildDir, "runtime-core.js"), "console.log('cached core');\n", "utf8");
  await writeFile(path.join(buildDir, "runtime-data.data"), "cached-data", "utf8");
  await writeFile(path.join(buildDir, "runtime-code.wasm"), "cached-code", "utf8");
  return path.join(versionDir, "unity-webgl");
}

type AdapterOperation = {
  method: string;
  path: string;
};

class FakeRuntimeAdapter {
  readonly operations: AdapterOperation[] = [];
  private readonly racedMkdirPaths = new Set<string>();

  constructor(
    private readonly basePath: string,
    private readonly options: {
      failMkdirOncePathIncludes?: string;
      failRmdirPathIncludes?: string;
      failWriteBinaryPathIncludes?: string;
    } = {}
  ) {}

  getName(): string {
    return "FakeRuntimeAdapter";
  }

  async exists(normalizedPath: string): Promise<boolean> {
    this.operations.push({ method: "exists", path: normalizedPath });
    try {
      await access(this.absolutePath(normalizedPath));
      return true;
    } catch {
      return false;
    }
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
    if (this.options.failWriteBinaryPathIncludes && normalizedPath.includes(this.options.failWriteBinaryPathIncludes)) {
      throw new Error(`Injected adapter write failure for ${normalizedPath}`);
    }

    await writeFile(this.absolutePath(normalizedPath), Buffer.from(data));
  }

  async mkdir(normalizedPath: string): Promise<void> {
    this.operations.push({ method: "mkdir", path: normalizedPath });
    if (
      this.options.failMkdirOncePathIncludes &&
      normalizedPath.includes(this.options.failMkdirOncePathIncludes) &&
      !this.racedMkdirPaths.has(normalizedPath)
    ) {
      this.racedMkdirPaths.add(normalizedPath);
      await mkdir(this.absolutePath(normalizedPath), { recursive: true });
      throw new Error(`Injected adapter mkdir race for ${normalizedPath}`);
    }

    await mkdir(this.absolutePath(normalizedPath));
  }

  async rmdir(normalizedPath: string, recursive: boolean): Promise<void> {
    this.operations.push({ method: "rmdir", path: normalizedPath });
    if (this.options.failRmdirPathIncludes && normalizedPath.includes(this.options.failRmdirPathIncludes)) {
      throw new Error(`Injected adapter cleanup failure for ${normalizedPath}`);
    }

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

function createAdapterRuntimeContext(root: string): {
  pluginDir: string;
  adapter: FakeRuntimeAdapter;
  context: { adapter: DataAdapter; vaultBasePath: string };
} {
  const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
  const adapter = new FakeRuntimeAdapter(root);
  return {
    pluginDir,
    adapter,
    context: {
      adapter: adapter.asDataAdapter(),
      vaultBasePath: root
    }
  };
}

describe("EmbeddedUnityRuntimeInstaller", () => {
  it("returns <pluginDir>/unity-webgl in dev mode", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await createDevRuntime(pluginDir);

      const installer = new EmbeddedUnityRuntimeInstaller();
      const resolution = await installer.resolveRuntimeDirectory(pluginDir, "1.2.3", context);

      expect(resolution).toEqual({
        runtimeDir: path.join(pluginDir, "unity-webgl"),
        extracted: false
      });
    });
  });

  it("validates SHA and creates a versioned cache on first extraction", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const resolution = await installer.resolveRuntimeDirectory(pluginDir, "9.9.9", context);
      const versionDir = path.join(pluginDir, ".reverysky-runtime", "9.9.9");
      const runtimeDir = path.join(versionDir, "unity-webgl");

      expect(resolution).toEqual({
        runtimeDir,
        extracted: true
      });
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain('"schemaVersion": 1');
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain('"pluginVersion": "9.9.9"');
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain(archive.sha256);
      expect(await readFile(path.join(runtimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
    });
  });

  it("installs archive entries through the adapter without writing runtime.tar.gz", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, adapter, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const resolution = await installer.resolveRuntimeDirectory(pluginDir, "9.9.9", context);
      const versionDir = path.join(pluginDir, ".reverysky-runtime", "9.9.9");
      const runtimeDir = path.join(versionDir, "unity-webgl");

      expect(resolution).toEqual({
        runtimeDir,
        extracted: true
      });
      expect(adapter.operations.some((operation) => operation.path.includes("runtime.tar.gz"))).toBe(false);
      expect(await pathExists(path.join(versionDir, "runtime.tar.gz"))).toBe(false);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "mkdir" && operation.path.endsWith("unity-webgl/Build")
        )
      ).toBe(true);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "writeBinary" && operation.path.endsWith("unity-webgl/Build/runtime-core.js")
        )
      ).toBe(true);
      await expect(readFile(path.join(runtimeDir, "Build", "runtime-data.data"))).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
    });
  });

  it("tolerates directories created between adapter exists and mkdir calls", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
      const adapter = new FakeRuntimeAdapter(root, {
        failMkdirOncePathIncludes: "unity-webgl/Build"
      });
      const context = {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: root
      };
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const resolution = await installer.resolveRuntimeDirectory(pluginDir, "9.9.9", context);

      expect(await pathExists(path.join(resolution.runtimeDir, "Build", "runtime-core.js"))).toBe(true);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "mkdir" && operation.path.endsWith("unity-webgl/Build")
        )
      ).toBe(true);
    });
  });

  it("fails instead of silently falling back to Node fs when adapter context is incomplete", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const adapter = new FakeRuntimeAdapter(root);
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "9.9.9", {
        adapter: adapter.asDataAdapter()
      } as never)).rejects.toThrow(/requires both an Obsidian adapter and a vault base path/i);
    });
  });

  it("fails instead of using Node fs for embedded archive installation without adapter context", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "9.9.9", undefined as never)).rejects.toThrow(
        /requires both an Obsidian adapter and a vault base path/i
      );
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "9.9.9"))).toBe(false);
    });
  });

  it("reuses a valid cache without extracting again", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const runtimeDir = await createValidCache(pluginDir, "1.0.0", "deadbeef".repeat(8));

      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: "deadbeef".repeat(8)
      });

      const resolved = await installer.resolveRuntimeDirectory(pluginDir, "1.0.0", context);
      expect(resolved).toEqual({
        runtimeDir,
        extracted: false
      });
      expect(await readFile(path.join(runtimeDir, "Build", "runtime-entry.js"), "utf8")).toContain("cached entry");
    });
  });

  it("reuses a valid adapter cache without writing files", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, adapter, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const runtimeDir = await createValidCache(pluginDir, "1.0.0", "deadbeef".repeat(8));
      const previousRuntimeDir = await createValidCache(pluginDir, "0.9.0", "deadbeef".repeat(8));
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: "deadbeef".repeat(8)
      });

      const resolved = await installer.resolveRuntimeDirectory(pluginDir, "1.0.0", context);

      expect(resolved).toEqual({
        runtimeDir,
        extracted: false
      });
      expect(adapter.operations.some((operation) => operation.method === "writeBinary")).toBe(false);
      expect(adapter.operations.some((operation) => operation.method === "write")).toBe(false);
      expect(await pathExists(previousRuntimeDir)).toBe(false);
    });
  });

  it("creates a new versioned cache during plugin update and removes the previous version cache", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const previousRuntimeDir = await createValidCache(pluginDir, "1.4.1", archive.sha256);
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const resolved = await installer.resolveRuntimeDirectory(pluginDir, "1.5.0", context);

      expect(resolved).toEqual({
        runtimeDir: path.join(pluginDir, ".reverysky-runtime", "1.5.0", "unity-webgl"),
        extracted: true
      });
      expect(await readFile(path.join(resolved.runtimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
      expect(await pathExists(previousRuntimeDir)).toBe(false);
    });
  });

  it("rebuilds a cache when the ready marker archive SHA differs", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      await createValidCache(pluginDir, "1.5.0", "deadbeef".repeat(8));
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const resolved = await installer.resolveRuntimeDirectory(pluginDir, "1.5.0", context);
      const marker = await readFile(path.join(pluginDir, ".reverysky-runtime", "1.5.0", ".runtime-ready.json"), "utf8");

      expect(resolved).toEqual({
        runtimeDir: path.join(pluginDir, ".reverysky-runtime", "1.5.0", "unity-webgl"),
        extracted: true
      });
      expect(marker).toContain(archive.sha256);
      expect(await readFile(path.join(resolved.runtimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
    });
  });

  it("uses vault-relative adapter paths inside synced folders with spaces", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "reverysky-runtime-installer-"));
    try {
      const root = path.join(tempRoot, "Google Drive", "My Drive", "Vault With Spaces");
      const { pluginDir, adapter, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await installer.resolveRuntimeDirectory(pluginDir, "9.9.9", context);

      expect(adapter.operations.length).toBeGreaterThan(0);
      expect(adapter.operations.every((operation) => !path.isAbsolute(operation.path))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("\\"))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("Google Drive"))).toBe(true);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "writeBinary" &&
          operation.path.endsWith(".obsidian/plugins/reverysky-map/.reverysky-runtime/9.9.9/unity-webgl/Build/runtime-core.js")
        )
      ).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses vault-relative adapter paths inside an iCloud Drive-style vault", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "reverysky-runtime-installer-"));
    try {
      const root = path.join(
        tempRoot,
        "Users",
        "natasha",
        "Library",
        "Mobile Documents",
        "com~apple~CloudDocs",
        "ReverySky Vault"
      );
      const { pluginDir, adapter, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await installer.resolveRuntimeDirectory(pluginDir, "9.9.9", context);

      expect(adapter.operations.length).toBeGreaterThan(0);
      expect(adapter.operations.every((operation) => !path.isAbsolute(operation.path))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("\\"))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("Mobile Documents"))).toBe(true);
      expect(adapter.operations.every((operation) => !operation.path.includes("com~apple~CloudDocs"))).toBe(true);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "write" &&
          operation.path.endsWith(".obsidian/plugins/reverysky-map/.reverysky-runtime/9.9.9/.runtime-ready.json")
        )
      ).toBe(true);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects macOS-style plugin directories outside the vault before touching the adapter", async () => {
    await withTempRoot(async (root) => {
      const vaultRoot = path.join(root, "Users", "natasha", "Documents", "ReverySky Vault");
      const pluginDir = path.join(
        root,
        "Users",
        "natasha",
        "Library",
        "Application Support",
        "obsidian",
        "plugins",
        "reverysky-map"
      );
      const adapter = new FakeRuntimeAdapter(vaultRoot);
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await mkdir(pluginDir, { recursive: true });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "9.9.9", {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: vaultRoot
      })).rejects.toThrow(/plugin directory is outside the vault/i);
      expect(adapter.operations).toHaveLength(0);
    });
  });

  it("replaces a corrupt cache", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const firstResolution = await installer.resolveRuntimeDirectory(pluginDir, "2.0.0", context);
      const firstRuntimeDir = firstResolution.runtimeDir;
      await unlink(path.join(firstRuntimeDir, "Build", "runtime-core.js"));

      const secondResolution = await installer.resolveRuntimeDirectory(pluginDir, "2.0.0", context);
      expect(secondResolution).toEqual({
        runtimeDir: firstRuntimeDir,
        extracted: true
      });
      const secondRuntimeDir = secondResolution.runtimeDir;
      expect(await readFile(path.join(secondRuntimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
    });
  });

  it("fails when runtime-code is missing and leaves no final cache", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ missingRuntimeCode: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "3.0.0", context)).rejects.toThrow(/runtime-code/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.0.0"))).toBe(false);
    });
  });

  it("does not write the ready marker when adapter installation validation fails", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, adapter, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ missingRuntimeCode: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "3.1.0", context)).rejects.toThrow(/runtime-code/i);
      expect(
        adapter.operations.some((operation) =>
          operation.method === "write" && operation.path.endsWith(".runtime-ready.json")
        )
      ).toBe(false);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.1.0"))).toBe(false);
    });
  });

  it("cleans the adapter cache when a file write is interrupted", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const adapter = new FakeRuntimeAdapter(root, {
        failWriteBinaryPathIncludes: "runtime-core.js"
      });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "3.2.0", {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: root
      })).rejects.toThrow(/injected adapter write failure/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.2.0"))).toBe(false);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.2.0", ".runtime-ready.json"))).toBe(false);
    });
  });

  it("reports the original install failure when cleanup also fails", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, ".obsidian", "plugins", "reverysky-map");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const adapter = new FakeRuntimeAdapter(root, {
        failRmdirPathIncludes: ".reverysky-runtime/3.3.0",
        failWriteBinaryPathIncludes: "runtime-core.js"
      });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "3.3.0", {
        adapter: adapter.asDataAdapter(),
        vaultBasePath: root
      })).rejects.toThrow(/injected adapter write failure.*cleanup incomplete cache also failed.*injected adapter cleanup failure/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.3.0", ".runtime-ready.json"))).toBe(false);
    });
  });

  it("fails before writing final files when the SHA is wrong", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: "0".repeat(64)
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "4.0.0", context)).rejects.toThrow(/sha-256 mismatch/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "4.0.0"))).toBe(false);
    });
  });

  it("rejects path traversal entries", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ traversalEntry: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "5.0.0", context)).rejects.toThrow(/escapes unity-webgl/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "5.0.0"))).toBe(false);
    });
  });

  it("rejects symbolic link entries", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ symlinkEntry: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "6.0.0", context)).rejects.toThrow(/link entry/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "6.0.0"))).toBe(false);
    });
  });

  it("rejects hard link entries", async () => {
    await withTempRoot(async (root) => {
      const { pluginDir, context } = createAdapterRuntimeContext(root);
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ hardlinkEntry: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "6.1.0", context)).rejects.toThrow(/link entry/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "6.1.0"))).toBe(false);
    });
  });
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
