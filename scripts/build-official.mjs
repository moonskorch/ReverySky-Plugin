import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const requiredPaths = [
  "main.js",
  "manifest.json",
  "styles.css",
  path.join("unity-webgl", "index.html")
];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const missing = [];
  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    console.error(
      "[build:official] Missing normal-build artifacts. Run `npm run build` first."
    );
    for (const relativePath of missing) {
      console.error(`- ${relativePath}`);
    }
    process.exit(1);
  }

  const { spawnSync } = await import("node:child_process");

  const packageResult = spawnSync("node", ["scripts/build-official-plugin.mjs"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (packageResult.error) {
    throw packageResult.error;
  }
  if (packageResult.status !== 0) {
    process.exit(packageResult.status ?? 1);
  }

  const checkResult = spawnSync("node", ["scripts/check-official-plugin-release.mjs"], {
    cwd: repoRoot,
    stdio: "inherit"
  });
  if (checkResult.error) {
    throw checkResult.error;
  }
  if (checkResult.status !== 0) {
    process.exit(checkResult.status ?? 1);
  }
}

await main();
