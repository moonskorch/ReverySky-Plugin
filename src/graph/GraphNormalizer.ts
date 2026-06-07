/**
 * Normalize vault paths and tags so graph data stays stable across layers.
 */
export class GraphNormalizer {
  /**
   * Use forward slashes because the bridge contract is vault-relative and platform neutral.
   */
  static normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
  }

  /**
   * Strip display-only hash prefixes before tags are deduplicated.
   */
  static normalizeTag(tag: string): string {
    const trimmed = tag.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
  }

  /**
   * Deduplicate after normalization to keep graph payloads compact.
   */
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
