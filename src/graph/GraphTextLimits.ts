export const MAX_LANDMARK_NAME_LENGTH = 64;
export const MAX_LANDMARK_COUNT = 16;
export const MAX_NOTE_TITLE_LENGTH = 100;

export function normalizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength).trim();
}

export function normalizeLandmarkName(value: string): string {
  return normalizeText(value, MAX_LANDMARK_NAME_LENGTH);
}

export function normalizeNoteTitle(value: string): string {
  return normalizeText(value, MAX_NOTE_TITLE_LENGTH);
}
