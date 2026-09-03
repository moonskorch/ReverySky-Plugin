export const SCAPE_VIEW_PREFERENCE_VALUES = ["planets", "plain", "buildings"] as const;

export type ScapeViewPreference = (typeof SCAPE_VIEW_PREFERENCE_VALUES)[number];

export function isScapeViewPreference(value: unknown): value is ScapeViewPreference {
  return typeof value === "string" && SCAPE_VIEW_PREFERENCE_VALUES.includes(value as ScapeViewPreference);
}

export function formatScapeViewPreferenceValues(): string {
  return SCAPE_VIEW_PREFERENCE_VALUES.join(", ");
}
