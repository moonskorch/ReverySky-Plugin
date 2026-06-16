/**
 * Validates repository-level Obsidian release metadata outside package assets.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[check:release-metadata] ${message}`);
  process.exit(1);
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const manifest = await readJson("manifest.json");
  const packageJson = await readJson("package.json");
  const versionsJson = await readJson("versions.json");

  if (packageJson.version !== manifest.version) {
    fail(`Version mismatch: manifest.json=${manifest.version}, package.json=${packageJson.version}.`);
  }
  if (versionsJson[manifest.version] !== manifest.minAppVersion) {
    fail(
      `versions.json must map ${manifest.version} to ${manifest.minAppVersion}; got ${JSON.stringify(versionsJson[manifest.version])}.`
    );
  }

  console.log("[check:release-metadata] OK");
}

await main();
