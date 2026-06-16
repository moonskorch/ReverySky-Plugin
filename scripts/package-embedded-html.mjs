/**
 * Builds the embedded-html payload wrapper around the current root main.js.
 */
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stripPackageModeMarker,
  writeRootMainJsWithPackageMode
} from "./package-mode-marker.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const rootStylesPath = path.join(repoRoot, "styles.css");
const generatedIndexHtmlPath = path.join(repoRoot, "unity-webgl", "index.html");
const distDir = path.join(repoRoot, "dist");
const packagingReportPath = path.join(distDir, "embedded-html-packaging-report.json");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractEmbeddedScript(html, scriptId) {
  const pattern = new RegExp(
    `<script\\s+id="${escapeRegExp(scriptId)}"[^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Missing <script id="${scriptId}"> in unity-webgl/index.html.`);
  }

  const value = match[1].trim();
  if (!value) {
    throw new Error(`Embedded value for ${scriptId} is empty in unity-webgl/index.html.`);
  }

  return value;
}

function ensureNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is missing or empty in unity-webgl/index.html.`);
  }
}

async function ensureFile(targetPath, label) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`Missing ${label} at ${path.relative(repoRoot, targetPath)}.`);
  }
}

async function main() {
  await ensureFile(rootMainJsPath, "root main.js");
  await ensureFile(rootManifestPath, "manifest.json");
  await ensureFile(rootStylesPath, "styles.css");
  await ensureFile(generatedIndexHtmlPath, "unity-webgl/index.html");

  const indexHtml = await readFile(generatedIndexHtmlPath, "utf8");
  if (indexHtml.length === 0) {
    throw new Error("unity-webgl/index.html is empty.");
  }

  const buildConfigRaw = extractEmbeddedScript(indexHtml, "unity-build-config");
  const loaderSource = extractEmbeddedScript(indexHtml, "unity-loader-source");
  const frameworkSource = extractEmbeddedScript(indexHtml, "unity-framework-source");
  const dataSource = extractEmbeddedScript(indexHtml, "unity-data-source");
  const codeSource = extractEmbeddedScript(indexHtml, "unity-code-source");

  const buildConfig = JSON.parse(buildConfigRaw);
  ensureNonEmptyString(buildConfig.loaderFile, "unity-build-config.loaderFile");
  ensureNonEmptyString(buildConfig.frameworkFile, "unity-build-config.frameworkFile");
  ensureNonEmptyString(buildConfig.dataFile, "unity-build-config.dataFile");
  ensureNonEmptyString(buildConfig.codeFile, "unity-build-config.codeFile");
  ensureNonEmptyString(loaderSource, "unity-loader-source");
  ensureNonEmptyString(frameworkSource, "unity-framework-source");
  ensureNonEmptyString(dataSource, "unity-data-source");
  ensureNonEmptyString(codeSource, "unity-code-source");

  const rootMainJs = stripPackageModeMarker(await readFile(rootMainJsPath, "utf8"));
  const banner =
    `globalThis.__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__ = ${JSON.stringify(indexHtml)};\n\n`;
  const packageMainJs = `${banner}${rootMainJs}`;

  await writeRootMainJsWithPackageMode(repoRoot, "embedded-html", packageMainJs);
  await mkdir(distDir, { recursive: true });

  const [
    generatedIndexHtmlStat,
    packageMainJsStat,
    manifestStat,
    stylesStat
  ] = await Promise.all([
    stat(generatedIndexHtmlPath),
    stat(rootMainJsPath),
    stat(rootManifestPath),
    stat(rootStylesPath)
  ]);

  const report = {
    mode: "embedded-html",
    generatedIndexHtmlBytes: generatedIndexHtmlStat.size,
    normalMainJsBytes: Buffer.byteLength(rootMainJs, "utf8"),
    packageMainJsBytes: packageMainJsStat.size,
    packageMainJsOverheadBytes: packageMainJsStat.size - Buffer.byteLength(rootMainJs, "utf8"),
    manifestBytes: manifestStat.size,
    stylesBytes: stylesStat.size
  };

  if (report.packageMainJsOverheadBytes < 0) {
    throw new Error("embedded-html main.js is smaller than the normal main.js, which is unexpected.");
  }

  await writeFile(packagingReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
  console.log(
    "[package:embedded-html] indexHtml=%s MiB normal-main=%s MiB package-main=%s MiB overhead=%s MiB manifest=%s MiB styles=%s MiB",
    toMiB(report.generatedIndexHtmlBytes),
    toMiB(report.normalMainJsBytes),
    toMiB(report.packageMainJsBytes),
    toMiB(report.packageMainJsOverheadBytes),
    toMiB(report.manifestBytes),
    toMiB(report.stylesBytes)
  );
  console.log("[package:embedded-html] Wrote main.js");
  console.log(`[package:embedded-html] Wrote ${path.relative(repoRoot, packagingReportPath)}`);
}

await main();
