import {
  BRIDGE_PROTOCOL_VERSION,
  GraphReadyMessage,
  GraphPayload,
  IncomingBridgeMessage,
  NoteFocusPayload,
  NoteOpenMessage,
  RuntimeScreenshotResponseMessage,
  RuntimeShutdownCompleteMessage,
  TagActivateMessage
} from "./BridgeTypes";
import {
  formatMapLayoutPreferenceValues,
  isMapLayoutPreference
} from "./LayoutPreference";
import {
  formatFrameRateModeValues,
  isFrameRateMode
} from "./FrameRateMode";

/**
 * Validate bridge messages at the boundary so malformed payloads fail fast.
 */
export class MessageValidator {
  static validateGraphPayload(payload: GraphPayload): string[] {
    const errors: string[] = [];

    if (!payload || typeof payload !== "object") {
      return ["payload must be an object"];
    }

    if (!this.isNonEmptyString(payload.graphVersion)) {
      errors.push("payload.graphVersion must be a non-empty string");
    }

    if (!this.isValidDateString(payload.generatedAt)) {
      errors.push("payload.generatedAt must be a valid ISO-like date string");
    }

    if (!payload.vault || typeof payload.vault !== "object") {
      errors.push("payload.vault must be an object");
    } else if (!Number.isInteger(payload.vault.noteCount) || payload.vault.noteCount < 0) {
      errors.push("payload.vault.noteCount must be a non-negative integer");
    }

    if (!Array.isArray(payload.notes)) {
      errors.push("payload.notes must be an array");
    }

    if (!Array.isArray(payload.links)) {
      errors.push("payload.links must be an array");
    }

    if (Array.isArray(payload.notes)) {
      for (let i = 0; i < payload.notes.length; i++) {
        const note = payload.notes[i];
        if (!this.isNonEmptyString(note.id)) errors.push(`payload.notes[${i}].id must be a non-empty string`);
        if (!this.isNonEmptyString(note.path)) errors.push(`payload.notes[${i}].path must be a non-empty string`);
        if (!this.isNonEmptyString(note.title)) errors.push(`payload.notes[${i}].title must be a non-empty string`);
        if (!Array.isArray(note.tags)) errors.push(`payload.notes[${i}].tags must be an array`);
        if (note.buildings !== undefined) {
          if (!Array.isArray(note.buildings)) {
            errors.push(`payload.notes[${i}].buildings must be an array when defined`);
          } else {
            if (note.buildings.length === 0) {
              errors.push(`payload.notes[${i}].buildings must not be empty when defined`);
            }
            for (let j = 0; j < note.buildings.length; j++) {
              if (!this.isNonEmptyString(note.buildings[j])) {
                errors.push(`payload.notes[${i}].buildings[${j}] must be a non-empty string`);
              }
            }
          }
        }
        if (!Number.isInteger(note.size) || note.size < 0) {
          errors.push(`payload.notes[${i}].size must be a non-negative integer`);
        }
        if (note.date !== undefined && !this.isValidDateString(note.date)) {
          errors.push(`payload.notes[${i}].date must be a valid ISO-like date string when defined`);
        }
      }
    }

    if (Array.isArray(payload.links)) {
      for (let i = 0; i < payload.links.length; i++) {
        const link = payload.links[i];
        if (!this.isNonEmptyString(link.sourceId)) errors.push(`payload.links[${i}].sourceId must be a non-empty string`);
        if (!this.isNonEmptyString(link.targetId)) errors.push(`payload.links[${i}].targetId must be a non-empty string`);
        if (link.weight !== undefined && (!Number.isFinite(link.weight) || link.weight <= 0)) {
          errors.push(`payload.links[${i}].weight must be a positive number when defined`);
        }
      }
    }

    if (Array.isArray(payload.notes) && payload.vault && payload.notes.length !== payload.vault.noteCount) {
      errors.push("payload.vault.noteCount must equal payload.notes.length");
    }

    if (
      payload.mapLayout !== undefined &&
      !isMapLayoutPreference(payload.mapLayout)
    ) {
      errors.push(`payload.mapLayout must be one of: ${formatMapLayoutPreferenceValues()}`);
    }

    return errors;
  }

  static validateRuntimeSettingsPayload(payload: unknown): string[] {
    const errors: string[] = [];

    if (!payload || typeof payload !== "object") {
      return ["payload must be an object"];
    }

    const frameRateMode = (payload as { frameRateMode?: unknown }).frameRateMode;
    if (!isFrameRateMode(frameRateMode)) {
      errors.push(`payload.frameRateMode must be one of: ${formatFrameRateModeValues()}`);
    }

    return errors;
  }

  static validateNoteFocusPayload(payload: NoteFocusPayload): string[] {
    const errors: string[] = [];

    if (!payload || typeof payload !== "object") {
      return ["payload must be an object"];
    }

    if (!this.isNonEmptyString(payload.id)) {
      errors.push("payload.id must be a non-empty string");
    }
    if (!this.isNonEmptyString(payload.path)) {
      errors.push("payload.path must be a non-empty string");
    }

    return errors;
  }

  static validateIncomingReadyMessage(data: IncomingBridgeMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "bridge:ready") {
      errors.push("incoming message type must be bridge:ready");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    return errors;
  }

  static validateIncomingNoteOpenMessage(data: NoteOpenMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "note:open") {
      errors.push("incoming message type must be note:open");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    if (!data.payload || typeof data.payload !== "object") {
      errors.push("incoming note:open payload must be an object");
      return errors;
    }

    if (!this.isNonEmptyString(data.payload.id)) {
      errors.push("incoming note:open payload.id must be a non-empty string");
    }
    if (!this.isNonEmptyString(data.payload.path)) {
      errors.push("incoming note:open payload.path must be a non-empty string");
    }

    return errors;
  }

  static validateIncomingTagActivateMessage(data: TagActivateMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "tag:activate") {
      errors.push("incoming message type must be tag:activate");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    if (!data.payload || typeof data.payload !== "object") {
      errors.push("incoming tag:activate payload must be an object");
      return errors;
    }

    if (!this.isNonEmptyString(data.payload.tag)) {
      errors.push("incoming tag:activate payload.tag must be a non-empty string");
    }

    return errors;
  }

  static validateIncomingGraphReadyMessage(data: GraphReadyMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "graph:ready") {
      errors.push("incoming message type must be graph:ready");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    if (!this.isNonEmptyString(data.requestId)) {
      errors.push("incoming graph:ready requestId must be a non-empty string");
    }

    return errors;
  }

  static validateIncomingShutdownCompleteMessage(data: RuntimeShutdownCompleteMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "runtime:shutdown-complete") {
      errors.push("incoming message type must be runtime:shutdown-complete");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    if (!this.isNonEmptyString(data.requestId)) {
      errors.push("incoming runtime:shutdown-complete requestId must be a non-empty string");
    }

    return errors;
  }

  static validateIncomingRuntimeScreenshotResponseMessage(data: RuntimeScreenshotResponseMessage): string[] {
    const errors: string[] = [];

    if (!data || typeof data !== "object") {
      return ["incoming message must be an object"];
    }

    if (data.type !== "runtime:screenshot-response") {
      errors.push("incoming message type must be runtime:screenshot-response");
    }

    if (data.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      errors.push(
        `incoming protocolVersion mismatch: expected ${BRIDGE_PROTOCOL_VERSION}, got ${String(data.protocolVersion)}`
      );
    }

    if (!data.payload || typeof data.payload !== "object") {
      errors.push("incoming runtime:screenshot-response payload must be an object");
      return errors;
    }

    if (data.payload.ok === true) {
      if (!this.isBlobLike(data.payload.blob)) {
        errors.push("incoming runtime:screenshot-response payload.blob must be a Blob-like object when ok is true");
      }
      return errors;
    }

    if (data.payload.ok !== false) {
      errors.push("incoming runtime:screenshot-response payload.ok must be a boolean");
    }

    return errors;
  }

  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private static isBlobLike(value: unknown): value is Blob {
    if (!value || typeof value !== "object") {
      return false;
    }

    const blob = value as Blob;

    return (
      typeof blob.size === "number" &&
      typeof blob.type === "string" &&
      typeof blob.arrayBuffer === "function"
    );
  }

  private static isValidDateString(value: unknown): value is string {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }
}
