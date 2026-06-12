export const MAP_LAYOUT_PREFERENCE_VALUES = ["auto", "dynamicLinks", "dates", "scalableLinks"] as const;

export type MapLayoutPreference = (typeof MAP_LAYOUT_PREFERENCE_VALUES)[number];

export const DEFAULT_MAP_LAYOUT_PREFERENCE: MapLayoutPreference = "auto";
export const AUTO_SWITCH_THRESHOLD_NOTES = 500;

export const MAP_LAYOUT_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: MapLayoutPreference;
  label: string;
}> = [
  {
    value: "auto",
    label: "Auto"
  },
  {
    value: "dynamicLinks",
    label: `Dynamic links (<=${AUTO_SWITCH_THRESHOLD_NOTES} notes)`
  },
  {
    value: "scalableLinks",
    label: "Scalable links"
  },
  {
    value: "dates",
    label: "Dates"
  }
] as const;

export function isMapLayoutPreference(value: unknown): value is MapLayoutPreference {
  return typeof value === "string" && MAP_LAYOUT_PREFERENCE_VALUES.includes(value as MapLayoutPreference);
}

export function normalizeMapLayoutPreference(value: unknown): MapLayoutPreference {
  return isMapLayoutPreference(value) ? value : DEFAULT_MAP_LAYOUT_PREFERENCE;
}

export function formatMapLayoutPreferenceValues(): string {
  return MAP_LAYOUT_PREFERENCE_VALUES.join(", ");
}
