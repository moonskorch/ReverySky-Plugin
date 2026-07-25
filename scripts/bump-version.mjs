/**
 * Updates all repository-level Obsidian release version metadata.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const versionPattern = /^\d+\.\d+\.\d+$/;

function fail(message) {
  console.error(`[bump-version] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const version = args.find((arg) => arg !== "--dry-run");

  if (!version || !versionPattern.test(version)) {
    fail("Usage: npm run bump-version -- <x.y.z> [--dry-run]");
  }

  return { dryRun, version };
}

async function readJson(relativePath) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
  } catch (error) {
    fail(`Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeJson(relativePath, value, dryRun) {
  if (dryRun) {
    console.log(`[bump-version] would update ${relativePath}`);
    return;
  }

  await writeFile(path.join(repoRoot, relativePath), formatJson(value), "utf8");
  console.log(`[bump-version] updated ${relativePath}`);
}

async function main() {
  const { dryRun, version } = parseArgs(process.argv);

  const manifest = await readJson("manifest.json");
  const packageJson = await readJson("package.json");
  const packageLock = await readJson("package-lock.json");
  const versionsJson = await readJson("versions.json");

  if (typeof manifest.minAppVersion !== "string" || manifest.minAppVersion.trim() === "") {
    fail("manifest.json minAppVersion must be a non-empty string.");
  }
  if (!packageLock.packages || typeof packageLock.packages !== "object" || !packageLock.packages[""]) {
    fail('package-lock.json must include packages[""] metadata.');
  }

  manifest.version = version;
  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[""].version = version;
  versionsJson[version] = manifest.minAppVersion;

  await writeJson("manifest.json", manifest, dryRun);
  await writeJson("package.json", packageJson, dryRun);
  await writeJson("package-lock.json", packageLock, dryRun);
  await writeJson("versions.json", versionsJson, dryRun);

  console.log(`[bump-version] ${dryRun ? "dry run complete" : `set version ${version}`}`);
}

await main();
