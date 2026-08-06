export type QueryFilterOperator = "path" | "date" | "tag";

export const ACTIVE_ROOT_FILTER_TERM_PATTERN = /(^|\s)(-?[^\s:]*)$/;

const FILTER_OPERATOR_TOKEN_PATTERN = /^-?(?:path|date|tag):$/i;
const FILTER_OPERATOR_TERM_START_PATTERN = /^-?(?:path|date|tag):/i;

export function getQueryFilterOperator(body: string): QueryFilterOperator | null {
  const match = body.match(/^(path|date|tag):/i);
  const operator = match?.[1]?.toLowerCase();
  return isQueryFilterOperator(operator) ? operator : null;
}

export function getQueryFilterOperatorValue(body: string, operator: QueryFilterOperator): string {
  return body.slice(`${operator}:`.length).trim();
}

export function formatQueryFilterOperator(operator: QueryFilterOperator): string {
  return `${operator}:`;
}

export function formatQueryFilterTerm(operator: QueryFilterOperator, value: string): string {
  return `${formatQueryFilterOperator(operator)}${value}`;
}

export function formatPathQueryFilterValue(folderPath: string): string {
  const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
  const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return needsQuotes ? `"${escaped}"` : escaped;
}

export function formatTagQueryFilterValue(tag: string): string {
  return `#${tag.trim().replace(/^#/, "")}`;
}

export function mergeSeparatedQueryOperatorValues(tokens: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const nextToken = tokens[i + 1] ?? "";
    if (
      FILTER_OPERATOR_TOKEN_PATTERN.test(token) &&
      nextToken.length > 0 &&
      !FILTER_OPERATOR_TERM_START_PATTERN.test(nextToken)
    ) {
      merged.push(`${token}${nextToken}`);
      i++;
      continue;
    }

    merged.push(token);
  }

  return merged;
}

export function queryContainsFilterOperator(query: string, operator: QueryFilterOperator): boolean {
  return new RegExp(`(^|\\s)-?${operator}:`, "i").test(query);
}

export function hasTrailingQuerySeparator(query: string): boolean {
  return /\s$/.test(query);
}

export function appendQueryFilterTerm(query: string, operator: QueryFilterOperator, value: string): string {
  const term = formatQueryFilterTerm(operator, value);
  if (query.length === 0) {
    return term;
  }

  return `${query}${hasTrailingQuerySeparator(query) ? "" : " "}${term}`;
}

export function ensureTrailingQuerySeparator(value: string): string {
  return hasTrailingQuerySeparator(value) ? value : `${value} `;
}

export function isTrailingEmptyFilterOperator(query: string, operator: QueryFilterOperator): boolean {
  return new RegExp(`(^|\\s)-?${operator}:\\s*$`, "i").test(query);
}

export function isActiveFilterTerm(query: string, operator: QueryFilterOperator): boolean {
  return getActiveFilterTermPattern(operator).test(query);
}

export function extractActiveFilterTermValue(query: string, operator: QueryFilterOperator): string {
  const match = query.match(getActiveFilterTermValuePattern(operator));
  if (!match) {
    return "";
  }

  if (operator === "date") {
    return match[2] ?? "";
  }

  const quotedValue = typeof match[2] === "string" ? match[2] : "";
  const plainValue = typeof match[3] === "string" ? match[3] : "";
  const rawValue = quotedValue || plainValue;
  return rawValue.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

export function replaceActiveFilterTermValue(
  query: string,
  operator: QueryFilterOperator,
  value: string
): string | null {
  const pattern = getActiveFilterTermReplacementPattern(operator);
  if (!pattern.test(query)) {
    return null;
  }

  return query.replace(pattern, (_match, prefix: string, operatorToken: string) => {
    return `${prefix}${operatorToken}${value}`;
  });
}

export function applyQueryFilterValueSuggestion(
  query: string,
  operator: QueryFilterOperator,
  value: string,
  options: { resetWhenOperatorMissing?: boolean } = {}
): string {
  const replacedValue = replaceActiveFilterTermValue(query, operator, value);
  if (replacedValue !== null) {
    return replacedValue;
  }

  if (options.resetWhenOperatorMissing && !queryContainsFilterOperator(query, operator)) {
    return formatQueryFilterTerm(operator, value);
  }

  return appendQueryFilterTerm(query, operator, value);
}

export function extractActiveRootFilterTermValue(query: string): string {
  const match = query.match(ACTIVE_ROOT_FILTER_TERM_PATTERN);
  const activeTerm = match?.[2] ?? "";
  return activeTerm.includes(":") ? "" : activeTerm;
}

export function applyQueryFilterOperatorToActiveRootPrefix(
  currentValue: string,
  operator: QueryFilterOperator
): string {
  const operatorToken = formatQueryFilterOperator(operator);
  if (currentValue.trim().length === 0) {
    return operatorToken;
  }

  const activePrefixMatch = currentValue.match(ACTIVE_ROOT_FILTER_TERM_PATTERN);
  const activePrefix = activePrefixMatch?.[2] ?? "";
  const normalizedActivePrefix = normalizeOperatorSuggestionSearchTerm(activePrefix);
  if (normalizedActivePrefix.length > 0 && operator.startsWith(normalizedActivePrefix)) {
    return currentValue.replace(ACTIVE_ROOT_FILTER_TERM_PATTERN, (_match, prefix: string) => `${prefix}${operatorToken}`);
  }

  return appendQueryFilterOperator(currentValue, operator);
}

export function applyQueryFilterOperatorSuggestion(
  query: string,
  operator: QueryFilterOperator,
  options: { preserveWhenActiveTerm?: boolean; preserveWhenOperatorPresent?: boolean } = {}
): string {
  if (options.preserveWhenActiveTerm && isActiveFilterTerm(query, operator)) {
    return query;
  }

  if (options.preserveWhenOperatorPresent && queryContainsFilterOperator(query.trim(), operator)) {
    return query;
  }

  return applyQueryFilterOperatorToActiveRootPrefix(query, operator);
}

export function appendQueryFilterOperator(query: string, operator: QueryFilterOperator): string {
  const operatorToken = formatQueryFilterOperator(operator);
  if (query.length === 0) {
    return operatorToken;
  }

  return `${query}${hasTrailingQuerySeparator(query) ? "" : " "}${operatorToken}`;
}

export function normalizeOperatorSuggestionSearchTerm(value: string): string {
  return value.trim().toLowerCase().replace(/^-/, "").replace(/:$/, "");
}

export function normalizeDateFilterSearchTerm(value: string): string {
  return value.trim().toLowerCase().replace(/^(-?date:)/, "").replace(/^[<>=]+/, "").trim();
}

function isQueryFilterOperator(value: string | undefined): value is QueryFilterOperator {
  return value === "path" || value === "date" || value === "tag";
}

function getActiveFilterTermPattern(operator: QueryFilterOperator): RegExp {
  return new RegExp(`(^|\\s)-?${operator}:\\s*${getFilterTermValuePattern(operator)}$`, "i");
}

function getActiveFilterTermValuePattern(operator: QueryFilterOperator): RegExp {
  if (operator === "date") {
    return new RegExp(`(^|\\s)-?${operator}:\\s*([^\\s]*)$`, "i");
  }

  return new RegExp(`(^|\\s)-?${operator}:\\s*(?:"([^"]*)"|([^\\s]*))$`, "i");
}

function getActiveFilterTermReplacementPattern(operator: QueryFilterOperator): RegExp {
  return new RegExp(`(^|\\s)(-?${operator}:)\\s*${getFilterTermValuePattern(operator)}$`, "i");
}

function getFilterTermValuePattern(operator: QueryFilterOperator): string {
  return operator === "date" ? "[^\\s]*" : "(?:\"[^\"]*\"|[^\\s]*)";
}
