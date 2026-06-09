export const ENGINE_PREFERENCE_VALUES = ["auto", "forces", "staticLinks", "static25D"] as const;

export type GraphEnginePreference = (typeof ENGINE_PREFERENCE_VALUES)[number];

export const DEFAULT_ENGINE_PREFERENCE: GraphEnginePreference = "auto";
export const AUTO_SWITCH_THRESHOLD_NOTES = 500;

export const ENGINE_PREFERENCE_OPTIONS: ReadonlyArray<{
  value: GraphEnginePreference;
  label: string;
}> = [
  {
    value: "auto",
    label: "Auto"
  },
  {
    value: "forces",
    label: `Dynamic links (<=${AUTO_SWITCH_THRESHOLD_NOTES} notes)`
  },
  {
    value: "staticLinks",
    label: "Static links"
  },
  {
    value: "static25D",
    label: "Dates"
  }
] as const;

export function isGraphEnginePreference(value: unknown): value is GraphEnginePreference {
  return typeof value === "string" && ENGINE_PREFERENCE_VALUES.includes(value as GraphEnginePreference);
}

export function normalizeGraphEnginePreference(value: unknown): GraphEnginePreference {
  return isGraphEnginePreference(value) ? value : DEFAULT_ENGINE_PREFERENCE;
}

export function formatGraphEnginePreferenceValues(): string {
  return ENGINE_PREFERENCE_VALUES.join(", ");
}
