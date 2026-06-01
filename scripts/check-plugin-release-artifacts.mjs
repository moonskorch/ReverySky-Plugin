import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const requiredReleaseArtifacts = [
  "manifest.json",
  "styles.css",
  "main.js"
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

  for (const relativePath of requiredReleaseArtifacts) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(absolutePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    console.error("[check:plugin-release] Missing plugin release artifacts:");
    for (const missingPath of missing) {
      console.error(`- ${missingPath}`);
    }
    process.exit(1);
  }

  console.log("[check:plugin-release] OK");
}

await main();
