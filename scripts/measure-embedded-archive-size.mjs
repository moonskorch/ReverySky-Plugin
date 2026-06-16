/**
 * Estimates embedded-archive package size from the current Unity WebGL runtime.
 */
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { stripPackageModeMarker } from "./package-mode-marker.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const reportPath = path.join(distDir, "embedded-archive-size-report.json");

const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const rootStylesPath = path.join(repoRoot, "styles.css");
const buildDir = path.join(repoRoot, "unity-webgl", "Build");
const streamingAssetsDir = path.join(repoRoot, "unity-webgl", "StreamingAssets");

const wrapperTemplate = [
  "/* ReverySky package mode: embedded-archive */",
  'globalThis.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__ = function () { return ""; };',
  'globalThis.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function () { return ""; };'
].join("\n") + "\n";

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(targetPath, label) {
  if (!(await pathExists(targetPath))) {
    throw new Error(`Missing ${label} at ${path.relative(repoRoot, targetPath)}.`);
  }
}

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function calculateBase64Characters(byteLength) {
  return Math.ceil(byteLength / 3) * 4;
}

function stripEmbeddedArchiveWrapper(source) {
  return source.replace(
    /^globalThis\.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__ = function \(\) \{\r?\n  return "[A-Za-z0-9+/=]*";\r?\n\};\r?\nglobalThis\.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function \(\) \{\r?\n  return "[0-9a-f]{64}";\r?\n\};\r?\n\r?\n/,
    ""
  );
}

async function readNormalMainJsBytes() {
  const mainJs = stripEmbeddedArchiveWrapper(
    stripPackageModeMarker(await readFile(rootMainJsPath, "utf8"))
  );

  return Buffer.byteLength(mainJs, "utf8");
}

function splitTarPath(fullPath) {
  if (Buffer.byteLength(fullPath, "utf8") <= 100) {
    return { name: fullPath, prefix: "" };
  }

  const parts = fullPath.split("/");
  for (let splitIndex = parts.length - 1; splitIndex > 0; splitIndex -= 1) {
    const prefix = parts.slice(0, splitIndex).join("/");
    const name = parts.slice(splitIndex).join("/");
    if (Buffer.byteLength(name, "utf8") <= 100 && Buffer.byteLength(prefix, "utf8") <= 155) {
      return { name, prefix };
    }
  }

  throw new Error(`Tar path is too long: ${fullPath}`);
}

function writeTarString(buffer, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function writeTarOctal(buffer, value, offset, length) {
  const padded = value.toString(8).padStart(length - 1, "0");
  buffer.write(`${padded}\0`, offset, length, "ascii");
}

function createTarHeader(relativePath, size, typeflag = "0", mode = 0o644) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(relativePath);

  writeTarString(header, name, 0, 100);
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = typeflag.charCodeAt(0);
  writeTarString(header, "ustar", 257, 6);
  writeTarString(header, "00", 263, 2);
  writeTarString(header, prefix, 345, 155);

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumOctal = checksum.toString(8).padStart(6, "0");
  bufferWriteAscii(header, `${checksumOctal}\0 `, 148);

  return header;
}

function bufferWriteAscii(buffer, value, offset) {
  buffer.write(value, offset, value.length, "ascii");
}

async function collectFilesRecursive(rootDir, baseDir = rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported filesystem entry in compact runtime: ${absolutePath}`);
      }
      const relativePath = toPosixPath(path.relative(baseDir, absolutePath));
      const fileStat = await stat(absolutePath);
      files.push({
        path: relativePath,
        bytes: fileStat.size,
        absolutePath
      });
    }
  }

  await walk(rootDir);
  return files;
}

async function copyDirectoryRecursive(sourceDir, targetDir) {
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
      throw new Error(`Unsupported filesystem entry in StreamingAssets: ${sourcePath}`);
    }
    await copyFile(sourcePath, targetPath);
  }
}

function buildArchiveBuffer(entries, fileBuffers) {
  const chunks = [];
  for (const entry of entries) {
    const header = createTarHeader(entry.path, entry.bytes);
    chunks.push(header);
    chunks.push(fileBuffers.get(entry.absolutePath));
    const remainder = entry.bytes % 512;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

function createPlaceholderIndexHtml() {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "  <title>ReverySky Map</title>",
    "</head>",
    "<body>",
    "  <div>ReverySky Map</div>",
    "</body>",
    "</html>"
  ].join("\n") + "\n";
}

async function stageCompactRuntime(tempRoot) {
  const runtimeRoot = path.join(tempRoot, "unity-webgl");
  const buildOutput = await readFile(path.join(buildDir, "build-config.json"), "utf8");
  const buildConfig = JSON.parse(buildOutput.replace(/^\uFEFF/, ""));
  const requiredBuildFiles = [
    buildConfig.loaderFile,
    buildConfig.frameworkFile,
    buildConfig.dataFile,
    buildConfig.codeFile,
    "build-config.json"
  ];

  for (const relativeBuildFile of requiredBuildFiles) {
    await ensureFile(path.join(buildDir, relativeBuildFile), `unity-webgl/Build/${relativeBuildFile}`);
  }

  await mkdir(path.join(runtimeRoot, "Build"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "index.html"), createPlaceholderIndexHtml(), "utf8");
  await copyFile(path.join(buildDir, "build-config.json"), path.join(runtimeRoot, "Build", "build-config.json"));

  for (const relativeBuildFile of [
    buildConfig.loaderFile,
    buildConfig.frameworkFile,
    buildConfig.dataFile,
    buildConfig.codeFile
  ]) {
    await copyFile(
      path.join(buildDir, relativeBuildFile),
      path.join(runtimeRoot, "Build", relativeBuildFile)
    );
  }

  const hasStreamingAssets = await pathExists(streamingAssetsDir);
  if (hasStreamingAssets) {
    await copyDirectoryRecursive(streamingAssetsDir, path.join(runtimeRoot, "StreamingAssets"));
  }

  return runtimeRoot;
}

async function main() {
  await ensureFile(rootMainJsPath, "root main.js");
  await ensureFile(rootManifestPath, "manifest.json");
  await ensureFile(rootStylesPath, "styles.css");
  await ensureFile(path.join(buildDir, "build-config.json"), "unity-webgl/Build/build-config.json");

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "reverysky-embedded-archive-size-"));
  try {
    await stageCompactRuntime(tempRoot);
    const runtimeFiles = await collectFilesRecursive(tempRoot);
    runtimeFiles.sort((left, right) => left.path.localeCompare(right.path));

    const fileBuffers = new Map();
    for (const file of runtimeFiles) {
      fileBuffers.set(file.absolutePath, await readFile(file.absolutePath));
    }

    const archiveBuffer = buildArchiveBuffer(runtimeFiles, fileBuffers);
    const archiveSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
    const archiveBase64Characters = calculateBase64Characters(archiveBuffer.length);
    const normalMainJsBytes = await readNormalMainJsBytes();
    const compactRuntimeBytes = runtimeFiles.reduce((total, file) => total + file.bytes, 0);
    const projectedPackageMainJsBytes =
      normalMainJsBytes +
      archiveBase64Characters +
      Buffer.byteLength(wrapperTemplate, "utf8") +
      archiveSha256.length;

    const report = {
      mode: "embedded-archive-size-gate",
      normalMainJsBytes,
      compactRuntimeBytes,
      archiveTarGzBytes: archiveBuffer.length,
      archiveBase64Characters,
      projectedPackageMainJsBytes,
      archiveSha256,
      files: runtimeFiles.map((file) => ({
        path: file.path,
        bytes: file.bytes
      }))
    };

    await mkdir(distDir, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
    console.log(
      "[measure:embedded-archive] main=%s MiB compact=%s MiB tar.gz=%s MiB projected=%s MiB",
      toMiB(report.normalMainJsBytes),
      toMiB(report.compactRuntimeBytes),
      toMiB(report.archiveTarGzBytes),
      toMiB(report.projectedPackageMainJsBytes)
    );
    console.log(`[measure:embedded-archive] Wrote ${path.relative(repoRoot, reportPath)}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await main();
