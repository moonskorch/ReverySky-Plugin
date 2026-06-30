import type { App, CachedMetadata, TFile } from "obsidian";
import { createHash } from "node:crypto";
import { GraphLink, GraphNoteNode, GraphPayload } from "../bridge/BridgeTypes";
import { GraphNormalizer } from "./GraphNormalizer";

/**
 * Graph note ids are derived only from normalized vault-relative paths.
 */
export function makeStableNoteId(path: string): string {
  const digest = createHash("sha256").update(path).digest();
  return `note_${digest.subarray(0, 12).toString("base64url")}`;
}

/**
 * Build the graph payload from the current vault snapshot for the Unity runtime.
 */
export class VaultGraphBuilder {
  static build(app: App): GraphPayload {
    const files = app.vault.getMarkdownFiles();
    const notes = files
      .map((file) => VaultGraphBuilder.toNoteNode(app, file))
      .filter((note): note is GraphNoteNode => note !== null)
      .sort((a, b) => a.path.localeCompare(b.path));
    const links = VaultGraphBuilder.buildLinks(app, notes);

    return {
      graphVersion: "0.0.1",
      generatedAt: new Date().toISOString(),
      vault: {
        noteCount: notes.length
      },
      notes,
      links
    };
  }

  /**
   * Translate Obsidian resolvedLinks into the bridge format and keep only note targets.
   */
  private static buildLinks(app: App, notes: GraphNoteNode[]): GraphLink[] {
    const noteIdByPath = new Map<string, string>();
    for (const note of notes) {
      noteIdByPath.set(GraphNormalizer.normalizePath(note.path), note.id);
    }

    const links: GraphLink[] = [];
    const resolvedLinks = app.metadataCache.resolvedLinks;

    for (const [sourcePathRaw, targets] of Object.entries(resolvedLinks)) {
      const sourcePath = GraphNormalizer.normalizePath(sourcePathRaw);
      const sourceId = noteIdByPath.get(sourcePath);
      if (!sourceId) {
        continue;
      }

      for (const [targetPathRaw, count] of Object.entries(targets)) {
        if (!count || count < 1) {
          continue;
        }

        const targetPath = GraphNormalizer.normalizePath(targetPathRaw);
        const targetId = noteIdByPath.get(targetPath);
        if (!targetId) {
          // Skip unresolved/non-note targets consistently in MVP.
          continue;
        }

        links.push({
          sourceId,
          targetId,
          weight: count,
          kind: "resolved"
        });
      }
    }

    links.sort((a, b) => {
      const sourceCmp = a.sourceId.localeCompare(b.sourceId);
      if (sourceCmp !== 0) {
        return sourceCmp;
      }
      return a.targetId.localeCompare(b.targetId);
    });

    return links;
  }

  /**
   * Merge frontmatter, inline tags, and file metadata into the compact node shape Unity needs.
   */
  private static toNoteNode(app: App, file: TFile): GraphNoteNode | null {
    const path = GraphNormalizer.normalizePath(file.path);
    if (!path.trim()) {
      return null;
    }

    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;

    const tags = GraphNormalizer.normalizeTags([
      ...VaultGraphBuilder.getInlineTags(cache),
      ...VaultGraphBuilder.getFrontmatterTags(frontmatter?.tags)
    ]);

    const date = VaultGraphBuilder.getCanonicalNoteDate(frontmatter, file);

    return {
      id: makeStableNoteId(path),
      path,
      title: file.basename,
      tags,
      size: VaultGraphBuilder.getNoteSizeBytes(file),
      ...(date ? { date } : {})
    };
  }

  private static getInlineTags(cache: CachedMetadata | null): string[] {
    if (!cache?.tags?.length) {
      return [];
    }
    return cache.tags.map((t) => t.tag);
  }

  private static getFrontmatterTags(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((x): x is string => typeof x === "string");
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }
    return [];
  }

  private static getFrontmatterDate(value: unknown): string | undefined {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    return undefined;
  }

  private static getCanonicalNoteDate(frontmatter: Record<string, unknown> | undefined, file: TFile): string | undefined {
    return (
      VaultGraphBuilder.getFrontmatterDate(frontmatter?.date) ??
      VaultGraphBuilder.getFrontmatterDate(frontmatter?.created) ??
      VaultGraphBuilder.getFrontmatterDate(frontmatter?.created_at) ??
      VaultGraphBuilder.getFileCreationDate(file)
    );
  }

  private static getFileCreationDate(file: TFile): string | undefined {
    const ctime = file?.stat?.ctime;
    if (!Number.isFinite(ctime)) {
      return undefined;
    }

    const d = new Date(ctime);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  /**
   * Clamp invalid file sizes to zero so the payload stays validator-friendly.
   */
  private static getNoteSizeBytes(file: TFile): number {
    const rawSize = file?.stat?.size;
    if (!Number.isFinite(rawSize)) {
      return 0;
    }

    return Math.max(0, Math.trunc(rawSize));
  }
}
