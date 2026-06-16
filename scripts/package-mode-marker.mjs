/**
 * Adds or replaces the visible first-line package mode marker in root main.js.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const packageModeMarkers = {
  "folder-runtime": "/* ReverySky package mode: folder-runtime */",
  "embedded-html": "/* ReverySky package mode: embedded-html */",
  "embedded-archive": "/* ReverySky package mode: embedded-archive */"
};

const packageModeMarkerPattern =
  /^\/\* ReverySky package mode: (folder-runtime|embedded-html|embedded-archive) \*\/\r?\n/;

export function getPackageModeMarker(mode) {
  const marker = packageModeMarkers[mode];
  if (!marker) {
    throw new Error(`Unknown package mode: ${mode}`);
  }

  return marker;
}

export function stripPackageModeMarker(source) {
  return source.replace(packageModeMarkerPattern, "");
}

export function withPackageModeMarker(mode, source) {
  return `${getPackageModeMarker(mode)}\n${stripPackageModeMarker(source)}`;
}

export async function writeRootMainJsWithPackageMode(repoRoot, mode, source) {
  await writeFile(path.join(repoRoot, "main.js"), withPackageModeMarker(mode, source), "utf8");
}

async function main() {
  const mode = process.argv[2];
  const repoRoot = path.resolve(__dirname, "..");
  const rootMainJsPath = path.join(repoRoot, "main.js");
  const rootMainJs = await readFile(rootMainJsPath, "utf8");

  await writeRootMainJsWithPackageMode(repoRoot, mode, rootMainJs);
  console.log(`[package:${mode}] Wrote main.js marker`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}
