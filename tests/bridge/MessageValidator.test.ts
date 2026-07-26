import { describe, expect, it } from "vitest";
import { BRIDGE_PROTOCOL_VERSION, GraphPayload } from "../../src/bridge/BridgeTypes";
import { MessageValidator } from "../../src/bridge/MessageValidator";

function makeValidPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: {
      noteCount: 1
    },
    notes: [
      {
        id: "note_1",
        path: "Folder/Note.md",
        title: "Note",
        tags: ["tag"],
        date: "2026-01-01T00:00:00.000Z",
        size: 128
      }
    ],
    links: [
      {
        sourceId: "note_1",
        targetId: "note_1",
        weight: 1,
        kind: "resolved"
      }
    ]
  };
}

describe("MessageValidator", () => {
  it("accepts a valid graph payload", () => {
    const payload = makeValidPayload();
    payload.mapLayout = "auto";
    const errors = MessageValidator.validateGraphPayload(payload);
    expect(errors).toEqual([]);
  });

  it("reports invalid graph payload fields", () => {
    const payload = makeValidPayload();
    payload.generatedAt = "not-a-date";
    payload.vault.noteCount = 2;
    payload.links[0].weight = 0;
    payload.notes[0].id = "  ";
    payload.notes[0].size = -1;
    payload.mapLayout = "invalid" as GraphPayload["mapLayout"];

    const errors = MessageValidator.validateGraphPayload(payload);
    expect(errors).toContain("payload.generatedAt must be a valid ISO-like date string");
    expect(errors).toContain("payload.vault.noteCount must equal payload.notes.length");
    expect(errors).toContain("payload.links[0].weight must be a positive number when defined");
    expect(errors).toContain("payload.notes[0].id must be a non-empty string");
    expect(errors).toContain("payload.notes[0].size must be a non-negative integer");
    expect(errors).toContain("payload.mapLayout must be one of: auto, dynamicLinks, dates, scalableLinks");
  });

  it("accepts runtime settings payload with a valid frame-rate mode", () => {
    const errors = MessageValidator.validateRuntimeSettingsPayload({
      frameRateMode: "fps60"
    });

    expect(errors).toEqual([]);
  });

  it("rejects runtime settings payload with an invalid frame-rate mode", () => {
    const errors = MessageValidator.validateRuntimeSettingsPayload({
      frameRateMode: "turbo"
    });

    expect(errors).toContain("payload.frameRateMode must be one of: auto, fps60, fps30, fps24");
  });

  it("rejects incoming bridge:ready message with protocol mismatch", () => {
    const errors = MessageValidator.validateIncomingReadyMessage({
      type: "bridge:ready",
      protocolVersion: `${BRIDGE_PROTOCOL_VERSION}-invalid`
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("incoming protocolVersion mismatch");
  });

  it("accepts incoming note:open with id and path", () => {
    const errors = MessageValidator.validateIncomingNoteOpenMessage({
      type: "note:open",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      payload: {
        id: "note_1",
        path: "Folder/Note.md"
      }
    });

    expect(errors).toEqual([]);
  });

  it("rejects incoming note:open when path is missing", () => {
    const errors = MessageValidator.validateIncomingNoteOpenMessage({
      type: "note:open",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      payload: {
        id: "note_1"
      } as never
    });

    expect(errors).toContain("incoming note:open payload.path must be a non-empty string");
  });

  it("accepts incoming graph:ready with requestId", () => {
    const errors = MessageValidator.validateIncomingGraphReadyMessage({
      type: "graph:ready",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId: "req_1700000000000_1"
    });

    expect(errors).toEqual([]);
  });

  it("rejects incoming graph:ready without requestId", () => {
    const errors = MessageValidator.validateIncomingGraphReadyMessage({
      type: "graph:ready",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId: ""
    });

    expect(errors).toContain("incoming graph:ready requestId must be a non-empty string");
  });

  it("accepts incoming runtime:shutdown-complete with matching protocol and requestId", () => {
    const errors = MessageValidator.validateIncomingShutdownCompleteMessage({
      type: "runtime:shutdown-complete",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId: "shutdown_1700000000000"
    });

    expect(errors).toEqual([]);
  });

  it("rejects incoming runtime:shutdown-complete without requestId", () => {
    const errors = MessageValidator.validateIncomingShutdownCompleteMessage({
      type: "runtime:shutdown-complete",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId: ""
    });

    expect(errors).toContain("incoming runtime:shutdown-complete requestId must be a non-empty string");
  });
});
