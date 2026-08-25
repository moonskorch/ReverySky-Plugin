export const MAX_RUNTIME_BUILDING_NAME_LENGTH = 64;
export const MAX_RUNTIME_NOTE_TITLE_LENGTH = 100;

export function normalizeRuntimeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength).trim();
}

export function normalizeRuntimeBuildingName(value: string): string {
  return normalizeRuntimeText(value, MAX_RUNTIME_BUILDING_NAME_LENGTH);
}

export function normalizeRuntimeNoteTitle(value: string): string {
  return normalizeRuntimeText(value, MAX_RUNTIME_NOTE_TITLE_LENGTH);
}
