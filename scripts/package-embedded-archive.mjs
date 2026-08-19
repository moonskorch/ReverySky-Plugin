/**
 * Builds the embedded-archive payload wrapper around the current root main.js.
 */
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
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import {
  stripPackageModeMarker,
  writeRootMainJsWithPackageMode
} from "./package-mode-marker.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const distDir = path.join(repoRoot, "dist");
const packagingReportPath = path.join(distDir, "embedded-archive-packaging-report.json");
const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const rootStylesPath = path.join(repoRoot, "styles.css");
const runtimeTemplatePath = path.join(repoRoot, "unity-webgl", "index.disk-runtime.template.html");
const buildDir = path.join(repoRoot, "unity-webgl", "Build");
const streamingAssetsDir = path.join(repoRoot, "unity-webgl", "StreamingAssets");
const droidSansFallbackLicensePath = path.join(
  repoRoot,
  "unity",
  "ReverySkyMap",
  "Assets",
  "Fonts",
  "DroidSans",
  "Apache-2.0.txt"
);
const droidSansFallbackRuntimeLicenseName = "DroidSansFallback-LICENSE.txt";

function fail(message) {
  throw new Error(message);
}

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
    fail(`Missing ${label}: ${path.relative(repoRoot, targetPath)}`);
  }
}

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function findUniqueFileByPrefix(directoryPath, prefix) {
  const matches = [];
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    fail(`Unable to read ${path.relative(repoRoot, directoryPath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith(prefix)) {
      matches.push(entry.name);
    }
  }

  if (matches.length === 0) {
    fail(`Missing ${prefix}* in ${path.relative(repoRoot, directoryPath)}`);
  }
  if (matches.length > 1) {
    fail(`Expected exactly one ${prefix}* in ${path.relative(repoRoot, directoryPath)}, found ${matches.length}`);
  }

  return matches[0];
}

async function copyDirectoryRecursive(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      fail(`Unsupported StreamingAssets entry: ${sourcePath}`);
    }
    await copyFile(sourcePath, targetPath);
  }
}

async function collectFilesRecursive(rootDir) {
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
        fail(`Unsupported runtime entry: ${absolutePath}`);
      }
      const fileStat = await stat(absolutePath);
      files.push({
        path: toPosixPath(path.relative(rootDir, absolutePath)),
        bytes: fileStat.size,
        absolutePath
      });
    }
  }

  await walk(rootDir);
  return files;
}

async function stageCompactRuntime(tempRoot) {
  const runtimeRoot = path.join(tempRoot, "unity-webgl");
  const buildConfigPath = path.join(buildDir, "build-config.json");
  await ensureFile(runtimeTemplatePath, "unity-webgl/index.disk-runtime.template.html");
  await ensureFile(buildConfigPath, "unity-webgl/Build/build-config.json");
  await ensureFile(path.join(buildDir, "runtime-entry.js"), "unity-webgl/Build/runtime-entry.js");
  await ensureFile(path.join(buildDir, "runtime-core.js"), "unity-webgl/Build/runtime-core.js");
  const buildConfigRaw = await readFile(buildConfigPath, "utf8");
  const buildConfig = JSON.parse(buildConfigRaw.replace(/^\uFEFF/, ""));
  const runtimeDataFile = await findUniqueFileByPrefix(buildDir, "runtime-data.");
  const runtimeCodeFile = await findUniqueFileByPrefix(buildDir, "runtime-code.");

  for (const [relativePath, label] of [
    [runtimeTemplatePath, "unity-webgl/index.disk-runtime.template.html"],
    [buildConfigPath, "unity-webgl/Build/build-config.json"],
    [path.join(buildDir, "runtime-entry.js"), "unity-webgl/Build/runtime-entry.js"],
    [path.join(buildDir, "runtime-core.js"), "unity-webgl/Build/runtime-core.js"],
    [path.join(buildDir, runtimeDataFile), `unity-webgl/Build/${runtimeDataFile}`],
    [path.join(buildDir, runtimeCodeFile), `unity-webgl/Build/${runtimeCodeFile}`],
    [droidSansFallbackLicensePath, "Droid Sans Fallback license"]
  ]) {
    await ensureFile(relativePath, label);
  }

  if (buildConfig.loaderFile !== "runtime-entry.js") {
    fail(`Unexpected loaderFile in build-config.json: ${buildConfig.loaderFile}`);
  }
  if (buildConfig.frameworkFile !== "runtime-core.js") {
    fail(`Unexpected frameworkFile in build-config.json: ${buildConfig.frameworkFile}`);
  }

  await mkdir(path.join(runtimeRoot, "Build"), { recursive: true });
  await copyFile(runtimeTemplatePath, path.join(runtimeRoot, "index.html"));
  await copyFile(buildConfigPath, path.join(runtimeRoot, "Build", "build-config.json"));
  await copyFile(path.join(buildDir, "runtime-entry.js"), path.join(runtimeRoot, "Build", "runtime-entry.js"));
  await copyFile(path.join(buildDir, "runtime-core.js"), path.join(runtimeRoot, "Build", "runtime-core.js"));
  await copyFile(path.join(buildDir, runtimeDataFile), path.join(runtimeRoot, "Build", runtimeDataFile));
  await copyFile(path.join(buildDir, runtimeCodeFile), path.join(runtimeRoot, "Build", runtimeCodeFile));
  await copyFile(
    droidSansFallbackLicensePath,
    path.join(runtimeRoot, droidSansFallbackRuntimeLicenseName)
  );

  if (await pathExists(streamingAssetsDir)) {
    await copyDirectoryRecursive(streamingAssetsDir, path.join(runtimeRoot, "StreamingAssets"));
  }

  return {
    runtimeRoot,
    compactFiles: await collectFilesRecursive(runtimeRoot)
  };
}

async function buildTarGzArchive(sourceRoot, archivePath) {
  await tar.c({
    cwd: sourceRoot,
    file: archivePath,
    gzip: true,
    portable: true,
    strict: true,
    noMtime: true
  }, ["unity-webgl"]);
}

async function main() {
  await ensureFile(rootMainJsPath, "root main.js");
  await ensureFile(rootManifestPath, "manifest.json");
  await ensureFile(rootStylesPath, "styles.css");

  await mkdir(distDir, { recursive: true });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "reverysky-embedded-archive-"));
  const archivePath = path.join(tempRoot, "runtime.tar.gz");

  try {
    const staged = await stageCompactRuntime(tempRoot);
    await buildTarGzArchive(tempRoot, archivePath);

    const archiveBuffer = await readFile(archivePath);
    const archiveBase64 = archiveBuffer.toString("base64");
    const archiveSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
    const normalMainJs = stripPackageModeMarker(await readFile(rootMainJsPath, "utf8"));
    const packageMainJs = [
      "window.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__ = function () {",
      `  return ${JSON.stringify(archiveBase64)};`,
      "};",
      "window.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function () {",
      `  return ${JSON.stringify(archiveSha256)};`,
      "};",
      "",
      normalMainJs
    ].join("\n");

    await writeRootMainJsWithPackageMode(repoRoot, "embedded-archive", packageMainJs);

    const compactFiles = await Promise.all(
      staged.compactFiles.map(async (file) => ({
        path: file.path,
        bytes: (await stat(file.absolutePath)).size
      }))
    );
    const archiveStat = await stat(archivePath);
    const packageMainJsStat = await stat(rootMainJsPath);

    const report = {
      mode: "embedded-archive",
      generatedDevIndexHtmlBytes: 0,
      compactRuntimeBytes: compactFiles.reduce((total, file) => total + file.bytes, 0),
      archiveTarGzBytes: archiveStat.size,
      archiveBase64Characters: archiveBase64.length,
      normalMainJsBytes: Buffer.byteLength(normalMainJs, "utf8"),
      packageMainJsBytes: packageMainJsStat.size,
      archiveSha256,
      files: compactFiles
    };

    await writeFile(packagingReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
    console.log(
      "[package:embedded-archive] compact=%s MiB tar.gz=%s MiB archive-base64=%s MiB normal-main=%s MiB package-main=%s MiB",
      toMiB(report.compactRuntimeBytes),
      toMiB(report.archiveTarGzBytes),
      toMiB(Buffer.byteLength(archiveBase64, "utf8")),
      toMiB(report.normalMainJsBytes),
      toMiB(report.packageMainJsBytes)
    );
    console.log("[package:embedded-archive] Wrote main.js");
    console.log(`[package:embedded-archive] Wrote ${path.relative(repoRoot, packagingReportPath)}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(`[package:embedded-archive] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
