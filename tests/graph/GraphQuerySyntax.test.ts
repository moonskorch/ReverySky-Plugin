import { describe, expect, it } from "vitest";
import {
  applyQueryFilterOperatorSuggestion,
  applyQueryFilterValueSuggestion,
  ensureTrailingQuerySeparator,
  extractActiveFilterTermValue,
  extractActiveRootFilterTermValue,
  formatPathQueryFilterValue,
  formatQueryFilterTerm,
  formatTagQueryFilterValue,
  getQueryFilterOperator,
  getQueryFilterOperatorValue,
  hasTrailingQuerySeparator,
  isActiveFilterTerm,
  isTrailingEmptyFilterOperator,
  mergeSeparatedQueryOperatorValues,
  normalizeDateFilterSearchTerm,
  normalizeOperatorSuggestionSearchTerm,
  queryContainsFilterOperator,
  replaceActiveFilterTermValue
} from "../../src/graph/GraphQuerySyntax";

describe("GraphQuerySyntax", () => {
  it("detects supported operators from filter bodies", () => {
    expect(getQueryFilterOperator("path:Projects")).toBe("path");
    expect(getQueryFilterOperator("DATE:2026-01-31")).toBe("date");
    expect(getQueryFilterOperator("tag:#work")).toBe("tag");
    expect(getQueryFilterOperator("file:Note")).toBeNull();
  });

  it("extracts trimmed operator values", () => {
    expect(getQueryFilterOperatorValue("path: Projects ", "path")).toBe("Projects");
    expect(getQueryFilterOperatorValue("date: 2026-01-31", "date")).toBe("2026-01-31");
    expect(getQueryFilterOperatorValue("tag: #work", "tag")).toBe("#work");
  });

  it("merges separated supported operators with their next value token", () => {
    expect(mergeSeparatedQueryOperatorValues(["path:", "Projects", "tag:", "#work"])).toEqual([
      "path:Projects",
      "tag:#work"
    ]);
    expect(mergeSeparatedQueryOperatorValues(["-path:", "Archive"])).toEqual(["-path:Archive"]);
    expect(mergeSeparatedQueryOperatorValues(["path:", "date:2026-01-31"])).toEqual([
      "path:",
      "date:2026-01-31"
    ]);
  });

  it("matches active filter terms with optional separator whitespace", () => {
    expect(isActiveFilterTerm("path:Projects", "path")).toBe(true);
    expect(isActiveFilterTerm("path: Projects", "path")).toBe(true);
    expect(isActiveFilterTerm("tag:#work path: Projects", "path")).toBe(true);
    expect(isActiveFilterTerm("path:Projects ", "path")).toBe(false);
    expect(isActiveFilterTerm("path:Projects tag:#work", "path")).toBe(false);
  });

  it("detects trailing empty filter operators before generic trailing-space handling", () => {
    expect(isTrailingEmptyFilterOperator("path: ", "path")).toBe(true);
    expect(isTrailingEmptyFilterOperator("-tag:   ", "tag")).toBe(true);
    expect(isTrailingEmptyFilterOperator("date: 2026-01-31", "date")).toBe(false);
  });

  it("extracts active path, tag, and date values", () => {
    expect(extractActiveFilterTermValue("path: Projects", "path")).toBe("Projects");
    expect(extractActiveFilterTermValue("path: \"Dream Notes\"", "path")).toBe("Dream Notes");
    expect(extractActiveFilterTermValue("tag: #work", "tag")).toBe("#work");
    expect(extractActiveFilterTermValue("date: >=2026-01-31", "date")).toBe(">=2026-01-31");
    expect(extractActiveFilterTermValue("path:Projects tag:#work", "path")).toBe("");
  });

  it("replaces active filter term values while preserving prefixes and negation", () => {
    expect(replaceActiveFilterTermValue("path: Pr", "path", "Projects")).toBe("path:Projects");
    expect(replaceActiveFilterTermValue("tag:#work -path: Archive", "path", "Old")).toBe(
      "tag:#work -path:Old"
    );
    expect(replaceActiveFilterTermValue("path:Projects tag: #wo", "tag", "#work")).toBe(
      "path:Projects tag:#work"
    );
    expect(replaceActiveFilterTermValue("path:Projects ", "path", "Archive")).toBeNull();
  });

  it("detects existing operators anywhere in the query", () => {
    expect(queryContainsFilterOperator("path:Projects tag:#work", "path")).toBe(true);
    expect(queryContainsFilterOperator("path:Projects -tag:#work", "tag")).toBe(true);
    expect(queryContainsFilterOperator("file:Projects", "path")).toBe(false);
  });

  it("extracts the active root prefix before an operator is chosen", () => {
    expect(extractActiveRootFilterTermValue("pa")).toBe("pa");
    expect(extractActiveRootFilterTermValue("tag:#work pa")).toBe("pa");
    expect(extractActiveRootFilterTermValue("tag:#work ")).toBe("");
    expect(extractActiveRootFilterTermValue("path:Projects")).toBe("");
  });

  it("formats query filter values for suggestion insertion", () => {
    expect(formatQueryFilterTerm("date", ">=2026-01-01")).toBe("date:>=2026-01-01");
    expect(formatPathQueryFilterValue("Dream Notes")).toBe("\"Dream Notes\"");
    expect(formatPathQueryFilterValue("Dream \"Quotes\"")).toBe("\"Dream \\\"Quotes\\\"\"");
    expect(formatTagQueryFilterValue("#record/finding")).toBe("#record/finding");
    expect(formatTagQueryFilterValue("record/finding")).toBe("#record/finding");
  });

  it("applies operator suggestions with existing-query rules", () => {
    expect(applyQueryFilterOperatorSuggestion("pa", "path")).toBe("path:");
    expect(
      applyQueryFilterOperatorSuggestion("tag:#work pa", "path", { preserveWhenOperatorPresent: true })
    ).toBe("tag:#work path:");
    expect(
      applyQueryFilterOperatorSuggestion("path:Projects pa", "path", { preserveWhenOperatorPresent: true })
    ).toBe("path:Projects pa");
    expect(
      applyQueryFilterOperatorSuggestion("tag:#work", "tag", { preserveWhenActiveTerm: true })
    ).toBe("tag:#work");
  });

  it("applies value suggestions while preserving active replacements and separators", () => {
    expect(applyQueryFilterValueSuggestion("path: Pr", "path", "Projects", { resetWhenOperatorMissing: true })).toBe(
      "path:Projects"
    );
    expect(applyQueryFilterValueSuggestion("path:Projects date:", "date", ">=2026-01-01")).toBe(
      "path:Projects date:>=2026-01-01"
    );
    expect(applyQueryFilterValueSuggestion("tag:#work ", "tag", "#project")).toBe("tag:#work tag:#project");
    expect(applyQueryFilterValueSuggestion("plain", "path", "Archive", { resetWhenOperatorMissing: true })).toBe(
      "path:Archive"
    );
  });

  it("normalizes suggestion search terms and query separators", () => {
    expect(hasTrailingQuerySeparator("tag:#work ")).toBe(true);
    expect(ensureTrailingQuerySeparator("tag:#work")).toBe("tag:#work ");
    expect(normalizeOperatorSuggestionSearchTerm("-pa:")).toBe("pa");
    expect(normalizeDateFilterSearchTerm("date:>=2026-01-01")).toBe("2026-01-01");
    expect(normalizeDateFilterSearchTerm(">= one week ago")).toBe("one week ago");
  });
});
