import type { App } from "obsidian";

export function getLandmarkPropertySuggestions(app: App): string[] {
  try {
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) {
      return [];
    }

    const cache = app.metadataCache.getFileCache(activeFile);
    return normalizeFrontmatterPropertySuggestions(cache?.frontmatter);
  } catch {
    return [];
  }
}

function normalizeFrontmatterPropertySuggestions(frontmatter: unknown): string[] {
  const names: string[] = [];
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return [];
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    if (isExcludedPropertyName(key) || !isReadableLandmarkValue(value)) {
      continue;
    }
    names.push(key);
  }
  return sortUniquePropertyNames(names);
}

function isExcludedPropertyName(name: string): boolean {
  return name.trim().toLowerCase() === "tags";
}

function isReadableLandmarkValue(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string" || Array.isArray(value);
}

function sortUniquePropertyNames(names: string[]): string[] {
  return Array.from(new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
