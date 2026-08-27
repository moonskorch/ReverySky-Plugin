import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const whatsNewFilePattern = /^(\d+)\.(\d+)\.(\d+)\.md$/;

function parseVersion(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(whatsNewFilePattern);
  if (!match) {
    return null;
  }

  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function selectWhatsNewFile(releaseVersion, fileNames) {
  const parsedReleaseVersion = parseVersion(`${releaseVersion}.md`);
  if (!parsedReleaseVersion) {
    throw new Error(`Release version must be x.y.z; got ${JSON.stringify(releaseVersion)}.`);
  }

  const candidates = [];
  for (const fileName of fileNames) {
    const parsedFileVersion = parseVersion(fileName);
    if (!parsedFileVersion || compareVersions(parsedFileVersion, parsedReleaseVersion) > 0) {
      continue;
    }

    candidates.push({
      fileName,
      version: parsedFileVersion.version,
      parsedVersion: parsedFileVersion
    });
  }

  candidates.sort((left, right) => compareVersions(right.parsedVersion, left.parsedVersion));
  return candidates[0] ?? null;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveWhatsNewRuntimePaths(manifestPath, whatsNewSourceDir) {
  if (!(await pathExists(whatsNewSourceDir))) {
    return null;
  }

  const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
  const entries = await readdir(whatsNewSourceDir, { withFileTypes: true });
  const selected = selectWhatsNewFile(
    manifest.version,
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );

  if (!selected) {
    return null;
  }

  return {
    sourcePath: path.join(whatsNewSourceDir, selected.fileName),
    runtimePath: `whats-new/${selected.fileName}`
  };
}
