export const DEFAULT_LANDMARK_SOURCE = "landmarks";

export function normalizeLandmarkSource(value: unknown): string {
  return normalizeLandmarkSourceName(value) ?? DEFAULT_LANDMARK_SOURCE;
}

export function normalizeLandmarkSourceName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue || /[\r\n\u0085\u2028\u2029]/.test(trimmedValue)) {
    return null;
  }

  return trimmedValue;
}
