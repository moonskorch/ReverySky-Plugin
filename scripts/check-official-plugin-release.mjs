import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const officialDir = path.join(repoRoot, "dist", "official");
const officialMainJsPath = path.join(officialDir, "main.js");
const officialManifestPath = path.join(officialDir, "manifest.json");
const officialStylesPath = path.join(officialDir, "styles.css");
const packagingReportPath = path.join(repoRoot, "dist", "official-packaging-report.json");
const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const generatedIndexHtmlPath = path.join(repoRoot, "unity-webgl", "index.html");

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`[check:official-release] ${message}`);
  process.exit(1);
}

async function main() {
  const requiredPaths = [
    officialMainJsPath,
    officialManifestPath,
    officialStylesPath,
    packagingReportPath
  ];

  for (const targetPath of requiredPaths) {
    if (!(await pathExists(targetPath))) {
      fail(`Missing required file: ${path.relative(repoRoot, targetPath)}`);
    }
  }

  const entries = await readdir(officialDir, { withFileTypes: true });
  const entryNames = entries.map((entry) => entry.name).sort();
  const expectedNames = ["main.js", "manifest.json", "styles.css"];
  if (
    entryNames.length !== expectedNames.length ||
    expectedNames.some((name, index) => entryNames[index] !== name)
  ) {
    fail(`dist/official must contain exactly ${expectedNames.join(", ")}; found ${entryNames.join(", ")}`);
  }

  const mainJs = await readFile(officialMainJsPath, "utf8");
  for (const marker of [
    "__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__",
    "unity-build-config",
    "unity-loader-source",
    "unity-framework-source",
    "unity-data-source",
    "unity-code-source"
  ]) {
    if (!mainJs.includes(marker)) {
      fail(`dist/official/main.js is missing marker: ${marker}`);
    }
  }

  const [officialMainJsStat, rootMainJsStat, generatedIndexHtmlStat] = await Promise.all([
    stat(officialMainJsPath),
    stat(rootMainJsPath),
    stat(generatedIndexHtmlPath)
  ]);
  if (officialMainJsStat.size <= rootMainJsStat.size) {
    fail("dist/official/main.js must be larger than root main.js.");
  }

  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const officialManifest = JSON.parse(await readFile(officialManifestPath, "utf8"));
  if (rootManifest.version !== officialManifest.version) {
    fail(`Manifest version mismatch: root=${rootManifest.version} official=${officialManifest.version}`);
  }

  const report = JSON.parse(await readFile(packagingReportPath, "utf8"));
  if (report.mode !== "embedded-in-memory-index-html") {
    fail(`Unexpected packaging report mode: ${report.mode}`);
  }
  if (report.normalMainJsBytes !== rootMainJsStat.size) {
    fail(
      `Packaging report normalMainJsBytes=${report.normalMainJsBytes} does not match actual size ${rootMainJsStat.size}.`
    );
  }
  if (report.officialMainJsBytes !== officialMainJsStat.size) {
    fail(
      `Packaging report officialMainJsBytes=${report.officialMainJsBytes} does not match actual size ${officialMainJsStat.size}.`
    );
  }
  if (report.officialMainJsOverheadBytes !== officialMainJsStat.size - rootMainJsStat.size) {
    fail(
      `Packaging report officialMainJsOverheadBytes=${report.officialMainJsOverheadBytes} does not match the computed overhead ${officialMainJsStat.size - rootMainJsStat.size}.`
    );
  }
  if (report.generatedIndexHtmlBytes !== generatedIndexHtmlStat.size) {
    fail(
      `Packaging report generatedIndexHtmlBytes=${report.generatedIndexHtmlBytes} does not match actual size ${generatedIndexHtmlStat.size}.`
    );
  }
  if (report.manifestBytes !== (await stat(officialManifestPath)).size) {
    fail(`Packaging report manifestBytes=${report.manifestBytes} does not match the copied manifest size.`);
  }
  if (report.stylesBytes !== (await stat(officialStylesPath)).size) {
    fail(`Packaging report stylesBytes=${report.stylesBytes} does not match the copied styles size.`);
  }

  if (await pathExists(path.join(officialDir, "unity-webgl"))) {
    fail("dist/official must not contain unity-webgl/.");
  }

  console.log("[check:official-release] OK");
}

await main();
