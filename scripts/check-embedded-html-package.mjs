/**
 * Validates root release assets for the embedded-html package mode.
 */
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackageManifest } from "./check-package-manifest.mjs";
import { getPackageModeMarker } from "./package-mode-marker.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const rootStylesPath = path.join(repoRoot, "styles.css");

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`[check:package:embedded-html] ${message}`);
  process.exit(1);
}

async function main() {
  const requiredPaths = [
    rootMainJsPath,
    rootManifestPath,
    rootStylesPath
  ];

  for (const targetPath of requiredPaths) {
    if (!(await pathExists(targetPath))) {
      fail(`Missing required file: ${path.relative(repoRoot, targetPath)}`);
    }
  }
  await checkPackageManifest(repoRoot, fail);

  const mainJs = await readFile(rootMainJsPath, "utf8");
  const firstLine = mainJs.split(/\r?\n/, 1)[0];
  if (firstLine !== getPackageModeMarker("embedded-html")) {
    fail(`Unexpected first-line marker: ${firstLine}`);
  }

  for (const marker of [
    "globalThis.__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__ =",
    "unity-build-config",
    "unity-loader-source",
    "unity-framework-source",
    "unity-data-source",
    "unity-code-source"
  ]) {
    if (!mainJs.includes(marker)) {
      fail(`main.js is missing embedded HTML marker: ${marker}`);
    }
  }

  for (const archiveMarker of [
    "globalThis.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__ = function",
    "globalThis.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function"
  ]) {
    if (mainJs.includes(archiveMarker)) {
      fail(`main.js must not contain embedded archive marker: ${archiveMarker}`);
    }
  }

  console.log("[check:package:embedded-html] OK");
}

await main();
