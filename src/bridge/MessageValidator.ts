import {
  BRIDGE_PROTOCOL_VERSION,
  GraphPayload,
  IncomingBridgeMessage
} from "./BridgeTypes";

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
        if (!note.dates || typeof note.dates !== "object") errors.push(`payload.notes[${i}].dates must be an object`);
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

  private static isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }

  private static isValidDateString(value: unknown): value is string {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }
}
