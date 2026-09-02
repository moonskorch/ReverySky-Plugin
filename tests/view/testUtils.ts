import { vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";

export function makeBuildGraphMock(payload: GraphPayload): (app: unknown, landmarkSource: string) => GraphPayload {
  return vi.fn(() => payload) as unknown as (app: unknown, landmarkSource: string) => GraphPayload;
}

export function makeVoidCallback<Args extends unknown[] = []>(): (...args: Args) => void {
  return vi.fn() as unknown as (...args: Args) => void;
}

export function callMaybe<T extends (...args: any[]) => unknown>(
  fn: T | null | undefined,
  ...args: Parameters<T>
): void {
  fn?.(...args);
}
