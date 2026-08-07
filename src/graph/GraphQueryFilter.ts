import type { GraphNoteNode, GraphPayload } from "../bridge/BridgeTypes";
import {
  getQueryFilterOperator,
  getQueryFilterOperatorValue,
  mergeSeparatedQueryOperatorValues
} from "./GraphQuerySyntax";

export type ParsedQueryFilter = {
  includeTerms: string[];
  excludeTerms: string[];
  includeRegexes: RegExp[];
  excludeRegexes: RegExp[];
  includeDateClauses: ParsedDateClause[];
  excludeDateClauses: ParsedDateClause[];
  includeTagTerms: string[];
  excludeTagTerms: string[];
  unsupportedTokens: string[];
};

type DateFilterComparator = "eq" | "lt" | "gt" | "lte" | "gte";

type ParsedDateClause = {
  comparator: DateFilterComparator;
  day: string;
};

export type QueryFilterParseResult = {
  isValid: boolean;
  parsed: ParsedQueryFilter | null;
  hasSupportedTerms: boolean;
  hasUnsupportedTokens: boolean;
  reason?: string;
};

export type QueryFilterOptions = {
  alwaysIncludeNoteId?: string;
};

/**
 * Parse and apply the view's query filter syntax without mutating the source graph.
 */
export class GraphQueryFilter {
  private static readonly NO_MATCH_SENTINEL = "\u0000__empty_path_term__";
  private static readonly NO_MATCH_DATE_SENTINEL = "\u0000__empty_date_term__";
  private static readonly NO_MATCH_TAG_SENTINEL = "\u0000__empty_tag_term__";

  /**
   * Convert the free-form search box text into structured include/exclude filters.
   */
  static parseQuery(query: string): QueryFilterParseResult {
    const rawQuery = typeof query === "string" ? query.trim() : "";
    if (!rawQuery) {
      return {
        isValid: true,
        parsed: null,
        hasSupportedTerms: false,
        hasUnsupportedTokens: false
      };
    }

    const tokenized = this.tokenize(rawQuery);
    if (!tokenized.ok) {
      return {
        isValid: false,
        parsed: null,
        hasSupportedTerms: false,
        hasUnsupportedTokens: false,
        reason: tokenized.reason
      };
    }

    const includeTerms: string[] = [];
    const excludeTerms: string[] = [];
    const includeRegexes: RegExp[] = [];
    const excludeRegexes: RegExp[] = [];
    const includeDateClauses: ParsedDateClause[] = [];
    const excludeDateClauses: ParsedDateClause[] = [];
    const includeTagTerms: string[] = [];
    const excludeTagTerms: string[] = [];
    const unsupportedTokens: string[] = [];

    for (const token of mergeSeparatedQueryOperatorValues(tokenized.tokens)) {
      const trimmed = token.trim();
      if (!trimmed) {
        continue;
      }

      const isNegated = trimmed.startsWith("-");
      const body = isNegated ? trimmed.slice(1) : trimmed;
      const operator = getQueryFilterOperator(body);
      if (operator !== "path") {
        if (operator === "date") {
          const rawDateTerm = getQueryFilterOperatorValue(body, operator);
          const dateClause = this.tryParseDateClause(rawDateTerm);
          if (dateClause.kind === "invalid") {
            return {
              isValid: false,
              parsed: null,
              hasSupportedTerms: false,
              hasUnsupportedTokens: unsupportedTokens.length > 0,
              reason: dateClause.reason
            };
          }
          if (dateClause.kind === "empty") {
            // Empty date filters intentionally match nothing instead of being ignored.
            if (isNegated) {
              continue;
            }

            includeDateClauses.push({
              comparator: "eq",
              day: this.NO_MATCH_DATE_SENTINEL
            });
            continue;
          }

          if (isNegated) {
            excludeDateClauses.push(dateClause.value);
          } else {
            includeDateClauses.push(dateClause.value);
          }
          continue;
        }

        if (operator === "tag") {
          const rawTagTerm = getQueryFilterOperatorValue(body, operator);
          if (!rawTagTerm) {
            // Empty tag filters intentionally match nothing instead of being ignored.
            if (isNegated) {
              continue;
            }

            includeTagTerms.push(this.NO_MATCH_TAG_SENTINEL);
            continue;
          }

          const normalizedTagTerm = this.normalizeTagMatchValue(rawTagTerm);
          if (!normalizedTagTerm) {
            // Empty tag filters intentionally match nothing instead of being ignored.
            if (isNegated) {
              continue;
            }

            includeTagTerms.push(this.NO_MATCH_TAG_SENTINEL);
            continue;
          }

          if (isNegated) {
            excludeTagTerms.push(normalizedTagTerm);
          } else {
            includeTagTerms.push(normalizedTagTerm);
          }
          continue;
        }

        unsupportedTokens.push(trimmed);
        continue;
      }

      const rawTerm = getQueryFilterOperatorValue(body, operator);
      if (!rawTerm) {
        // Empty path filters intentionally match nothing instead of broadening the query.
        if (isNegated) {
          continue;
        }
        includeTerms.push(this.NO_MATCH_SENTINEL);
        continue;
      }

      const regexTerm = this.tryParseRegexLiteral(rawTerm);
      if (regexTerm.kind === "invalid") {
        return {
          isValid: false,
          parsed: null,
          hasSupportedTerms: false,
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

      const normalizedTerm = this.normalizeMatchValue(rawTerm);
      if (!normalizedTerm) {
        if (isNegated) {
          continue;
        }
        includeTerms.push(this.NO_MATCH_SENTINEL);
        continue;
      }

      if (isNegated) {
        excludeTerms.push(normalizedTerm);
      } else {
        includeTerms.push(normalizedTerm);
      }
    }

    const hasPathOperatorTerms = includeTerms.length > 0 || excludeTerms.length > 0;
    const hasRegexTerms = includeRegexes.length > 0 || excludeRegexes.length > 0;
    const hasDateTerms = includeDateClauses.length > 0 || excludeDateClauses.length > 0;
    const hasTagTerms = includeTagTerms.length > 0 || excludeTagTerms.length > 0;
    const hasSupportedTerms = hasPathOperatorTerms || hasRegexTerms || hasDateTerms || hasTagTerms;

    return {
      isValid: true,
      parsed: hasSupportedTerms
        ? {
            includeTerms,
            excludeTerms,
            includeRegexes,
            excludeRegexes,
            includeDateClauses,
            excludeDateClauses,
            includeTagTerms,
            excludeTagTerms,
            unsupportedTokens
          }
        : null,
      hasSupportedTerms,
      hasUnsupportedTokens: unsupportedTokens.length > 0
    };
  }

  /**
   * Keep the no-filter fast path as a no-op; clone only when filtering changes the payload.
   */
  static applyFilter(
    payload: GraphPayload,
    parsed: ParsedQueryFilter | null,
    options: QueryFilterOptions = {}
  ): GraphPayload {
    if (
      !parsed ||
      (!parsed.includeTerms.length &&
        !parsed.excludeTerms.length &&
        !parsed.includeRegexes.length &&
        !parsed.excludeRegexes.length &&
        !parsed.includeDateClauses.length &&
        !parsed.excludeDateClauses.length &&
        !parsed.includeTagTerms.length &&
        !parsed.excludeTagTerms.length)
    ) {
      return payload;
    }

    const notes = payload.notes.filter((note) => (
      note.id === options.alwaysIncludeNoteId || this.matchesNote(note, parsed)
    ));
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

  private static matchesNote(note: GraphNoteNode, parsed: ParsedQueryFilter): boolean {
    const normalizedPath = this.normalizeMatchValue(note.path);
    const noteDay = this.toIsoDayKey(note.date);

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
    for (const excludeDate of parsed.excludeDateClauses) {
      if (noteDay && this.matchesDateClause(noteDay, excludeDate)) {
        return false;
      }
    }
    for (const excludeTag of parsed.excludeTagTerms) {
      if (this.noteHasMatchingTag(note, excludeTag)) {
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
    for (const includeDate of parsed.includeDateClauses) {
      if (!noteDay || !this.matchesDateClause(noteDay, includeDate)) {
        return false;
      }
    }
    for (const includeTag of parsed.includeTagTerms) {
      if (!this.noteHasMatchingTag(note, includeTag)) {
        return false;
      }
    }

    return true;
  }

  private static normalizeMatchValue(value: string): string {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }

  private static normalizeTagMatchValue(value: string): string {
    return value.trim().replace(/^#/, "").toLowerCase();
  }

  private static noteHasMatchingTag(note: GraphNoteNode, queryTag: string): boolean {
    return note.tags.some((tag) => {
      const normalizedTag = this.normalizeTagMatchValue(tag);
      return normalizedTag === queryTag || normalizedTag.startsWith(`${queryTag}/`);
    });
  }

  private static toIsoDayKey(value: string | undefined): string | null {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const trimmed = value.trim();
    const leadingDayMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[Tt\s].*)/);
    if (leadingDayMatch?.[1] && this.isValidCalendarDay(leadingDayMatch[1])) {
      return leadingDayMatch[1];
    }

    const parsedDate = new Date(trimmed);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.toISOString().slice(0, 10);
  }

  private static matchesDateClause(noteDay: string, clause: ParsedDateClause): boolean {
    switch (clause.comparator) {
      case "lte":
        return noteDay <= clause.day;
      case "gte":
        return noteDay >= clause.day;
      case "lt":
        return noteDay < clause.day;
      case "gt":
        return noteDay > clause.day;
      default:
        return noteDay === clause.day;
    }
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
        reason: "Invalid regex in query filter."
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
        reason: "Invalid regex in query filter."
      };
    }
  }

  private static tryParseDateClause(
    term: string
  ):
    | { kind: "empty" }
    | { kind: "clause"; value: ParsedDateClause }
    | { kind: "invalid"; reason: string } {
    const trimmed = term.trim();
    if (!trimmed) {
      return { kind: "empty" };
    }

    const dateMatch = trimmed.match(/^((?:<=|>=|<|>|=)?)(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) {
      return {
        kind: "invalid",
        reason: "Invalid date in date filter. Use date:YYYY-MM-DD, date:>YYYY-MM-DD, date:<YYYY-MM-DD, date:>=YYYY-MM-DD, or date:<=YYYY-MM-DD."
      };
    }

    const operator = dateMatch[1] ?? "";
    const day = dateMatch[2] ?? "";
    if (!this.isValidCalendarDay(day)) {
      return {
        kind: "invalid",
        reason: "Invalid calendar date in date filter."
      };
    }

    const comparator: DateFilterComparator = operator === ">="
      ? "gte"
      : operator === "<="
        ? "lte"
        : operator === ">"
          ? "gt"
          : operator === "<"
            ? "lt"
            : "eq";

    return {
      kind: "clause",
      value: {
        comparator,
        day
      }
    };
  }

  private static isValidCalendarDay(day: string): boolean {
    const [rawYear, rawMonth, rawDate] = day.split("-");
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const date = Number(rawDate);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(date) ||
      month < 1 ||
      month > 12 ||
      date < 1 ||
      date > 31
    ) {
      return false;
    }

    const utc = new Date(Date.UTC(year, month - 1, date));
    return (
      utc.getUTCFullYear() === year &&
      utc.getUTCMonth() + 1 === month &&
      utc.getUTCDate() === date
    );
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

export function areQueryFiltersEqual(left: ParsedQueryFilter | null, right: ParsedQueryFilter | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    areStringArraysEqual(left.includeTerms, right.includeTerms) &&
    areStringArraysEqual(left.excludeTerms, right.excludeTerms) &&
    areRegexArraysEqual(left.includeRegexes, right.includeRegexes) &&
    areRegexArraysEqual(left.excludeRegexes, right.excludeRegexes) &&
    areDateClauseArraysEqual(left.includeDateClauses, right.includeDateClauses) &&
    areDateClauseArraysEqual(left.excludeDateClauses, right.excludeDateClauses) &&
    areStringArraysEqual(left.includeTagTerms, right.includeTagTerms) &&
    areStringArraysEqual(left.excludeTagTerms, right.excludeTagTerms)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areRegexArraysEqual(left: RegExp[], right: RegExp[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value.source === right[index]?.source && value.flags === right[index]?.flags)
  );
}

function areDateClauseArraysEqual(
  left: ParsedQueryFilter["includeDateClauses"],
  right: ParsedQueryFilter["includeDateClauses"]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => (
      value.comparator === right[index]?.comparator &&
      value.day === right[index]?.day
    ))
  );
}
