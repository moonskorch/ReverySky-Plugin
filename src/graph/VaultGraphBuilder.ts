import type { App, CachedMetadata, TFile } from "obsidian";
import { GraphLink, GraphNoteNode, GraphPayload } from "../bridge/BridgeTypes";
import { GraphNormalizer } from "./GraphNormalizer";

export class VaultGraphBuilder {
  static build(app: App): GraphPayload {
    const files = app.vault.getMarkdownFiles();
    const notes = files
      .map((file) => VaultGraphBuilder.toNoteNode(app, file))
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

  private static toNoteNode(app: App, file: TFile): GraphNoteNode {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const frontmatterId = typeof frontmatter?.id === "string" ? frontmatter.id.trim() : "";

    const tags = GraphNormalizer.normalizeTags([
      ...VaultGraphBuilder.getInlineTags(cache),
      ...VaultGraphBuilder.getFrontmatterTags(frontmatter?.tags)
    ]);

    const created = Number.isFinite(file.stat.ctime) ? new Date(file.stat.ctime).toISOString() : undefined;
    const date = VaultGraphBuilder.getFrontmatterDate(frontmatter?.date) ?? created;

    return {
      id: frontmatterId || VaultGraphBuilder.makeStableId(file.path),
      path: GraphNormalizer.normalizePath(file.path),
      title: file.basename,
      tags,
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
      return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
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

  private static makeStableId(path: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
      hash ^= path.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return `note_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}
