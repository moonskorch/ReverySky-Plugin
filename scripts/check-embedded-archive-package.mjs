/**
 * Validates root release assets for the embedded-archive package mode.
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
  console.error(`[check:package:embedded-archive] ${message}`);
  process.exit(1);
}

async function main() {
  for (const targetPath of [
    rootMainJsPath,
    rootManifestPath,
    rootStylesPath
  ]) {
    if (!(await pathExists(targetPath))) {
      fail(`Missing required file: ${path.relative(repoRoot, targetPath)}`);
    }
  }
  await checkPackageManifest(repoRoot, fail);

  const mainJs = await readFile(rootMainJsPath, "utf8");
  const firstLine = mainJs.split(/\r?\n/, 1)[0];
  if (firstLine !== getPackageModeMarker("embedded-archive")) {
    fail(`Unexpected first-line marker: ${firstLine}`);
  }

  for (const marker of [
    "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__",
    "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__"
  ]) {
    if (!mainJs.includes(marker)) {
      fail(`main.js is missing embedded archive marker: ${marker}`);
    }
  }

  if (mainJs.includes("window.__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__ =")) {
    fail("main.js must not contain embedded HTML marker.");
  }

  if (!/window\.__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__ = function/.test(mainJs)) {
    fail("main.js is missing the archive SHA function.");
  }

  console.log("[check:package:embedded-archive] OK");
}

await main();
