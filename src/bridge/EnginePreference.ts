export const ENGINE_PREFERENCE_VALUES = ["auto", "forces", "static25d"] as const;

export type GraphEnginePreference = (typeof ENGINE_PREFERENCE_VALUES)[number];

export const DEFAULT_ENGINE_PREFERENCE: GraphEnginePreference = "auto";

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
    label: "Map of links (<200 notes)"
  },
  {
    value: "static25d",
    label: "Map of dates"
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
