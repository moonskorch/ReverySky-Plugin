/**
 * Shared sanity checks for the Obsidian manifest release asset.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readJson(targetPath, label, fail) {
  try {
    return JSON.parse(await readFile(targetPath, "utf8"));
  } catch (error) {
    fail(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function checkPackageManifest(repoRoot, fail) {
  const manifestPath = path.join(repoRoot, "manifest.json");
  const manifest = await readJson(manifestPath, "manifest.json", fail);

  if (manifest.id !== "reverysky-map") {
    fail(`manifest.json id must be reverysky-map; got ${JSON.stringify(manifest.id)}.`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    fail("manifest.json name must be a non-empty string.");
  }
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    fail(`manifest.json version must be x.y.z; got ${JSON.stringify(manifest.version)}.`);
  }
  if (typeof manifest.minAppVersion !== "string" || manifest.minAppVersion.trim().length === 0) {
    fail("manifest.json minAppVersion must be a non-empty string.");
  }
  if (manifest.isDesktopOnly !== true) {
    fail("manifest.json isDesktopOnly must be true for the Unity WebGL desktop plugin.");
  }
}
