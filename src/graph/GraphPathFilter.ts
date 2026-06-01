import type { GraphLink, GraphNoteNode, GraphPayload } from "../bridge/BridgeTypes";

export type ParsedPathFilter = {
  includeTerms: string[];
  excludeTerms: string[];
  unsupportedTokens: string[];
};

export type PathFilterParseResult = {
  isValid: boolean;
  parsed: ParsedPathFilter | null;
  hasPathTerms: boolean;
  hasUnsupportedTokens: boolean;
  reason?: string;
};

export class GraphPathFilter {
  static parsePathQuery(query: string): PathFilterParseResult {
    const rawQuery = typeof query === "string" ? query.trim() : "";
    if (!rawQuery) {
      return {
        isValid: true,
        parsed: null,
        hasPathTerms: false,
        hasUnsupportedTokens: false
      };
    }

    const tokenized = GraphPathFilter.tokenize(rawQuery);
    if (!tokenized.ok) {
      return {
        isValid: false,
        parsed: null,
        hasPathTerms: false,
        hasUnsupportedTokens: false,
        reason: tokenized.reason
      };
    }

    const includeTerms: string[] = [];
    const excludeTerms: string[] = [];
    const unsupportedTokens: string[] = [];

    for (const token of tokenized.tokens) {
      const trimmed = token.trim();
      if (!trimmed) {
        continue;
      }

      const isNegated = trimmed.startsWith("-");
      const body = isNegated ? trimmed.slice(1) : trimmed;
      if (!body.toLowerCase().startsWith("path:")) {
        unsupportedTokens.push(trimmed);
        continue;
      }

      const rawTerm = body.slice("path:".length).trim();
      if (!rawTerm) {
        return {
          isValid: false,
          parsed: null,
          hasPathTerms: false,
          hasUnsupportedTokens: unsupportedTokens.length > 0,
          reason: "Empty path operator value."
        };
      }

      const normalizedTerm = GraphPathFilter.normalizeMatchValue(rawTerm);
      if (!normalizedTerm) {
        return {
          isValid: false,
          parsed: null,
          hasPathTerms: false,
          hasUnsupportedTokens: unsupportedTokens.length > 0,
          reason: "Empty path operator value."
        };
      }

      if (isNegated) {
        excludeTerms.push(normalizedTerm);
      } else {
        includeTerms.push(normalizedTerm);
      }
    }

    const hasPathTerms = includeTerms.length > 0 || excludeTerms.length > 0;

    return {
      isValid: true,
      parsed: hasPathTerms
        ? {
            includeTerms,
            excludeTerms,
            unsupportedTokens
          }
        : null,
      hasPathTerms,
      hasUnsupportedTokens: unsupportedTokens.length > 0
    };
  }

  static applyPathFilter(payload: GraphPayload, parsed: ParsedPathFilter | null): GraphPayload {
    if (!parsed || (!parsed.includeTerms.length && !parsed.excludeTerms.length)) {
      return payload;
    }

    const notes = payload.notes.filter((note) => GraphPathFilter.matchesNote(note, parsed));
    const keepIds = new Set(notes.map((note) => note.id));
    const links = payload.links.filter(
      (link) => keepIds.has(link.sourceId) && keepIds.has(link.targetId)
    );

    return {
      ...payload,
      vault: {
        ...payload.vault,
        noteCount: notes.length
      },
      notes,
      links
    };
  }

  private static matchesNote(note: GraphNoteNode, parsed: ParsedPathFilter): boolean {
    const normalizedPath = GraphPathFilter.normalizeMatchValue(note.path);

    for (const exclude of parsed.excludeTerms) {
      if (normalizedPath.includes(exclude)) {
        return false;
      }
    }

    for (const include of parsed.includeTerms) {
      if (!normalizedPath.includes(include)) {
        return false;
      }
    }

    return true;
  }

  private static normalizeMatchValue(value: string): string {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }

  private static tokenize(query: string): { ok: true; tokens: string[] } | { ok: false; reason: string } {
    const tokens: string[] = [];
    let current = "";
    let inQuote = false;
    let escaped = false;

    for (let i = 0; i < query.length; i++) {
      const ch = query[i];
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (inQuote && ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        inQuote = !inQuote;
        continue;
      }

      if (!inQuote && /\s/.test(ch)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += ch;
    }

    if (escaped) {
      current += "\\";
    }

    if (inQuote) {
      return {
        ok: false,
        reason: "Unclosed quote in query."
      };
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return {
      ok: true,
      tokens
    };
  }
}
