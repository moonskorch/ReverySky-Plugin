import {
  MAX_LANDMARK_COUNT,
  normalizeLandmarkName
} from "./GraphTextLimits";

const WHOLE_WIKILINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/;
const DEFAULT_LANDMARK_FIELD = "landmarks";

/**
 * Reads a frontmatter landmark source conservatively:
 * - Missing and invalid values produce no landmarks.
 * - A scalar string is one landmark; separators inside strings are not split.
 * - Arrays contribute only string items.
 * - Whole-string wikilinks use their alias or final path segment.
 * - Runtime text limits are applied after wikilink unwrapping.
 */
export function readLandmarkField(
  frontmatter: unknown,
  fieldName = DEFAULT_LANDMARK_FIELD
): string[] {
  if (!frontmatter || typeof frontmatter !== "object") {
    return [];
  }

  return readLandmarkValue((frontmatter as Record<string, unknown>)[fieldName]);
}

function readLandmarkValue(value: unknown): string[] {
  const landmarks: string[] = [];
  const values = Array.isArray(value) ? value : [value];

  for (const item of values) {
    if (typeof item !== "string") {
      continue;
    }

    const landmark = normalizeLandmarkName(readLandmarkString(item));
    if (!landmark) {
      continue;
    }

    landmarks.push(landmark);
    if (landmarks.length >= MAX_LANDMARK_COUNT) {
      break;
    }
  }

  return landmarks;
}

function readLandmarkString(value: string): string {
  const trimmed = value.trim();
  const wikilinkMatch = WHOLE_WIKILINK_PATTERN.exec(trimmed);
  if (!wikilinkMatch) {
    return trimmed;
  }

  const alias = wikilinkMatch[2]?.trim();
  if (alias) {
    return alias;
  }

  const target = wikilinkMatch[1]?.trim() ?? "";
  const pathWithoutSubpath = target.split("#", 1)[0] ?? "";
  return pathWithoutSubpath.split("/").pop() ?? pathWithoutSubpath;
}
