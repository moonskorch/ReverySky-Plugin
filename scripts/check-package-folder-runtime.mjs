/**
 * Validates root plugin assets and local Unity WebGL files for folder-runtime builds.
 */
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackageManifest } from "./check-package-manifest.mjs";
import { getPackageModeMarker } from "./package-mode-marker.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const buildDir = path.join(repoRoot, "unity-webgl", "Build");

const requiredPaths = [
  "main.js",
  "manifest.json",
  "styles.css",
  "unity-webgl/index.html",
  "unity-webgl/Build/build-config.json",
  "unity-webgl/Build/build-config.js",
  "unity-webgl/Build/runtime-entry.js",
  "unity-webgl/Build/runtime-core.js"
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`[check:package:folder-runtime] ${message}`);
  process.exit(1);
}

async function countBuildArtifactsByPrefix(prefix) {
  let entries;
  try {
    entries = await readdir(buildDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  return entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix)).length;
}

async function main() {
  const missing = [];
  const invalid = [];
  for (const relativePath of requiredPaths) {
    if (!(await pathExists(path.join(repoRoot, relativePath)))) {
      missing.push(relativePath);
    }
  }
  const runtimeDataCount = await countBuildArtifactsByPrefix("runtime-data.");
  const runtimeCodeCount = await countBuildArtifactsByPrefix("runtime-code.");
  if (runtimeDataCount === 0) {
    missing.push("unity-webgl/Build/runtime-data.*");
  } else if (runtimeDataCount > 1) {
    invalid.push(`Expected exactly one unity-webgl/Build/runtime-data.* file, found ${runtimeDataCount}.`);
  }
  if (runtimeCodeCount === 0) {
    missing.push("unity-webgl/Build/runtime-code.*");
  } else if (runtimeCodeCount > 1) {
    invalid.push(`Expected exactly one unity-webgl/Build/runtime-code.* file, found ${runtimeCodeCount}.`);
  }
  if (missing.length > 0 || invalid.length > 0) {
    fail([...missing.map((relativePath) => `Missing required file: ${relativePath}`), ...invalid].join(" "));
  }
  await checkPackageManifest(repoRoot, fail);

  const mainJs = await readFile(path.join(repoRoot, "main.js"), "utf8");
  const firstLine = mainJs.split(/\r?\n/, 1)[0];
  if (firstLine !== getPackageModeMarker("folder-runtime")) {
    fail(`Unexpected first-line marker: ${firstLine}`);
  }
  for (const marker of [
    "window.__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__ =",
    "window.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__ = function",
    "window.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function"
  ]) {
    if (mainJs.includes(marker)) {
      fail(`main.js must not contain embedded runtime marker: ${marker}`);
    }
  }

  console.log("[check:package:folder-runtime] OK");
}

await main();
