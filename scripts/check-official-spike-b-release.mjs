import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const officialDir = path.join(repoRoot, "dist", "official-spike-b");
const officialMainJsPath = path.join(officialDir, "main.js");
const officialManifestPath = path.join(officialDir, "manifest.json");
const officialStylesPath = path.join(officialDir, "styles.css");
const packagingReportPath = path.join(repoRoot, "dist", "official-spike-b-packaging-report.json");
const rootMainJsPath = path.join(repoRoot, "main.js");
const rootManifestPath = path.join(repoRoot, "manifest.json");

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`[check:official:spike-b] ${message}`);
  process.exit(1);
}

async function main() {
  for (const targetPath of [
    officialMainJsPath,
    officialManifestPath,
    officialStylesPath,
    packagingReportPath
  ]) {
    if (!(await pathExists(targetPath))) {
      fail(`Missing required file: ${path.relative(repoRoot, targetPath)}`);
    }
  }

  const entries = await readdir(officialDir, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expected = ["main.js", "manifest.json", "styles.css"];
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    fail(`dist/official-spike-b must contain exactly ${expected.join(", ")}; found ${names.join(", ")}`);
  }

  const officialMainJs = await readFile(officialMainJsPath, "utf8");
  for (const marker of [
    "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_BASE64__",
    "__REVERYSKY_GET_EMBEDDED_RUNTIME_ARCHIVE_SHA256__"
  ]) {
    if (!officialMainJs.includes(marker)) {
      fail(`Official main.js is missing marker: ${marker}`);
    }
  }

  if (await pathExists(path.join(officialDir, "unity-webgl"))) {
    fail("dist/official-spike-b must not contain unity-webgl/");
  }

  const officialMainJsStat = await stat(officialMainJsPath);
  const rootMainJsStat = await stat(rootMainJsPath);
  if (officialMainJsStat.size <= rootMainJsStat.size) {
    fail("Official Spike B main.js must be larger than root main.js.");
  }

  const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8"));
  const officialManifest = JSON.parse(await readFile(officialManifestPath, "utf8"));
  if (rootManifest.version !== officialManifest.version) {
    fail(`Manifest version mismatch: root=${rootManifest.version} official=${officialManifest.version}`);
  }

  const report = JSON.parse(await readFile(packagingReportPath, "utf8"));
  if (report.officialMainJsBytes !== officialMainJsStat.size) {
    fail(
      `Packaging report officialMainJsBytes=${report.officialMainJsBytes} does not match actual size ${officialMainJsStat.size}.`
    );
  }
  if (!/^[0-9a-f]{64}$/.test(report.archiveSha256 || "")) {
    fail(`Packaging report archiveSha256 is not a lowercase SHA-256 digest: ${report.archiveSha256}`);
  }
  if (report.mode !== "embedded-tar-gz-with-one-time-local-extraction") {
    fail(`Unexpected packaging report mode: ${report.mode}`);
  }

  console.log("[check:official:spike-b] OK");
}

await main();
