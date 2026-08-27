import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type WhatsNewFile = {
  version: string;
  markdown: string;
  sourcePath: string;
};

type VersionParts = {
  major: number;
  minor: number;
  patch: number;
};

const WHATS_NEW_DIR_NAME = "whats-new";
const WHATS_NEW_FILE_PATTERN = /^(\d+\.\d+\.\d+)\.md$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value: string): VersionParts | null {
  const match = value.match(VERSION_PATTERN);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareVersions(left: VersionParts, right: VersionParts): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

export function shouldShowWhatsNew(version: string, shownVersion: string | null): boolean {
  const packagedVersion = parseVersion(version);
  if (!packagedVersion) {
    return false;
  }
  if (!shownVersion) {
    return true;
  }

  const recordedShownVersion = parseVersion(shownVersion);
  if (!recordedShownVersion) {
    return true;
  }

  return compareVersions(packagedVersion, recordedShownVersion) > 0;
}

export async function readWhatsNewFile(runtimeDir: string): Promise<WhatsNewFile | null> {
  const whatsNewDir = path.join(runtimeDir, WHATS_NEW_DIR_NAME);
  let entries;
  try {
    entries = await readdir(whatsNewDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const markdownFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(WHATS_NEW_FILE_PATTERN);
      return match
        ? {
            fileName: entry.name,
            version: match[1],
            parsedVersion: parseVersion(match[1])
          }
        : null;
    })
    .filter((file): file is { fileName: string; version: string; parsedVersion: VersionParts } => {
      return file !== null && file.parsedVersion !== null;
    });

  if (markdownFiles.length === 0) {
    return null;
  }

  markdownFiles.sort((left, right) => compareVersions(right.parsedVersion, left.parsedVersion));
  const whatsNewFile = markdownFiles[0];
  const sourcePath = `${WHATS_NEW_DIR_NAME}/${whatsNewFile.fileName}`;
  let markdown;
  try {
    markdown = await readFile(path.join(runtimeDir, sourcePath), "utf8");
  } catch {
    return null;
  }

  return {
    version: whatsNewFile.version,
    markdown,
    sourcePath
  };
}
