import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const fixedRequiredPaths = [
  "unity-webgl/index.html",
  "unity-webgl/Build/build-config.json",
  "unity-webgl/Build/build-config.js",
  "unity-webgl/Build/runtime-entry.js",
  "unity-webgl/Build/runtime-core.js"
];

const buildDir = path.join(repoRoot, "unity-webgl", "Build");

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasBuildArtifactPrefix(prefix) {
  let entries;
  try {
    entries = await readdir(buildDir, { withFileTypes: true });
  } catch {
    return false;
  }

  return entries.some((entry) => entry.isFile() && entry.name.startsWith(prefix));
}

async function main() {
  const missing = [];
  for (const relativePath of fixedRequiredPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  if (!(await hasBuildArtifactPrefix("runtime-data."))) {
    missing.push("unity-webgl/Build/runtime-data.*");
  }
  if (!(await hasBuildArtifactPrefix("runtime-code."))) {
    missing.push("unity-webgl/Build/runtime-code.*");
  }

  if (missing.length > 0) {
    console.error("[check:unity-webgl] Missing Unity WebGL artifacts:");
    for (const missingPath of missing) {
      console.error(`- ${missingPath}`);
    }
    console.error(
      "[check:unity-webgl] Re-import Unity export: powershell -ExecutionPolicy Bypass -File .\\scripts\\import-unity-webgl.ps1 -ExportRoot \"<UnityWebGLExportRoot>\""
    );
    process.exit(1);
  }

  console.log("[check:unity-webgl] OK");
}

await main();
