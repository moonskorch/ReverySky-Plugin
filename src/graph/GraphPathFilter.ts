import type { GraphLink, GraphNoteNode, GraphPayload } from "../bridge/BridgeTypes";

export type ParsedPathFilter = {
  includeTerms: string[];
  excludeTerms: string[];
  includeRegexes: RegExp[];
  excludeRegexes: RegExp[];
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
  private static readonly NO_MATCH_SENTINEL = "\u0000__empty_path_term__";

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
    const includeRegexes: RegExp[] = [];
    const excludeRegexes: RegExp[] = [];
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
        if (isNegated) {
          continue;
        }
        includeTerms.push(GraphPathFilter.NO_MATCH_SENTINEL);
        continue;
      }

      const regexTerm = GraphPathFilter.tryParseRegexLiteral(rawTerm);
      if (regexTerm.kind === "invalid") {
        return {
          isValid: false,
          parsed: null,
          hasPathTerms: false,
          hasUnsupportedTokens: unsupportedTokens.length > 0,
          reason: regexTerm.reason
        };
      }
      if (regexTerm.kind === "regex") {
        if (isNegated) {
          excludeRegexes.push(regexTerm.value);
        } else {
          includeRegexes.push(regexTerm.value);
        }
        continue;
      }

      const normalizedTerm = GraphPathFilter.normalizeMatchValue(rawTerm);
      if (!normalizedTerm) {
        if (isNegated) {
          continue;
        }
        includeTerms.push(GraphPathFilter.NO_MATCH_SENTINEL);
        continue;
      }

      if (isNegated) {
        excludeTerms.push(normalizedTerm);
      } else {
        includeTerms.push(normalizedTerm);
      }
    }

    const hasPathTerms = includeTerms.length > 0 || excludeTerms.length > 0;
    const hasRegexTerms = includeRegexes.length > 0 || excludeRegexes.length > 0;

    return {
      isValid: true,
      parsed: hasPathTerms || hasRegexTerms
        ? {
            includeTerms,
            excludeTerms,
            includeRegexes,
            excludeRegexes,
            unsupportedTokens
          }
        : null,
      hasPathTerms: hasPathTerms || hasRegexTerms,
      hasUnsupportedTokens: unsupportedTokens.length > 0
    };
  }

  static applyPathFilter(payload: GraphPayload, parsed: ParsedPathFilter | null): GraphPayload {
    if (
      !parsed ||
      (!parsed.includeTerms.length &&
        !parsed.excludeTerms.length &&
        !parsed.includeRegexes.length &&
        !parsed.excludeRegexes.length)
    ) {
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
    for (const excludeRegex of parsed.excludeRegexes) {
      if (excludeRegex.test(normalizedPath)) {
        return false;
      }
    }

    for (const include of parsed.includeTerms) {
      if (!normalizedPath.includes(include)) {
        return false;
      }
    }
    for (const includeRegex of parsed.includeRegexes) {
      if (!includeRegex.test(normalizedPath)) {
        return false;
      }
    }

    return true;
  }

  private static normalizeMatchValue(value: string): string {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }

  private static tryParseRegexLiteral(
    term: string
  ):
    | { kind: "not_regex" }
    | { kind: "regex"; value: RegExp }
    | { kind: "invalid"; reason: string } {
    if (!term.startsWith("/")) {
      return { kind: "not_regex" };
    }

    const regexLiteralMatch = term.match(/^\/((?:\\.|[^\\/])*)\/([dgimsuvy]*)$/);
    if (!regexLiteralMatch) {
      return {
        kind: "invalid",
        reason: "Invalid regex in path filter."
      };
    }

    const pattern = regexLiteralMatch[1] ?? "";
    const rawFlags = regexLiteralMatch[2] ?? "";
    const flags = rawFlags.replace(/g/g, "");
    try {
      return {
        kind: "regex",
        value: new RegExp(pattern, flags)
      };
    } catch {
      return {
        kind: "invalid",
        reason: "Invalid regex in path filter."
      };
    }
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
