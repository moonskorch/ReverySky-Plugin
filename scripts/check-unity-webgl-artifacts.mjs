/**
 * Verifies Unity WebGL runtime artifacts required by a package mode.
 *
 * Usage:
 *   node scripts/check-unity-webgl-artifacts.mjs folder-runtime
 *   node scripts/check-unity-webgl-artifacts.mjs embedded-html
 *   node scripts/check-unity-webgl-artifacts.mjs embedded-archive
 */
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const buildDir = path.join(repoRoot, "unity-webgl", "Build");

const modeConfigs = {
  "folder-runtime": {
    requiredPaths: [
      "unity-webgl/index.html",
      "unity-webgl/Build/build-config.json",
      "unity-webgl/Build/build-config.js",
      "unity-webgl/Build/runtime-entry.js",
      "unity-webgl/Build/runtime-core.js"
    ],
    requiredBuildPrefixes: [
      "runtime-data.",
      "runtime-code."
    ]
  },

  "embedded-html": {
    requiredPaths: [
      "unity-webgl/index.html"
    ],
    requiredBuildPrefixes: []
  },

  "embedded-archive": {
    requiredPaths: [
      "unity-webgl/index.disk-runtime.template.html",
      "unity-webgl/Build/build-config.json",
      "unity-webgl/Build/runtime-entry.js",
      "unity-webgl/Build/runtime-core.js"
    ],
    requiredBuildPrefixes: [
      "runtime-data.",
      "runtime-code."
    ]
  }
};

const packageMode = process.argv[2];
const config = modeConfigs[packageMode];

function fail(message) {
  console.error(`[check:unity-webgl] ${message}`);
  process.exit(1);
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function countBuildArtifactsByPrefix(prefix) {
  let entries;

  try {
    entries = await readdir(buildDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  return entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix)).length;
}

async function main() {
  if (!config) {
    fail(
      `Unknown or missing package mode. Use one of: ${Object.keys(modeConfigs).join(", ")}.`
    );
  }

  const missing = [];
  const invalid = [];

  for (const relativePath of config.requiredPaths) {
    const absolutePath = path.join(repoRoot, relativePath);

    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  for (const prefix of config.requiredBuildPrefixes) {
    const count = await countBuildArtifactsByPrefix(prefix);
    const displayPath = `unity-webgl/Build/${prefix}*`;

    if (count === 0) {
      missing.push(displayPath);
    } else if (count > 1) {
      invalid.push(`Expected exactly one ${displayPath} file, found ${count}.`);
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    console.error(`[check:unity-webgl] Invalid or missing Unity WebGL artifacts for ${packageMode}:`);

    for (const missingPath of missing) {
      console.error(`- ${missingPath}`);
    }

    for (const invalidArtifact of invalid) {
      console.error(`- ${invalidArtifact}`);
    }

    console.error(
      "[check:unity-webgl] Re-import Unity export: powershell -ExecutionPolicy Bypass -File .\\scripts\\import-unity-webgl.ps1 -ExportRoot \"<UnityWebGLExportRoot>\""
    );

    process.exit(1);
  }

  console.log(`[check:unity-webgl] OK (${packageMode})`);
}

await main();