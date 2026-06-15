import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
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

describe("EmbeddedUnityRuntimeInstaller", () => {
  it("returns <pluginDir>/unity-webgl in dev mode", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await createDevRuntime(pluginDir);

      const installer = new EmbeddedUnityRuntimeInstaller();
      const runtimeDir = await installer.resolveRuntimeDirectory(pluginDir, "1.2.3");

      expect(runtimeDir).toBe(path.join(pluginDir, "unity-webgl"));
    });
  });

  it("validates SHA and creates a versioned cache on first extraction", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const runtimeDir = await installer.resolveRuntimeDirectory(pluginDir, "9.9.9");
      const versionDir = path.join(pluginDir, ".reverysky-runtime", "9.9.9");

      expect(runtimeDir).toBe(path.join(versionDir, "unity-webgl"));
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain('"schemaVersion": 1');
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain('"pluginVersion": "9.9.9"');
      expect(await readFile(path.join(versionDir, ".runtime-ready.json"), "utf8")).toContain(archive.sha256);
      expect(await readFile(path.join(runtimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
    });
  });

  it("reuses a valid cache without extracting again", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const runtimeDir = await createValidCache(pluginDir, "1.0.0", "deadbeef".repeat(8));

      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: "deadbeef".repeat(8)
      });

      const resolved = await installer.resolveRuntimeDirectory(pluginDir, "1.0.0");
      expect(resolved).toBe(runtimeDir);
      expect(await readFile(path.join(runtimeDir, "Build", "runtime-entry.js"), "utf8")).toContain("cached entry");
    });
  });

  it("replaces a corrupt cache", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      const firstRuntimeDir = await installer.resolveRuntimeDirectory(pluginDir, "2.0.0");
      await unlink(path.join(firstRuntimeDir, "Build", "runtime-core.js"));

      const secondRuntimeDir = await installer.resolveRuntimeDirectory(pluginDir, "2.0.0");
      expect(secondRuntimeDir).toBe(firstRuntimeDir);
      expect(await readFile(path.join(secondRuntimeDir, "Build", "runtime-core.js"), "utf8")).toContain("runtime-core");
    });
  });

  it("fails when runtime-code is missing and leaves no final cache", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ missingRuntimeCode: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "3.0.0")).rejects.toThrow(/runtime-code/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "3.0.0"))).toBe(false);
    });
  });

  it("fails before writing final files when the SHA is wrong", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive();
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: "0".repeat(64)
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "4.0.0")).rejects.toThrow(/sha-256 mismatch/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "4.0.0"))).toBe(false);
    });
  });

  it("rejects path traversal entries", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ traversalEntry: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "5.0.0")).rejects.toThrow(/escapes unity-webgl/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "5.0.0"))).toBe(false);
    });
  });

  it("rejects symbolic link entries", async () => {
    await withTempRoot(async (root) => {
      const pluginDir = path.join(root, "plugin");
      await mkdir(pluginDir, { recursive: true });
      const archive = createFakeRuntimeArchive({ symlinkEntry: true });
      const installer = new EmbeddedUnityRuntimeInstaller({
        archiveBase64: archive.base64,
        archiveSha256: archive.sha256
      });

      await expect(installer.resolveRuntimeDirectory(pluginDir, "6.0.0")).rejects.toThrow(/link entry/i);
      expect(await pathExists(path.join(pluginDir, ".reverysky-runtime", "6.0.0"))).toBe(false);
    });
  });
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}
