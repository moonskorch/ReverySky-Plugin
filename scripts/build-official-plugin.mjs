import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");
const rootStylesPath = path.join(repoRoot, "styles.css");
const generatedIndexHtmlPath = path.join(repoRoot, "unity-webgl", "index.html");
const officialDir = path.join(repoRoot, "dist", "official");
const officialMainJsPath = path.join(officialDir, "main.js");
const officialManifestPath = path.join(officialDir, "manifest.json");
const officialStylesPath = path.join(officialDir, "styles.css");
const packagingReportPath = path.join(repoRoot, "dist", "official-packaging-report.json");

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

  await rm(officialDir, { recursive: true, force: true });
  await mkdir(officialDir, { recursive: true });

  const rootMainJs = await readFile(rootMainJsPath, "utf8");
  const banner =
    "/* ReverySky official embedded Unity WebGL runtime */\n" +
    `globalThis.__REVERYSKY_EMBEDDED_UNITY_INDEX_HTML__ = ${JSON.stringify(indexHtml)};\n\n`;
  const officialMainJs = `${banner}${rootMainJs}`;

  await writeFile(officialMainJsPath, officialMainJs, "utf8");
  await copyFile(rootManifestPath, officialManifestPath);
  await copyFile(rootStylesPath, officialStylesPath);

  const [
    generatedIndexHtmlStat,
    rootMainJsStat,
    officialMainJsStat,
    manifestStat,
    stylesStat
  ] = await Promise.all([
    stat(generatedIndexHtmlPath),
    stat(rootMainJsPath),
    stat(officialMainJsPath),
    stat(officialManifestPath),
    stat(officialStylesPath)
  ]);

  const report = {
    mode: "embedded-in-memory-index-html",
    generatedIndexHtmlBytes: generatedIndexHtmlStat.size,
    normalMainJsBytes: rootMainJsStat.size,
    officialMainJsBytes: officialMainJsStat.size,
    officialMainJsOverheadBytes: officialMainJsStat.size - rootMainJsStat.size,
    manifestBytes: manifestStat.size,
    stylesBytes: stylesStat.size
  };

  if (report.officialMainJsOverheadBytes < 0) {
    throw new Error("official main.js is smaller than root main.js, which is unexpected.");
  }

  await writeFile(packagingReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const toMiB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);
  console.log(
    "[build:official] indexHtml=%s MiB rootMain=%s MiB officialMain=%s MiB overhead=%s MiB manifest=%s MiB styles=%s MiB",
    toMiB(report.generatedIndexHtmlBytes),
    toMiB(report.normalMainJsBytes),
    toMiB(report.officialMainJsBytes),
    toMiB(report.officialMainJsOverheadBytes),
    toMiB(report.manifestBytes),
    toMiB(report.stylesBytes)
  );
  console.log(`[build:official] Wrote ${path.relative(repoRoot, officialDir)}`);
  console.log(`[build:official] Wrote ${path.relative(repoRoot, packagingReportPath)}`);
}

await main();
