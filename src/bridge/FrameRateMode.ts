export const FRAME_RATE_MODE_VALUES = ["auto", "fps60", "fps30", "fps24"] as const;

export type FrameRateMode = (typeof FRAME_RATE_MODE_VALUES)[number];

export const DEFAULT_FRAME_RATE_MODE: FrameRateMode = "auto";

export const FRAME_RATE_MODE_OPTIONS: ReadonlyArray<{
  value: FrameRateMode;
  label: string;
}> = [
  {
    value: "auto",
    label: "Auto"
  },
  {
    value: "fps60",
    label: "60 FPS"
  },
  {
    value: "fps30",
    label: "30 FPS"
  },
  {
    value: "fps24",
    label: "24 FPS"
  }
] as const;

export function isFrameRateMode(value: unknown): value is FrameRateMode {
  return typeof value === "string" && FRAME_RATE_MODE_VALUES.includes(value as FrameRateMode);
}

export function normalizeFrameRateMode(value: unknown): FrameRateMode {
  return isFrameRateMode(value) ? value : DEFAULT_FRAME_RATE_MODE;
}

export function formatFrameRateModeValues(): string {
  return FRAME_RATE_MODE_VALUES.join(", ");
}
