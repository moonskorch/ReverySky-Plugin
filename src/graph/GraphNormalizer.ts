export class GraphNormalizer {
  static normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
  }

  static normalizeTag(tag: string): string {
    const trimmed = tag.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
  }

  static normalizeTags(tags: string[]): string[] {
    const out = new Set<string>();
    for (const tag of tags) {
      const normalized = GraphNormalizer.normalizeTag(tag);
      if (normalized) {
        out.add(normalized);
      }
    }
    return Array.from(out);
  }
}
