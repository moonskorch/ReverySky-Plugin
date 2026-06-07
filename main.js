"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ReverySkyMapPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/view/ReverySkyMapView.ts
var import_obsidian = require("obsidian");

// src/bridge/BridgeTypes.ts
var BRIDGE_PROTOCOL_VERSION = "2.0.0";

// src/bridge/MessageValidator.ts
var MessageValidator = class {
  static validateGraphPayload(payload) {
    const errors = [];
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
        if (!Number.isInteger(note.size) || note.size < 0) {
          errors.push(`payload.notes[${i}].size must be a non-negative integer`);
        }
        if (note.date !== void 0 && !this.isValidDateString(note.date)) {
          errors.push(`payload.notes[${i}].date must be a valid ISO-like date string when defined`);
        }
      }
    }
    if (Array.isArray(payload.links)) {
      for (let i = 0; i < payload.links.length; i++) {
        const link = payload.links[i];
        if (!this.isNonEmptyString(link.sourceId)) errors.push(`payload.links[${i}].sourceId must be a non-empty string`);
        if (!this.isNonEmptyString(link.targetId)) errors.push(`payload.links[${i}].targetId must be a non-empty string`);
        if (link.weight !== void 0 && (!Number.isFinite(link.weight) || link.weight <= 0)) {
          errors.push(`payload.links[${i}].weight must be a positive number when defined`);
        }
      }
    }
    if (Array.isArray(payload.notes) && payload.vault && payload.notes.length !== payload.vault.noteCount) {
      errors.push("payload.vault.noteCount must equal payload.notes.length");
    }
    if (payload.enginePreference !== void 0 && !this.isGraphEnginePreference(payload.enginePreference)) {
      errors.push("payload.enginePreference must be one of: auto, forces, static25d");
    }
    return errors;
  }
  static validateIncomingReadyMessage(data) {
    const errors = [];
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
  static validateIncomingNoteOpenMessage(data) {
    const errors = [];
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
    const id = typeof data.payload.id === "string" ? data.payload.id.trim() : "";
    const path3 = typeof data.payload.path === "string" ? data.payload.path.trim() : "";
    if (!id && !path3) {
      errors.push("incoming note:open payload must include non-empty id or path");
    }
    return errors;
  }
  static isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }
  static isValidDateString(value) {
    if (typeof value !== "string" || !value.trim()) {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }
  static isGraphEnginePreference(value) {
    return value === "auto" || value === "forces" || value === "static25d";
  }
};

// src/bridge/UnityIframeBridge.ts
var UnityIframeBridge = class {
  constructor() {
    this.iframeWindow = null;
    this.attached = false;
    this.callbacks = {};
    this.onMessageRef = (event) => this.onMessage(event);
  }
  attach(iframeWindow, callbacks) {
    if (this.attached) {
      this.detach();
    }
    this.iframeWindow = iframeWindow;
    this.callbacks = callbacks;
    window.addEventListener("message", this.onMessageRef);
    this.attached = true;
  }
  detach() {
    if (!this.attached) {
      return;
    }
    window.removeEventListener("message", this.onMessageRef);
    this.iframeWindow = null;
    this.callbacks = {};
    this.attached = false;
  }
  sendGraphSet(payload) {
    if (!this.iframeWindow) {
      this.callbacks.onError?.("Bridge is not attached to iframe window.");
      return;
    }
    const payloadErrors = MessageValidator.validateGraphPayload(payload);
    if (payloadErrors.length > 0) {
      this.callbacks.onError?.(`Invalid graph payload: ${payloadErrors.join("; ")}`);
      return;
    }
    const message = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "graph:set",
      requestId: `req_${Date.now()}`,
      payload
    };
    this.iframeWindow.postMessage(message, "*");
  }
  sendNoteFocus(payload) {
    if (!this.iframeWindow) {
      this.callbacks.onError?.("Bridge is not attached to iframe window.");
      return;
    }
    const noteId = typeof payload.id === "string" ? payload.id.trim() : "";
    const notePath = typeof payload.path === "string" ? payload.path.trim() : "";
    if (!noteId && !notePath) {
      this.callbacks.onError?.("Invalid note focus payload: id or path is required.");
      return;
    }
    const message = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      type: "note:focus",
      requestId: `req_${Date.now()}`,
      payload: {
        id: noteId || void 0,
        path: notePath || void 0
      }
    };
    this.iframeWindow.postMessage(message, "*");
  }
  onMessage(event) {
    if (!this.iframeWindow || event.source !== this.iframeWindow) {
      return;
    }
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "bridge:ready") {
      const incomingErrors = MessageValidator.validateIncomingReadyMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      this.callbacks.onReady?.();
      return;
    }
    if (data.type === "note:open") {
      const incomingErrors = MessageValidator.validateIncomingNoteOpenMessage(data);
      if (incomingErrors.length > 0) {
        this.callbacks.onError?.(`Invalid incoming bridge message: ${incomingErrors.join("; ")}`);
        return;
      }
      this.callbacks.onNoteOpen?.(data.payload ?? {});
    }
  }
};

// src/graph/GraphNormalizer.ts
var GraphNormalizer = class _GraphNormalizer {
  static normalizePath(path3) {
    return path3.replace(/\\/g, "/");
  }
  static normalizeTag(tag) {
    const trimmed = tag.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
  }
  static normalizeTags(tags) {
    const out = /* @__PURE__ */ new Set();
    for (const tag of tags) {
      const normalized = _GraphNormalizer.normalizeTag(tag);
      if (normalized) {
        out.add(normalized);
      }
    }
    return Array.from(out);
  }
};

// src/graph/VaultGraphBuilder.ts
var VaultGraphBuilder = class _VaultGraphBuilder {
  static build(app) {
    const files = app.vault.getMarkdownFiles();
    const notes = files.map((file) => _VaultGraphBuilder.toNoteNode(app, file)).sort((a, b) => a.path.localeCompare(b.path));
    const links = _VaultGraphBuilder.buildLinks(app, notes);
    return {
      graphVersion: "0.0.1",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      vault: {
        noteCount: notes.length
      },
      notes,
      links
    };
  }
  static buildLinks(app, notes) {
    const noteIdByPath = /* @__PURE__ */ new Map();
    for (const note of notes) {
      noteIdByPath.set(GraphNormalizer.normalizePath(note.path), note.id);
    }
    const links = [];
    const resolvedLinks = app.metadataCache.resolvedLinks;
    for (const [sourcePathRaw, targets] of Object.entries(resolvedLinks)) {
      const sourcePath = GraphNormalizer.normalizePath(sourcePathRaw);
      const sourceId = noteIdByPath.get(sourcePath);
      if (!sourceId) {
        continue;
      }
      for (const [targetPathRaw, count] of Object.entries(targets)) {
        if (!count || count < 1) {
          continue;
        }
        const targetPath = GraphNormalizer.normalizePath(targetPathRaw);
        const targetId = noteIdByPath.get(targetPath);
        if (!targetId) {
          continue;
        }
        links.push({
          sourceId,
          targetId,
          weight: count,
          kind: "resolved"
        });
      }
    }
    links.sort((a, b) => {
      const sourceCmp = a.sourceId.localeCompare(b.sourceId);
      if (sourceCmp !== 0) {
        return sourceCmp;
      }
      return a.targetId.localeCompare(b.targetId);
    });
    return links;
  }
  static toNoteNode(app, file) {
    const cache = app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter;
    const tags = GraphNormalizer.normalizeTags([
      ..._VaultGraphBuilder.getInlineTags(cache),
      ..._VaultGraphBuilder.getFrontmatterTags(frontmatter?.tags)
    ]);
    const created = Number.isFinite(file.stat.ctime) ? new Date(file.stat.ctime).toISOString() : void 0;
    const date = _VaultGraphBuilder.getFrontmatterDate(frontmatter?.date) ?? created;
    return {
      id: _VaultGraphBuilder.makeStableId(file.path),
      path: GraphNormalizer.normalizePath(file.path),
      title: file.basename,
      tags,
      size: _VaultGraphBuilder.getNoteSizeBytes(file),
      ...date ? { date } : {}
    };
  }
  static getInlineTags(cache) {
    if (!cache?.tags?.length) {
      return [];
    }
    return cache.tags.map((t) => t.tag);
  }
  static getFrontmatterTags(value) {
    if (Array.isArray(value)) {
      return value.filter((x) => typeof x === "string");
    }
    if (typeof value === "string") {
      return value.split(",").map((x) => x.trim()).filter(Boolean);
    }
    return [];
  }
  static getFrontmatterDate(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return void 0;
      }
      const d = new Date(trimmed);
      return Number.isNaN(d.getTime()) ? void 0 : d.toISOString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? void 0 : d.toISOString();
    }
    return void 0;
  }
  static makeStableId(path3) {
    let hash = 2166136261;
    for (let i = 0; i < path3.length; i++) {
      hash ^= path3.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `note_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
  static getNoteSizeBytes(file) {
    const rawSize = file?.stat?.size;
    if (!Number.isFinite(rawSize)) {
      return 0;
    }
    return Math.max(0, Math.trunc(rawSize));
  }
};

// src/graph/GraphPathFilter.ts
var _GraphPathFilter = class _GraphPathFilter {
  static parsePathQuery(query) {
    const rawQuery = typeof query === "string" ? query.trim() : "";
    if (!rawQuery) {
      return {
        isValid: true,
        parsed: null,
        hasPathTerms: false,
        hasUnsupportedTokens: false
      };
    }
    const tokenized = _GraphPathFilter.tokenize(rawQuery);
    if (!tokenized.ok) {
      return {
        isValid: false,
        parsed: null,
        hasPathTerms: false,
        hasUnsupportedTokens: false,
        reason: tokenized.reason
      };
    }
    const includeTerms = [];
    const excludeTerms = [];
    const includeRegexes = [];
    const excludeRegexes = [];
    const includeDateClauses = [];
    const excludeDateClauses = [];
    const includeTagTerms = [];
    const excludeTagTerms = [];
    const unsupportedTokens = [];
    for (const token of tokenized.tokens) {
      const trimmed = token.trim();
      if (!trimmed) {
        continue;
      }
      const isNegated = trimmed.startsWith("-");
      const body = isNegated ? trimmed.slice(1) : trimmed;
      if (!body.toLowerCase().startsWith("path:")) {
        if (body.toLowerCase().startsWith("date:")) {
          const rawDateTerm = body.slice("date:".length).trim();
          const dateClause = _GraphPathFilter.tryParseDateClause(rawDateTerm);
          if (dateClause.kind === "invalid") {
            return {
              isValid: false,
              parsed: null,
              hasPathTerms: false,
              hasUnsupportedTokens: unsupportedTokens.length > 0,
              reason: dateClause.reason
            };
          }
          if (dateClause.kind === "empty") {
            if (isNegated) {
              continue;
            }
            includeDateClauses.push({
              comparator: "eq",
              day: _GraphPathFilter.NO_MATCH_DATE_SENTINEL
            });
            continue;
          }
          if (isNegated) {
            excludeDateClauses.push(dateClause.value);
          } else {
            includeDateClauses.push(dateClause.value);
          }
          continue;
        }
        if (body.toLowerCase().startsWith("tag:")) {
          const rawTagTerm = body.slice("tag:".length).trim();
          if (!rawTagTerm) {
            if (isNegated) {
              continue;
            }
            includeTagTerms.push(_GraphPathFilter.NO_MATCH_TAG_SENTINEL);
            continue;
          }
          const normalizedTagTerm = _GraphPathFilter.normalizeTagMatchValue(rawTagTerm);
          if (!normalizedTagTerm) {
            if (isNegated) {
              continue;
            }
            includeTagTerms.push(_GraphPathFilter.NO_MATCH_TAG_SENTINEL);
            continue;
          }
          if (isNegated) {
            excludeTagTerms.push(normalizedTagTerm);
          } else {
            includeTagTerms.push(normalizedTagTerm);
          }
          continue;
        }
        unsupportedTokens.push(trimmed);
        continue;
      }
      const rawTerm = body.slice("path:".length).trim();
      if (!rawTerm) {
        if (isNegated) {
          continue;
        }
        includeTerms.push(_GraphPathFilter.NO_MATCH_SENTINEL);
        continue;
      }
      const regexTerm = _GraphPathFilter.tryParseRegexLiteral(rawTerm);
      if (regexTerm.kind === "invalid") {
        return {
          isValid: false,
          parsed: null,
          hasPathTerms: false,
          hasUnsupportedTokens: unsupportedTokens.length > 0,
          reason: regexTerm.reason
        };
      }
      if (regexTerm.kind === "regex") {
        if (isNegated) {
          excludeRegexes.push(regexTerm.value);
        } else {
          includeRegexes.push(regexTerm.value);
        }
        continue;
      }
      const normalizedTerm = _GraphPathFilter.normalizeMatchValue(rawTerm);
      if (!normalizedTerm) {
        if (isNegated) {
          continue;
        }
        includeTerms.push(_GraphPathFilter.NO_MATCH_SENTINEL);
        continue;
      }
      if (isNegated) {
        excludeTerms.push(normalizedTerm);
      } else {
        includeTerms.push(normalizedTerm);
      }
    }
    const hasPathTerms = includeTerms.length > 0 || excludeTerms.length > 0;
    const hasRegexTerms = includeRegexes.length > 0 || excludeRegexes.length > 0;
    const hasDateTerms = includeDateClauses.length > 0 || excludeDateClauses.length > 0;
    const hasTagTerms = includeTagTerms.length > 0 || excludeTagTerms.length > 0;
    const hasSupportedTerms = hasPathTerms || hasRegexTerms || hasDateTerms || hasTagTerms;
    return {
      isValid: true,
      parsed: hasSupportedTerms ? {
        includeTerms,
        excludeTerms,
        includeRegexes,
        excludeRegexes,
        includeDateClauses,
        excludeDateClauses,
        includeTagTerms,
        excludeTagTerms,
        unsupportedTokens
      } : null,
      hasPathTerms: hasSupportedTerms,
      hasUnsupportedTokens: unsupportedTokens.length > 0
    };
  }
  static applyPathFilter(payload, parsed) {
    if (!parsed || !parsed.includeTerms.length && !parsed.excludeTerms.length && !parsed.includeRegexes.length && !parsed.excludeRegexes.length && !parsed.includeDateClauses.length && !parsed.excludeDateClauses.length && !parsed.includeTagTerms.length && !parsed.excludeTagTerms.length) {
      return payload;
    }
    const notes = payload.notes.filter((note) => _GraphPathFilter.matchesNote(note, parsed));
    const keepIds = new Set(notes.map((note) => note.id));
    const links = payload.links.filter(
      (link) => keepIds.has(link.sourceId) && keepIds.has(link.targetId)
    );
    return {
      ...payload,
      vault: {
        ...payload.vault,
        noteCount: notes.length
      },
      notes,
      links
    };
  }
  static matchesNote(note, parsed) {
    const normalizedPath = _GraphPathFilter.normalizeMatchValue(note.path);
    const noteDay = _GraphPathFilter.toIsoDayKey(note.date);
    for (const exclude of parsed.excludeTerms) {
      if (normalizedPath.includes(exclude)) {
        return false;
      }
    }
    for (const excludeRegex of parsed.excludeRegexes) {
      if (excludeRegex.test(normalizedPath)) {
        return false;
      }
    }
    for (const excludeDate of parsed.excludeDateClauses) {
      if (noteDay && _GraphPathFilter.matchesDateClause(noteDay, excludeDate)) {
        return false;
      }
    }
    for (const excludeTag of parsed.excludeTagTerms) {
      if (_GraphPathFilter.noteHasMatchingTag(note, excludeTag)) {
        return false;
      }
    }
    for (const include of parsed.includeTerms) {
      if (!normalizedPath.includes(include)) {
        return false;
      }
    }
    for (const includeRegex of parsed.includeRegexes) {
      if (!includeRegex.test(normalizedPath)) {
        return false;
      }
    }
    for (const includeDate of parsed.includeDateClauses) {
      if (!noteDay || !_GraphPathFilter.matchesDateClause(noteDay, includeDate)) {
        return false;
      }
    }
    for (const includeTag of parsed.includeTagTerms) {
      if (!_GraphPathFilter.noteHasMatchingTag(note, includeTag)) {
        return false;
      }
    }
    return true;
  }
  static normalizeMatchValue(value) {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }
  static normalizeTagMatchValue(value) {
    return value.trim().replace(/^#/, "").toLowerCase();
  }
  static noteHasMatchingTag(note, queryTag) {
    return note.tags.some((tag) => {
      const normalizedTag = _GraphPathFilter.normalizeTagMatchValue(tag);
      return normalizedTag === queryTag || normalizedTag.startsWith(`${queryTag}/`);
    });
  }
  static toIsoDayKey(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const trimmed = value.trim();
    const leadingDayMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:$|[Tt\s].*)/);
    if (leadingDayMatch?.[1] && _GraphPathFilter.isValidCalendarDay(leadingDayMatch[1])) {
      return leadingDayMatch[1];
    }
    const parsedDate = new Date(trimmed);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }
    return parsedDate.toISOString().slice(0, 10);
  }
  static matchesDateClause(noteDay, clause) {
    switch (clause.comparator) {
      case "lte":
        return noteDay <= clause.day;
      case "gte":
        return noteDay >= clause.day;
      case "lt":
        return noteDay < clause.day;
      case "gt":
        return noteDay > clause.day;
      default:
        return noteDay === clause.day;
    }
  }
  static tryParseRegexLiteral(term) {
    if (!term.startsWith("/")) {
      return { kind: "not_regex" };
    }
    const regexLiteralMatch = term.match(/^\/((?:\\.|[^\\/])*)\/([dgimsuvy]*)$/);
    if (!regexLiteralMatch) {
      return {
        kind: "invalid",
        reason: "Invalid regex in path filter."
      };
    }
    const pattern = regexLiteralMatch[1] ?? "";
    const rawFlags = regexLiteralMatch[2] ?? "";
    const flags = rawFlags.replace(/g/g, "");
    try {
      return {
        kind: "regex",
        value: new RegExp(pattern, flags)
      };
    } catch {
      return {
        kind: "invalid",
        reason: "Invalid regex in path filter."
      };
    }
  }
  static tryParseDateClause(term) {
    const trimmed = term.trim();
    if (!trimmed) {
      return { kind: "empty" };
    }
    const dateMatch = trimmed.match(/^((?:<=|>=|<|>|=)?)(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) {
      return {
        kind: "invalid",
        reason: "Invalid date in date filter. Use date:YYYY-MM-DD, date:>YYYY-MM-DD, date:<YYYY-MM-DD, date:>=YYYY-MM-DD, or date:<=YYYY-MM-DD."
      };
    }
    const operator = dateMatch[1] ?? "";
    const day = dateMatch[2] ?? "";
    if (!_GraphPathFilter.isValidCalendarDay(day)) {
      return {
        kind: "invalid",
        reason: "Invalid calendar date in date filter."
      };
    }
    const comparator = operator === ">=" ? "gte" : operator === "<=" ? "lte" : operator === ">" ? "gt" : operator === "<" ? "lt" : "eq";
    return {
      kind: "clause",
      value: {
        comparator,
        day
      }
    };
  }
  static isValidCalendarDay(day) {
    const [rawYear, rawMonth, rawDate] = day.split("-");
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const date = Number(rawDate);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(date) || month < 1 || month > 12 || date < 1 || date > 31) {
      return false;
    }
    const utc = new Date(Date.UTC(year, month - 1, date));
    return utc.getUTCFullYear() === year && utc.getUTCMonth() + 1 === month && utc.getUTCDate() === date;
  }
  static tokenize(query) {
    const tokens = [];
    let current = "";
    let inQuote = false;
    let escaped = false;
    for (let i = 0; i < query.length; i++) {
      const ch = query[i];
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (inQuote && ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inQuote = !inQuote;
        continue;
      }
      if (!inQuote && /\s/.test(ch)) {
        if (current.length > 0) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      current += ch;
    }
    if (escaped) {
      current += "\\";
    }
    if (inQuote) {
      return {
        ok: false,
        reason: "Unclosed quote in query."
      };
    }
    if (current.length > 0) {
      tokens.push(current);
    }
    return {
      ok: true,
      tokens
    };
  }
};
_GraphPathFilter.NO_MATCH_SENTINEL = "\0__empty_path_term__";
_GraphPathFilter.NO_MATCH_DATE_SENTINEL = "\0__empty_date_term__";
_GraphPathFilter.NO_MATCH_TAG_SENTINEL = "\0__empty_tag_term__";
var GraphPathFilter = _GraphPathFilter;

// src/view/ReverySkyMapView.ts
var REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";
var GRAPH_REFRESH_DEBOUNCE_MS = 250;
var GRAPH_RESOLVE_BARRIER_FALLBACK_MS = 700;
var FILTER_INPUT_DEBOUNCE_MS = 250;
var FILTER_SUGGESTIONS_HIDE_DELAY_MS = 120;
var MAX_FOLDER_SUGGESTIONS = 80;
var MAX_TAG_SUGGESTIONS = 200;
var DEFAULT_ENGINE_PREFERENCE = "auto";
var ENGINE_PREFERENCE_OPTIONS = [
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
];
var ReverySkyMapView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin, deps = {}) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
    this.sourceGraphPayload = null;
    this.lastGraphPayload = null;
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastMarkdownLeaf = null;
    this.activeMarkdownPath = "";
    this.focusOrdinal = 0;
    this.activeFocusOrdinal = 0;
    this.pendingCreatedFocusOrdinal = 0;
    this.pendingCreatedFocusPath = null;
    this.lastDispatchedFocusKey = "";
    this.semanticRefreshPending = false;
    this.noteSignatureByPath = /* @__PURE__ */ new Map();
    this.bridgeReady = false;
    this.refreshTimer = null;
    this.resolveBarrierFallbackTimer = null;
    this.refreshSubscriptionsRegistered = false;
    this.refreshActive = false;
    this.leafTrackingRegistered = false;
    this.pathFilterQuery = "";
    this.showTags = true;
    this.enginePreference = DEFAULT_ENGINE_PREFERENCE;
    this.activePathFilter = null;
    this.pathFilterParseValid = true;
    this.pathFilterMessage = "";
    this.filterInputDebounceTimer = null;
    this.filterSuggestionsHideTimer = null;
    this.filterMessageEl = null;
    this.filterSuggestionsEl = null;
    this.filterPanelEl = null;
    this.filterToggleButtonEl = null;
    this.tagsToggleButtonEl = null;
    this.engineDropdownEl = null;
    this.filterSuggestionMode = 0;
    this.folderPathSuggestions = [];
    this.tagSuggestions = [];
    this.searchComponent = null;
    this.filterPanelOpen = false;
    this.bridge = deps.createBridge?.() ?? new UnityIframeBridge();
    this.buildGraph = deps.buildGraph ?? VaultGraphBuilder.build;
    this.notify = deps.notify ?? ((message) => new import_obsidian.Notice(message));
    this.now = deps.now ?? Date.now;
  }
  getViewType() {
    return REVERYSKY_MAP_VIEW_TYPE;
  }
  getDisplayText() {
    return "ReverySky Map";
  }
  getState() {
    return {
      pathFilterQuery: this.pathFilterQuery,
      showTags: this.showTags,
      enginePreference: this.enginePreference
    };
  }
  async setState(state) {
    const nextState = state ?? {};
    const nextQuery = typeof nextState.pathFilterQuery === "string" ? nextState.pathFilterQuery : "";
    const nextShowTags = typeof nextState.showTags === "boolean" ? nextState.showTags : true;
    const nextEnginePreference = this.normalizeEnginePreference(nextState.enginePreference);
    this.pathFilterQuery = nextQuery;
    this.setShowTags(nextShowTags, { emit: false });
    this.setEnginePreference(nextEnginePreference, { emit: false });
    this.applyParsedFilterResult(GraphPathFilter.parsePathQuery(nextQuery));
    this.syncSearchComponentValue();
    this.refreshFilterMessage();
  }
  async onOpen() {
    this.ensureLeafTracking();
    this.ensureRefreshSubscriptions();
    this.refreshActive = true;
    this.bridgeReady = false;
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastDispatchedFocusKey = "";
    this.pendingCreatedFocusPath = null;
    this.pendingCreatedFocusOrdinal = 0;
    this.semanticRefreshPending = false;
    this.clearRefreshTimer();
    this.clearResolveBarrierFallbackTimer();
    const container = this.contentEl;
    emptyElement(container);
    const iframeHost = this.renderViewLayout(container);
    this.syncSearchComponentValue();
    this.refreshFilterMessage();
    let iframeSrc;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }
    const iframe = createChild(iframeHost, "iframe");
    iframe.src = `${iframeSrc}?t=${this.now()}`;
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    if (typeof iframe.setAttr === "function") {
      iframe.setAttr("title", "ReverySky Map");
    } else {
      iframe.setAttribute("title", "ReverySky Map");
    }
    iframe.addEventListener("load", () => {
      if (!iframe.contentWindow) {
        this.notify("Failed to access iframe window.");
        return;
      }
      this.bridge.attach(iframe.contentWindow, {
        onReady: () => {
          this.bridgeReady = true;
          this.flushOrRefreshGraph();
        },
        onNoteOpen: (payload) => {
          void this.openRequestedNote(payload);
        },
        onError: (message) => {
          this.notify(message);
        }
      });
    });
  }
  async onClose() {
    this.refreshActive = false;
    this.clearRefreshTimer();
    this.clearResolveBarrierFallbackTimer();
    this.clearFilterInputDebounceTimer();
    this.clearFilterSuggestionsHideTimer();
    this.bridgeReady = false;
    this.sourceGraphPayload = null;
    this.folderPathSuggestions = [];
    this.tagSuggestions = [];
    this.pendingGraphPayload = null;
    this.pendingFocusPayload = null;
    this.lastDispatchedFocusKey = "";
    this.pendingCreatedFocusPath = null;
    this.pendingCreatedFocusOrdinal = 0;
    this.semanticRefreshPending = false;
    this.bridge.detach();
    this.lastGraphPayload = null;
    this.searchComponent = null;
    this.filterMessageEl = null;
    this.filterSuggestionsEl = null;
    this.filterPanelEl = null;
    this.filterToggleButtonEl = null;
    this.tagsToggleButtonEl = null;
    this.engineDropdownEl = null;
    this.filterSuggestionMode = 0;
    emptyElement(this.contentEl);
  }
  ensureRefreshSubscriptions() {
    if (this.refreshSubscriptionsRegistered) {
      return;
    }
    this.refreshSubscriptionsRegistered = true;
    const metadataCache = this.app.metadataCache;
    const vault = this.app.vault;
    if (metadataCache?.on) {
      this.registerEvent(
        metadataCache.on("changed", (file, _data, cache) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          const path3 = this.normalizeVaultPath(file.path);
          const nextSignature = this.buildGraphRelevantSignature(cache);
          const previousSignature = this.noteSignatureByPath.get(path3) ?? "";
          this.noteSignatureByPath.set(path3, nextSignature);
          if (nextSignature === previousSignature) {
            return;
          }
          this.markSemanticRefreshPending();
        })
      );
      this.registerEvent(
        metadataCache.on("resolved", () => {
          if (!this.semanticRefreshPending) {
            return;
          }
          this.semanticRefreshPending = false;
          this.clearResolveBarrierFallbackTimer();
          this.scheduleGraphRefresh();
        })
      );
    }
    if (vault?.on) {
      this.registerEvent(
        vault.on("create", (file) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          const normalizedPath = this.normalizeVaultPath(file.path);
          this.pendingCreatedFocusPath = normalizedPath;
          this.pendingCreatedFocusOrdinal = ++this.focusOrdinal;
          this.scheduleGraphRefresh();
        })
      );
      this.registerEvent(
        vault.on("delete", (file) => {
          if (!this.isGraphRelevantPath(file?.path)) {
            return;
          }
          this.noteSignatureByPath.delete(this.normalizeVaultPath(file.path));
          this.scheduleGraphRefresh();
        })
      );
      this.registerEvent(
        vault.on("rename", (file, oldPath) => {
          if (!this.isGraphRelevantPath(file?.path) && !this.isGraphRelevantPath(oldPath)) {
            return;
          }
          const normalizedOldPath = this.normalizeVaultPath(oldPath);
          const normalizedNewPath = this.normalizeVaultPath(file?.path);
          if (normalizedOldPath && this.normalizeVaultPath(this.activeMarkdownPath) === normalizedOldPath) {
            this.activeMarkdownPath = normalizedNewPath;
            this.activeFocusOrdinal = ++this.focusOrdinal;
          }
          if (this.pendingCreatedFocusPath && this.normalizeVaultPath(this.pendingCreatedFocusPath) === normalizedOldPath) {
            this.pendingCreatedFocusPath = normalizedNewPath;
          }
          if (this.isGraphRelevantPath(oldPath)) {
            this.noteSignatureByPath.delete(normalizedOldPath);
          }
          this.scheduleGraphRefresh();
        })
      );
    }
  }
  markSemanticRefreshPending() {
    if (!this.refreshActive) {
      return;
    }
    this.semanticRefreshPending = true;
    this.clearResolveBarrierFallbackTimer();
    this.resolveBarrierFallbackTimer = setTimeout(() => {
      this.resolveBarrierFallbackTimer = null;
      if (!this.semanticRefreshPending) {
        return;
      }
      this.semanticRefreshPending = false;
      this.scheduleGraphRefresh();
    }, GRAPH_RESOLVE_BARRIER_FALLBACK_MS);
  }
  scheduleGraphRefresh() {
    if (!this.refreshActive) {
      return;
    }
    this.clearRefreshTimer();
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshGraphNow();
    }, GRAPH_REFRESH_DEBOUNCE_MS);
  }
  refreshGraphNow() {
    this.sourceGraphPayload = this.buildGraph(this.app);
    this.folderPathSuggestions = this.buildFolderPathSuggestions(this.sourceGraphPayload);
    this.tagSuggestions = this.buildTagSuggestions(this.sourceGraphPayload);
    this.emitGraphFromSource();
  }
  scheduleFilterRefresh() {
    if (!this.refreshActive) {
      return;
    }
    this.clearFilterInputDebounceTimer();
    this.filterInputDebounceTimer = setTimeout(() => {
      this.filterInputDebounceTimer = null;
      this.emitGraphFromSource();
    }, FILTER_INPUT_DEBOUNCE_MS);
  }
  emitGraphFromSource() {
    if (!this.sourceGraphPayload) {
      return;
    }
    const outgoingPayload = this.applyActiveFilters(this.sourceGraphPayload);
    this.lastGraphPayload = outgoingPayload;
    if (!this.bridgeReady) {
      this.pendingGraphPayload = outgoingPayload;
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(outgoingPayload);
      return;
    }
    this.pendingGraphPayload = null;
    this.bridge.sendGraphSet(outgoingPayload);
    this.dispatchPreferredFocus(outgoingPayload);
    this.refreshFilterSuggestions();
  }
  applyActiveFilters(payload) {
    const pathFiltered = GraphPathFilter.applyPathFilter(payload, this.activePathFilter);
    const tagsFiltered = this.applyTagsVisibilityFilter(pathFiltered);
    return {
      ...tagsFiltered,
      enginePreference: this.enginePreference
    };
  }
  applyTagsVisibilityFilter(payload) {
    if (this.showTags) {
      return payload;
    }
    return {
      ...payload,
      notes: payload.notes.map((note) => ({
        ...note,
        tags: []
      }))
    };
  }
  flushOrRefreshGraph() {
    if (this.pendingGraphPayload) {
      const payload = this.pendingGraphPayload;
      this.pendingGraphPayload = null;
      this.lastGraphPayload = payload;
      this.bridge.sendGraphSet(payload);
      if (this.pendingFocusPayload) {
        this.bridge.sendNoteFocus(this.pendingFocusPayload);
        this.lastDispatchedFocusKey = this.toFocusKey(this.pendingFocusPayload);
        this.pendingFocusPayload = null;
      } else {
        this.dispatchPreferredFocus(payload);
      }
      return;
    }
    if (this.sourceGraphPayload) {
      this.emitGraphFromSource();
      return;
    }
    this.refreshGraphNow();
  }
  clearRefreshTimer() {
    if (!this.refreshTimer) {
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
  clearResolveBarrierFallbackTimer() {
    if (!this.resolveBarrierFallbackTimer) {
      return;
    }
    clearTimeout(this.resolveBarrierFallbackTimer);
    this.resolveBarrierFallbackTimer = null;
  }
  clearFilterInputDebounceTimer() {
    if (!this.filterInputDebounceTimer) {
      return;
    }
    clearTimeout(this.filterInputDebounceTimer);
    this.filterInputDebounceTimer = null;
  }
  clearFilterSuggestionsHideTimer() {
    if (!this.filterSuggestionsHideTimer) {
      return;
    }
    clearTimeout(this.filterSuggestionsHideTimer);
    this.filterSuggestionsHideTimer = null;
  }
  renderViewLayout(container) {
    const root = createChild(container, "div");
    root.className = "reverysky-map-root";
    const iframeHost = createChild(root, "div");
    iframeHost.className = "reverysky-map-iframe-host";
    const overlayControls = createChild(root, "div");
    overlayControls.className = "reverysky-map-overlay-controls";
    const settingsToggleButton = createChild(overlayControls, "button");
    settingsToggleButton.type = "button";
    settingsToggleButton.className = "reverysky-map-filter-toggle";
    this.filterToggleButtonEl = settingsToggleButton;
    settingsToggleButton.setAttribute("aria-label", "Open filters");
    (0, import_obsidian.setIcon)(settingsToggleButton, "settings");
    const toggleFilterPanel = () => {
      const nextOpen = !this.filterPanelOpen;
      this.setFilterPanelOpen(nextOpen);
      if (nextOpen) {
        this.syncSearchComponentValue();
        this.refreshFilterMessage();
      }
    };
    settingsToggleButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleFilterPanel();
    });
    settingsToggleButton.addEventListener("click", (event) => {
      const mouseEvent = event;
      if (mouseEvent.detail !== 0) {
        return;
      }
      event.preventDefault();
      toggleFilterPanel();
    });
    const filterContainer = createChild(root, "div");
    filterContainer.className = "reverysky-map-filter-panel";
    this.filterPanelEl = filterContainer;
    const filterSection = createChild(filterContainer, "div");
    filterSection.className = "reverysky-map-filter-section";
    const filterSectionHeader = createChild(filterSection, "div");
    filterSectionHeader.className = "reverysky-map-filter-header";
    const filterSectionTitle = createChild(filterSectionHeader, "div");
    filterSectionTitle.className = "reverysky-map-filter-title";
    filterSectionTitle.textContent = "Settings";
    const panelCloseButton = createChild(filterSectionHeader, "button");
    panelCloseButton.type = "button";
    panelCloseButton.className = "reverysky-map-filter-close";
    panelCloseButton.setAttribute("aria-label", "Close filters");
    (0, import_obsidian.setIcon)(panelCloseButton, "x");
    const closeFilterPanel = (event) => {
      event?.preventDefault();
      this.setFilterPanelOpen(false);
    };
    panelCloseButton.addEventListener("mousedown", (event) => {
      closeFilterPanel(event);
    });
    panelCloseButton.addEventListener("click", (event) => {
      closeFilterPanel(event);
    });
    const filterSearchArea = createChild(filterSection, "div");
    filterSearchArea.className = "reverysky-map-filter-search-area";
    const filterSearchLabel = createChild(filterSearchArea, "div");
    filterSearchLabel.className = "reverysky-map-filter-field-label";
    filterSearchLabel.textContent = "Filter";
    const searchHost = createChild(filterSearchArea, "div");
    this.searchComponent = new import_obsidian.SearchComponent(searchHost);
    this.searchComponent.setPlaceholder("Search in...");
    this.searchComponent.onChange((value) => {
      this.onPathFilterInputChanged(value);
    });
    this.searchComponent.inputEl.setAttribute("aria-label", "Search in filter");
    this.searchComponent.inputEl.addEventListener("focus", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.searchComponent.inputEl.addEventListener("click", () => {
      this.showFilterSuggestions(this.resolveAutoSuggestionMode());
    });
    this.searchComponent.inputEl.addEventListener("blur", () => {
      this.scheduleHideFilterSuggestions();
    });
    this.searchComponent.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (this.searchComponent) {
          this.searchComponent.setValue("");
        }
        this.onPathFilterInputChanged("");
        this.hideFilterSuggestions();
      }
    });
    this.filterSuggestionsEl = createChild(filterSearchArea, "div");
    this.filterSuggestionsEl.className = "reverysky-map-filter-suggestions";
    this.filterSuggestionsEl.style.display = "none";
    this.filterMessageEl = createChild(filterSection, "div");
    this.filterMessageEl.className = "reverysky-map-filter-message";
    const tagsToggleRow = createChild(filterSection, "div");
    tagsToggleRow.className = "reverysky-map-tags-toggle-row";
    const tagsLabel = createChild(tagsToggleRow, "div");
    tagsLabel.className = "reverysky-map-filter-field-label";
    tagsLabel.textContent = "Tags";
    const tagsToggleButton = createChild(tagsToggleRow, "button");
    tagsToggleButton.type = "button";
    tagsToggleButton.className = "reverysky-map-tags-toggle";
    tagsToggleButton.setAttribute("aria-label", "Toggle tags");
    this.tagsToggleButtonEl = tagsToggleButton;
    const tagsToggleThumb = createChild(tagsToggleButton, "span");
    tagsToggleThumb.className = "reverysky-map-tags-toggle-thumb";
    const toggleTags = (event) => {
      event.preventDefault();
      this.setShowTags(!this.showTags, { emit: true });
    };
    tagsToggleButton.addEventListener("mousedown", toggleTags);
    tagsToggleButton.addEventListener("click", (event) => {
      const mouseEvent = event;
      if (mouseEvent.detail !== 0) {
        return;
      }
      toggleTags(event);
    });
    this.refreshTagsToggleUi();
    const engineSection = createChild(filterContainer, "div");
    engineSection.className = "reverysky-map-filter-section reverysky-map-filter-control-group";
    const engineSectionTitle = createChild(engineSection, "div");
    engineSectionTitle.className = "reverysky-map-filter-field-label";
    engineSectionTitle.textContent = "Engine";
    const engineSelectHost = createChild(engineSection, "div");
    engineSelectHost.className = "reverysky-map-engine-select-host";
    const engineDropdown = createChild(engineSelectHost, "select");
    this.engineDropdownEl = engineDropdown;
    for (const option of ENGINE_PREFERENCE_OPTIONS) {
      const optionEl = createChild(engineDropdown, "option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
    }
    engineDropdown.classList.add("reverysky-map-engine-select");
    engineDropdown.setAttribute("aria-label", "Select engine");
    engineDropdown.addEventListener("change", () => {
      this.setEnginePreference(this.normalizeEnginePreference(engineDropdown.value), { emit: true });
    });
    this.refreshEngineDropdownUi();
    this.setFilterPanelOpen(false);
    return iframeHost;
  }
  setFilterPanelOpen(isOpen) {
    this.filterPanelOpen = isOpen;
    if (!this.filterPanelEl || !this.filterToggleButtonEl) {
      return;
    }
    this.filterPanelEl.style.display = isOpen ? "grid" : "none";
    this.filterPanelEl.style.pointerEvents = isOpen ? "auto" : "none";
    this.filterToggleButtonEl.style.display = isOpen ? "none" : "inline-flex";
    this.filterToggleButtonEl.style.pointerEvents = isOpen ? "none" : "auto";
    if (!isOpen) {
      this.hideFilterSuggestions();
    }
  }
  onPathFilterInputChanged(nextQuery) {
    this.pathFilterQuery = typeof nextQuery === "string" ? nextQuery : "";
    const parseResult = GraphPathFilter.parsePathQuery(this.pathFilterQuery);
    this.applyParsedFilterResult(parseResult);
    this.refreshFilterMessage();
    this.refreshFilterSuggestions();
    if (!parseResult.isValid) {
      return;
    }
    this.scheduleFilterRefresh();
  }
  showFilterSuggestions(mode) {
    if (!this.filterSuggestionsEl || !this.searchComponent) {
      return;
    }
    this.filterSuggestionMode = mode;
    this.setFilterPanelOpen(true);
    this.refreshFilterSuggestions();
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsEl.style.display = "block";
  }
  resolveAutoSuggestionMode() {
    const currentQuery = this.searchComponent?.inputEl?.value ?? this.searchComponent?.getValue() ?? this.pathFilterQuery;
    if (/\s$/.test(currentQuery)) {
      return 0;
    }
    if (/(^|\s)-?path:(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 1;
    }
    if (/(^|\s)-?date:[^\s]*$/i.test(currentQuery)) {
      return 2;
    }
    if (/(^|\s)-?tag:(?:"[^"]*"|[^\s]*)$/i.test(currentQuery)) {
      return 3;
    }
    return 0;
  }
  scheduleHideFilterSuggestions() {
    this.clearFilterSuggestionsHideTimer();
    this.filterSuggestionsHideTimer = setTimeout(() => {
      this.filterSuggestionsHideTimer = null;
      this.hideFilterSuggestions();
    }, FILTER_SUGGESTIONS_HIDE_DELAY_MS);
  }
  hideFilterSuggestions() {
    if (!this.filterSuggestionsEl) {
      return;
    }
    this.filterSuggestionMode = 0;
    this.filterSuggestionsEl.style.display = "none";
  }
  applyPathSuggestionOperator() {
    if (!this.searchComponent) {
      return;
    }
    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsPathOperator = /(^|\s)-?path:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsPathOperator ? currentValue : trimmedCurrent.length === 0 ? "path:" : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}path:`;
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(1);
  }
  applyDateSuggestionOperator() {
    if (!this.searchComponent) {
      return;
    }
    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const alreadyContainsDateOperator = /(^|\s)-?date:/i.test(trimmedCurrent);
    const nextValue = alreadyContainsDateOperator ? currentValue : trimmedCurrent.length === 0 ? "date:" : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}date:`;
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(2);
  }
  applyTagSuggestionOperator() {
    if (!this.searchComponent) {
      return;
    }
    const currentValue = this.searchComponent.getValue();
    const trimmedCurrent = currentValue.trim();
    const hasActiveTrailingTagOperator = /(^|\s)-?tag:(?:"[^"]*"|[^\s]*)$/i.test(currentValue);
    const nextValue = hasActiveTrailingTagOperator ? currentValue : trimmedCurrent.length === 0 ? "tag:" : `${currentValue}${/\s$/.test(currentValue) ? "" : " "}tag:`;
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.showFilterSuggestions(3);
  }
  applyDateValueSuggestion(suffix) {
    if (!this.searchComponent) {
      return;
    }
    const currentValue = this.searchComponent.getValue();
    const replaceActiveDateTermPattern = /(^|\s)(-?date:)[^\s]*$/i;
    let nextValue;
    if (replaceActiveDateTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActiveDateTermPattern,
        (_match, prefix, operator) => `${prefix}${operator}${suffix}`
      );
    } else if (/(^|\s)-?date:/i.test(currentValue)) {
      nextValue = `${currentValue}${/\s$/.test(currentValue) ? "" : " "}date:${suffix}`;
    } else {
      nextValue = `date:${suffix}`;
    }
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }
  applyPathValueSuggestion(folderPath) {
    if (!this.searchComponent) {
      return;
    }
    const term = this.formatPathFilterTerm(folderPath);
    const currentValue = this.searchComponent.getValue();
    const replaceActivePathTermPattern = /(^|\s)(-?path:)(?:"[^"]*"|[^\s]*)$/i;
    let nextValue;
    if (replaceActivePathTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActivePathTermPattern,
        (_match, prefix, operator) => `${prefix}${operator}${term}`
      );
    } else if (/(^|\s)-?path:/i.test(currentValue)) {
      nextValue = `${currentValue}${/\s$/.test(currentValue) ? "" : " "}path:${term}`;
    } else {
      nextValue = `path:${term}`;
    }
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }
  applyTagValueSuggestion(tag) {
    if (!this.searchComponent) {
      return;
    }
    const currentValue = this.searchComponent.getValue();
    const term = this.formatTagFilterTerm(tag);
    const replaceActiveTagTermPattern = /(^|\s)(-?tag:)(?:"[^"]*"|[^\s]*)$/i;
    let nextValue;
    if (replaceActiveTagTermPattern.test(currentValue)) {
      nextValue = currentValue.replace(
        replaceActiveTagTermPattern,
        (_match, prefix, operator) => `${prefix}${operator}${term}`
      );
    } else {
      nextValue = `${currentValue}${/\s$/.test(currentValue) || currentValue.length === 0 ? "" : " "}tag:${term}`;
    }
    this.searchComponent.setValue(nextValue);
    this.onPathFilterInputChanged(nextValue);
    this.hideFilterSuggestions();
  }
  refreshFilterSuggestions() {
    if (!this.filterSuggestionsEl) {
      return;
    }
    this.filterSuggestionsEl.replaceChildren();
    if (this.filterSuggestionMode === 1) {
      const currentQuery = this.searchComponent?.getValue() ?? this.pathFilterQuery;
      this.renderFolderSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    if (this.filterSuggestionMode === 2) {
      this.renderDateSuggestions(this.filterSuggestionsEl);
      return;
    }
    if (this.filterSuggestionMode === 3) {
      const currentQuery = this.searchComponent?.getValue() ?? this.pathFilterQuery;
      this.renderTagSuggestions(this.filterSuggestionsEl, currentQuery);
      return;
    }
    this.renderOperatorSuggestions(this.filterSuggestionsEl);
  }
  renderOperatorSuggestions(host) {
    const suggestionsTitle = createChild(host, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Search settings";
    const pathOption = createChild(host, "div");
    pathOption.className = "reverysky-map-filter-suggestion-option";
    pathOption.setAttribute("role", "button");
    const strong = createChild(pathOption, "span");
    strong.className = "reverysky-map-suggestion-key";
    strong.textContent = "path:";
    const desc = createChild(pathOption, "span");
    desc.className = "reverysky-map-suggestion-desc";
    desc.textContent = " match in file path";
    pathOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyPathSuggestionOperator();
    });
    const dateOption = createChild(host, "div");
    dateOption.className = "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked";
    dateOption.setAttribute("role", "button");
    const dateStrong = createChild(dateOption, "span");
    dateStrong.className = "reverysky-map-suggestion-key";
    dateStrong.textContent = "date:";
    const dateDesc = createChild(dateOption, "span");
    dateDesc.className = "reverysky-map-suggestion-desc";
    dateDesc.textContent = " match note date";
    dateOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyDateSuggestionOperator();
    });
    const tagOption = createChild(host, "div");
    tagOption.className = "reverysky-map-filter-suggestion-option reverysky-map-filter-suggestion-option--stacked";
    tagOption.setAttribute("role", "button");
    const tagStrong = createChild(tagOption, "span");
    tagStrong.className = "reverysky-map-suggestion-key";
    tagStrong.textContent = "tag:";
    const tagDesc = createChild(tagOption, "span");
    tagDesc.className = "reverysky-map-suggestion-desc";
    tagDesc.textContent = " match note tag";
    tagOption.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.applyTagSuggestionOperator();
    });
  }
  renderDateSuggestions(host) {
    const suggestionsTitle = createChild(host, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Date presets";
    const presets = this.buildDateFilterPresetSuggestions();
    for (const suggestion of presets) {
      const option = createChild(host, "div");
      option.className = "reverysky-map-date-suggestion-option";
      option.setAttribute("role", "button");
      const valuePart = createChild(option, "span");
      valuePart.className = "reverysky-map-date-suggestion-value";
      valuePart.textContent = `date:${suggestion.suffix}`;
      const labelPart = createChild(option, "span");
      labelPart.className = "reverysky-map-date-suggestion-label";
      labelPart.textContent = `  ${suggestion.label}`;
      option.title = suggestion.description;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyDateValueSuggestion(suggestion.suffix);
      });
    }
  }
  renderFolderSuggestions(host, query) {
    this.ensureFolderSuggestionsReady();
    const suggestionsTitle = createChild(host, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Folders";
    const activePathValue = this.extractActivePathFilterTermValue(query);
    const normalizedActive = this.normalizeSearchTerm(activePathValue);
    const ranked = this.folderPathSuggestions.filter((item) => {
      if (!normalizedActive) {
        return true;
      }
      return item.normalizedPath.includes(normalizedActive);
    }).sort((a, b) => {
      if (normalizedActive) {
        const aStarts = a.normalizedPath.startsWith(normalizedActive) ? 1 : 0;
        const bStarts = b.normalizedPath.startsWith(normalizedActive) ? 1 : 0;
        if (aStarts !== bStarts) {
          return bStarts - aStarts;
        }
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.path.localeCompare(b.path, "en", { sensitivity: "base" });
    }).slice(0, MAX_FOLDER_SUGGESTIONS);
    if (!ranked.length) {
      const emptyHint = createChild(host, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No folders found";
      return;
    }
    for (const suggestion of ranked) {
      const option = createChild(host, "div");
      option.className = "reverysky-map-folder-suggestion-option";
      option.setAttribute("role", "button");
      option.textContent = suggestion.path;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyPathValueSuggestion(suggestion.path);
      });
    }
  }
  renderTagSuggestions(host, query) {
    this.ensureTagSuggestionsReady();
    const suggestionsTitle = createChild(host, "div");
    suggestionsTitle.className = "reverysky-map-suggestion-title";
    suggestionsTitle.textContent = "Tags";
    const activeTagValue = this.extractActiveTagFilterTermValue(query);
    const normalizedActive = this.normalizeTagSuggestionSearchTerm(activeTagValue);
    const ranked = this.tagSuggestions.filter((item) => !normalizedActive || item.normalizedTag.includes(normalizedActive)).sort((a, b) => {
      if (normalizedActive) {
        const aStarts = a.normalizedTag.startsWith(normalizedActive) ? 1 : 0;
        const bStarts = b.normalizedTag.startsWith(normalizedActive) ? 1 : 0;
        if (aStarts !== bStarts) {
          return bStarts - aStarts;
        }
      }
      return a.displayTag.localeCompare(b.displayTag, void 0, { sensitivity: "base" });
    }).slice(0, MAX_TAG_SUGGESTIONS);
    if (!ranked.length) {
      const emptyHint = createChild(host, "div");
      emptyHint.className = "reverysky-map-suggestion-empty";
      emptyHint.textContent = "No tags found";
      return;
    }
    for (const suggestion of ranked) {
      const option = createChild(host, "div");
      option.className = "reverysky-map-folder-suggestion-option reverysky-map-tag-suggestion-option";
      option.setAttribute("role", "button");
      option.textContent = suggestion.displayTag;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyTagValueSuggestion(suggestion.tag);
      });
    }
  }
  buildDateFilterPresetSuggestions() {
    const today = this.utcDayFromNowOffset({ days: 0 });
    const weekAgo = this.utcDayFromNowOffset({ days: -7 });
    const monthAgo = this.utcDayFromNowOffset({ months: -1 });
    const yearAgo = this.utcDayFromNowOffset({ years: -1 });
    return [
      {
        label: "= today",
        suffix: today,
        description: "Matches notes dated today."
      },
      {
        label: ">= one week ago",
        suffix: `>=${weekAgo}`,
        description: "Matches notes on or newer than one week ago."
      },
      {
        label: ">= one month ago",
        suffix: `>=${monthAgo}`,
        description: "Matches notes on or newer than one month ago."
      },
      {
        label: ">= one year ago",
        suffix: `>=${yearAgo}`,
        description: "Matches notes on or newer than one year ago."
      }
    ];
  }
  utcDayFromNowOffset(offset) {
    const base = new Date(this.now());
    const baseYear = base.getUTCFullYear();
    const baseMonth = base.getUTCMonth();
    const baseDay = base.getUTCDate();
    const yearShift = offset.years ?? 0;
    const monthShift = offset.months ?? 0;
    const dayShift = offset.days ?? 0;
    const shifted = this.createClampedUtcDate(baseYear, baseMonth, baseDay, yearShift, monthShift);
    if (dayShift !== 0) {
      shifted.setUTCDate(shifted.getUTCDate() + dayShift);
    }
    return shifted.toISOString().slice(0, 10);
  }
  createClampedUtcDate(baseYear, baseMonth, baseDay, yearShift, monthShift) {
    const monthShiftedStart = new Date(Date.UTC(baseYear + yearShift, baseMonth + monthShift, 1));
    const targetYear = monthShiftedStart.getUTCFullYear();
    const targetMonth = monthShiftedStart.getUTCMonth();
    const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const clampedDay = Math.min(baseDay, daysInTargetMonth);
    return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  }
  ensureFolderSuggestionsReady() {
    if (this.folderPathSuggestions.length > 0) {
      return;
    }
    if (!this.sourceGraphPayload) {
      this.sourceGraphPayload = this.buildGraph(this.app);
    }
    if (!this.sourceGraphPayload) {
      return;
    }
    this.folderPathSuggestions = this.buildFolderPathSuggestions(this.sourceGraphPayload);
  }
  ensureTagSuggestionsReady() {
    if (this.tagSuggestions.length > 0) {
      return;
    }
    if (!this.sourceGraphPayload) {
      this.sourceGraphPayload = this.buildGraph(this.app);
    }
    if (!this.sourceGraphPayload) {
      return;
    }
    this.tagSuggestions = this.buildTagSuggestions(this.sourceGraphPayload);
  }
  buildFolderPathSuggestions(payload) {
    const counts = /* @__PURE__ */ new Map();
    for (const note of payload.notes) {
      const normalizedPath = this.normalizeVaultPath(note.path);
      const folderPrefixes = this.extractFolderPrefixes(normalizedPath);
      for (const prefix of folderPrefixes) {
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
    }
    const suggestions = [];
    for (const [folderPath, count] of counts.entries()) {
      const normalizedFolder = this.normalizeSearchTerm(folderPath);
      suggestions.push({
        path: folderPath,
        normalizedPath: normalizedFolder,
        count,
        depth: folderPath.split("/").length
      });
    }
    return suggestions.sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      return a.path.localeCompare(b.path, "en", { sensitivity: "base" });
    });
  }
  buildTagSuggestions(payload) {
    const uniqueTags = /* @__PURE__ */ new Map();
    for (const note of payload.notes) {
      for (const tag of note.tags) {
        const normalizedTag = this.normalizeTagSuggestionSearchTerm(tag);
        if (!normalizedTag || uniqueTags.has(normalizedTag)) {
          continue;
        }
        uniqueTags.set(normalizedTag, tag.trim().replace(/^#/, ""));
      }
    }
    return Array.from(uniqueTags.entries()).map(([normalizedTag, tag]) => ({
      tag,
      normalizedTag,
      displayTag: `#${tag}`
    })).sort((a, b) => a.displayTag.localeCompare(b.displayTag, void 0, { sensitivity: "base" }));
  }
  extractFolderPrefixes(normalizedNotePath) {
    const slashIndex = normalizedNotePath.lastIndexOf("/");
    if (slashIndex < 1) {
      return [];
    }
    const folderPath = normalizedNotePath.slice(0, slashIndex);
    const parts = folderPath.split("/").filter((part) => part.length > 0);
    const prefixes = [];
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      prefixes.push(current);
    }
    return prefixes;
  }
  extractActivePathFilterTermValue(query) {
    const activePattern = /(^|\s)-?path:(?:"([^"]*)"|([^\s]*))$/i;
    const match = query.match(activePattern);
    if (!match) {
      return "";
    }
    const quotedValue = typeof match[2] === "string" ? match[2] : "";
    const plainValue = typeof match[3] === "string" ? match[3] : "";
    const rawValue = quotedValue || plainValue;
    return rawValue.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  extractActiveTagFilterTermValue(query) {
    const activePattern = /(^|\s)-?tag:(?:"([^"]*)"|([^\s]*))$/i;
    const match = query.match(activePattern);
    if (!match) {
      return "";
    }
    const quotedValue = typeof match[2] === "string" ? match[2] : "";
    const plainValue = typeof match[3] === "string" ? match[3] : "";
    const rawValue = quotedValue || plainValue;
    return rawValue.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  formatPathFilterTerm(folderPath) {
    const needsQuotes = /\s/.test(folderPath) || /["]/.test(folderPath);
    const escaped = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return needsQuotes ? `"${escaped}"` : escaped;
  }
  formatTagFilterTerm(tag) {
    return `#${tag.trim().replace(/^#/, "")}`;
  }
  normalizeSearchTerm(value) {
    return value.trim().replace(/\\/g, "/").toLowerCase();
  }
  normalizeTagSuggestionSearchTerm(value) {
    return value.trim().replace(/^#/, "").toLowerCase();
  }
  applyParsedFilterResult(parseResult) {
    this.pathFilterParseValid = parseResult.isValid;
    if (!parseResult.isValid) {
      this.pathFilterMessage = "";
      return;
    }
    this.pathFilterMessage = parseResult.hasUnsupportedTokens ? "Only path:, date:, and tag: terms are applied in this view." : "";
    this.activePathFilter = parseResult.hasPathTerms ? parseResult.parsed : null;
  }
  syncSearchComponentValue() {
    if (!this.searchComponent) {
      return;
    }
    if (this.searchComponent.getValue() === this.pathFilterQuery) {
      return;
    }
    this.searchComponent.setValue(this.pathFilterQuery);
  }
  refreshFilterMessage() {
    if (!this.filterMessageEl) {
      return;
    }
    const hasCustomMessage = this.pathFilterMessage.trim().length > 0;
    this.filterMessageEl.textContent = hasCustomMessage ? this.pathFilterMessage : "";
    this.filterMessageEl.style.display = hasCustomMessage ? "block" : "none";
    this.filterMessageEl.style.color = this.pathFilterParseValid ? "var(--text-muted)" : "var(--text-error)";
  }
  setShowTags(showTags, options) {
    this.showTags = showTags;
    this.refreshTagsToggleUi();
    if (!options.emit) {
      return;
    }
    this.emitGraphFromSource();
  }
  setEnginePreference(enginePreference, options) {
    this.enginePreference = enginePreference;
    this.refreshEngineDropdownUi();
    if (!options.emit) {
      return;
    }
    this.emitGraphFromSource();
  }
  refreshTagsToggleUi() {
    if (!this.tagsToggleButtonEl) {
      return;
    }
    this.tagsToggleButtonEl.setAttribute("role", "switch");
    this.tagsToggleButtonEl.setAttribute("aria-checked", this.showTags ? "true" : "false");
  }
  refreshEngineDropdownUi() {
    if (!this.engineDropdownEl) {
      return;
    }
    if (this.engineDropdownEl.value === this.enginePreference) {
      return;
    }
    this.engineDropdownEl.value = this.enginePreference;
  }
  normalizeEnginePreference(value) {
    return value === "forces" || value === "static25d" || value === "auto" ? value : DEFAULT_ENGINE_PREFERENCE;
  }
  dispatchPreferredFocus(payload) {
    if (!this.bridgeReady) {
      this.pendingFocusPayload = this.resolvePreferredFocusPayload(payload);
      return;
    }
    const focusPayload = this.resolvePreferredFocusPayload(payload);
    if (!focusPayload) {
      return;
    }
    const focusKey = this.toFocusKey(focusPayload);
    if (focusKey && focusKey === this.lastDispatchedFocusKey) {
      return;
    }
    this.bridge.sendNoteFocus(focusPayload);
    this.lastDispatchedFocusKey = focusKey;
  }
  resolvePreferredFocusPayload(payload) {
    const preferredPath = this.getPreferredFocusPath();
    if (!preferredPath) {
      return null;
    }
    const normalizedPreferredPath = this.normalizeVaultPath(preferredPath);
    const byPath = payload.notes.find((note) => this.normalizeVaultPath(note.path) === normalizedPreferredPath) ?? null;
    if (this.pendingCreatedFocusPath) {
      const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);
      const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
      if (!activePath || this.activeFocusOrdinal >= this.pendingCreatedFocusOrdinal || activePath === createdPath) {
        this.pendingCreatedFocusPath = null;
        this.pendingCreatedFocusOrdinal = 0;
      }
    }
    if (!byPath) {
      return null;
    }
    return {
      id: byPath.id,
      path: byPath.path
    };
  }
  getPreferredFocusPath() {
    const activePath = this.normalizeVaultPath(this.activeMarkdownPath);
    const createdPath = this.normalizeVaultPath(this.pendingCreatedFocusPath);
    if (activePath && (!createdPath || this.activeFocusOrdinal >= this.pendingCreatedFocusOrdinal)) {
      return activePath;
    }
    if (createdPath) {
      return createdPath;
    }
    return activePath;
  }
  toFocusKey(payload) {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";
    const path3 = typeof payload.path === "string" ? this.normalizeVaultPath(payload.path) : "";
    return `${id}|${path3}`;
  }
  buildGraphRelevantSignature(cache) {
    const inlineTags = (cache?.tags ?? []).map((tagEntry) => typeof tagEntry?.tag === "string" ? tagEntry.tag : "").filter((tag) => tag.length > 0);
    const frontmatterTags = this.extractFrontmatterTags(cache?.frontmatter);
    const tags = Array.from(
      new Set(
        [...inlineTags, ...frontmatterTags].map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter((tag) => tag.length > 0)
      )
    ).sort();
    const links = Array.from(
      new Set(
        (cache?.links ?? []).map((link) => this.normalizeLinkValue(link.link)).filter((link) => link.length > 0)
      )
    ).sort();
    return JSON.stringify({
      tags,
      links
    });
  }
  normalizeLinkValue(linkValue) {
    if (typeof linkValue !== "string") {
      return "";
    }
    return linkValue.trim().replace(/\\/g, "/").toLowerCase();
  }
  normalizeVaultPath(pathValue) {
    if (typeof pathValue !== "string") {
      return "";
    }
    return pathValue.trim().replace(/\\/g, "/");
  }
  extractFrontmatterTags(frontmatter) {
    if (!frontmatter || typeof frontmatter !== "object") {
      return [];
    }
    const tagsRaw = frontmatter.tags;
    if (typeof tagsRaw === "string") {
      return [tagsRaw];
    }
    if (Array.isArray(tagsRaw)) {
      return tagsRaw.filter((tag) => typeof tag === "string");
    }
    return [];
  }
  isGraphRelevantPath(pathValue) {
    if (typeof pathValue !== "string") {
      return false;
    }
    return pathValue.toLowerCase().endsWith(".md");
  }
  async openRequestedNote(payload) {
    const resolvedPath = this.resolveRequestedPath(payload);
    if (!resolvedPath) {
      this.notify("Unable to open note: bridge payload did not include a valid note id or path.");
      return;
    }
    const noteFile = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!noteFile || typeof noteFile.path !== "string") {
      this.notify(`Unable to open note: file not found for path '${resolvedPath}'.`);
      return;
    }
    const targetLeaf = this.resolveTargetNoteLeaf();
    const sourcePath = targetLeaf ? this.getLeafSourcePath(targetLeaf) : "";
    try {
      await this.app.workspace.openLinkText(
        noteFile.path,
        sourcePath,
        false,
        targetLeaf ? {
          active: true,
          group: targetLeaf
        } : {
          active: true
        }
      );
    } catch (error) {
      this.notify(`Unable to open note: ${String(error)}`);
    }
  }
  resolveRequestedPath(payload) {
    const requestedId = typeof payload.id === "string" ? payload.id.trim() : "";
    const requestedPath = typeof payload.path === "string" ? payload.path.trim() : "";
    if (requestedId && this.lastGraphPayload) {
      const byId = this.lastGraphPayload.notes.find((note) => note.id === requestedId);
      if (byId?.path?.trim()) {
        return byId.path.replace(/\\/g, "/");
      }
    }
    if (requestedPath) {
      return requestedPath.replace(/\\/g, "/");
    }
    return null;
  }
  ensureLeafTracking() {
    if (this.leafTrackingRegistered) {
      return;
    }
    this.leafTrackingRegistered = true;
    const workspace = this.app.workspace;
    if (!workspace) {
      return;
    }
    const currentActiveLeaf = workspace.activeLeaf ?? null;
    if (this.isMarkdownLeaf(currentActiveLeaf)) {
      this.lastMarkdownLeaf = currentActiveLeaf;
      this.activeMarkdownPath = this.getLeafSourcePath(currentActiveLeaf);
    } else {
      this.lastMarkdownLeaf = this.findAnyMarkdownLeaf();
      this.activeMarkdownPath = this.getLeafSourcePath(this.lastMarkdownLeaf);
    }
    this.registerEvent(
      workspace.on("active-leaf-change", (leaf) => {
        if (this.isMarkdownLeaf(leaf)) {
          this.lastMarkdownLeaf = leaf;
          this.activeFocusOrdinal = ++this.focusOrdinal;
          this.activeMarkdownPath = this.getLeafSourcePath(leaf);
          if (this.lastGraphPayload) {
            this.dispatchPreferredFocus(this.lastGraphPayload);
          }
        }
      })
    );
  }
  resolveTargetNoteLeaf() {
    const workspace = this.app.workspace;
    if (!workspace) {
      return null;
    }
    const activeLeaf = workspace.activeLeaf ?? null;
    if (this.isMarkdownLeaf(activeLeaf)) {
      return activeLeaf;
    }
    if (this.isMarkdownLeaf(this.lastMarkdownLeaf)) {
      return this.lastMarkdownLeaf;
    }
    const anyMarkdownLeaf = this.findAnyMarkdownLeaf();
    if (this.isMarkdownLeaf(anyMarkdownLeaf)) {
      this.lastMarkdownLeaf = anyMarkdownLeaf;
      return anyMarkdownLeaf;
    }
    return null;
  }
  isMarkdownLeaf(leaf) {
    if (!leaf) {
      return false;
    }
    const viewType = leaf.view?.getViewType?.();
    if (viewType === "markdown") {
      return true;
    }
    const stateType = leaf.getViewState?.().type;
    return stateType === "markdown";
  }
  getLeafSourcePath(leaf) {
    const view = leaf?.view ?? null;
    const path3 = view?.file?.path;
    return typeof path3 === "string" ? path3 : "";
  }
  findAnyMarkdownLeaf() {
    const workspace = this.app.workspace;
    if (!workspace) {
      return null;
    }
    const markdownLeaf = workspace.getLeavesOfType("markdown")[0] ?? null;
    if (this.isMarkdownLeaf(markdownLeaf)) {
      return markdownLeaf;
    }
    let fallbackLeaf = null;
    workspace.iterateAllLeaves((leaf) => {
      if (!fallbackLeaf && this.isMarkdownLeaf(leaf)) {
        fallbackLeaf = leaf;
      }
    });
    return fallbackLeaf;
  }
};
function emptyElement(element) {
  if (typeof element.empty === "function") {
    element.empty();
    return;
  }
  element.replaceChildren();
}
function createChild(element, tagName) {
  if (typeof element.createEl === "function") {
    return element.createEl(tagName);
  }
  const child = document.createElement(tagName);
  element.appendChild(child);
  return child;
}

// src/runtime/UnityWebglLocalServer.ts
var import_node_http = require("node:http");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_path = __toESM(require("node:path"));
var CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".data": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm"
};
var UnityWebglLocalServer = class {
  constructor(rootDir) {
    this.server = null;
    this.baseUrl = null;
    this.startPromise = null;
    this.rootDirResolved = import_node_path.default.resolve(rootDir);
  }
  async getBaseUrl() {
    if (this.baseUrl) {
      return this.baseUrl;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startServer();
    try {
      this.baseUrl = await this.startPromise;
      return this.baseUrl;
    } finally {
      this.startPromise = null;
    }
  }
  async stop() {
    if (!this.server) {
      return;
    }
    const activeServer = this.server;
    this.server = null;
    this.baseUrl = null;
    await new Promise((resolve) => {
      activeServer.close(() => resolve());
    });
  }
  startServer() {
    return new Promise((resolve, reject) => {
      const server = (0, import_node_http.createServer)((req, res) => {
        void this.handleRequest(req, res);
      });
      server.once("error", (err) => {
        reject(err);
      });
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to resolve local server address."));
          return;
        }
        this.server = server;
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }
  async handleRequest(req, res) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end("Method not allowed");
        return;
      }
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const safePath = this.resolveRequestPath(requestUrl.pathname);
      if (!safePath) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }
      let filePath = safePath;
      let fileStat = await (0, import_promises.stat)(filePath);
      if (fileStat.isDirectory()) {
        filePath = import_node_path.default.join(filePath, "index.html");
        fileStat = await (0, import_promises.stat)(filePath);
      }
      res.statusCode = 200;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Length", String(fileStat.size));
      res.setHeader("Content-Type", CONTENT_TYPES[import_node_path.default.extname(filePath).toLowerCase()] ?? "application/octet-stream");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      (0, import_node_fs.createReadStream)(filePath).on("error", () => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end("Read error");
      }).pipe(res);
    } catch (error) {
      const code = error.code;
      res.statusCode = code === "ENOENT" ? 404 : 500;
      res.end(code === "ENOENT" ? "Not found" : "Server error");
    }
  }
  resolveRequestPath(pathnameRaw) {
    const pathname = pathnameRaw === "/" ? "/index.html" : pathnameRaw;
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\0")) {
      return null;
    }
    const relativePath = import_node_path.default.normalize(decoded).replace(/^[\\/]+/, "");
    const absolutePath = import_node_path.default.resolve(this.rootDirResolved, relativePath);
    const rootWithSep = this.rootDirResolved.endsWith(import_node_path.default.sep) ? this.rootDirResolved : `${this.rootDirResolved}${import_node_path.default.sep}`;
    if (absolutePath !== this.rootDirResolved && !absolutePath.startsWith(rootWithSep)) {
      return null;
    }
    return absolutePath;
  }
};

// src/main.ts
var import_node_path2 = __toESM(require("node:path"));
var ReverySkyMapPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.unityWebglServer = null;
  }
  async onload() {
    this.registerView(
      REVERYSKY_MAP_VIEW_TYPE,
      (leaf) => new ReverySkyMapView(leaf, this)
    );
    this.addRibbonIcon("sparkles", "Toggle ReverySky Map", async () => {
      await this.toggleMapView();
    });
    this.addCommand({
      id: "open-reverysky-map",
      name: "Open ReverySky Map",
      callback: async () => {
        await this.activateMapView();
      }
    });
  }
  async onunload() {
    this.app.workspace.detachLeavesOfType(REVERYSKY_MAP_VIEW_TYPE);
    if (this.unityWebglServer) {
      await this.unityWebglServer.stop();
      this.unityWebglServer = null;
    }
  }
  async getUnityRuntimeUrl() {
    if (!this.unityWebglServer) {
      const pluginDir = this.resolvePluginDirectory();
      this.unityWebglServer = new UnityWebglLocalServer(import_node_path2.default.join(pluginDir, "unity-webgl"));
    }
    const baseUrl = await this.unityWebglServer.getBaseUrl();
    return `${baseUrl}/index.html`;
  }
  async activateMapView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(REVERYSKY_MAP_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({
        type: REVERYSKY_MAP_VIEW_TYPE,
        active: true
      });
    }
    await workspace.revealLeaf(leaf);
  }
  async toggleMapView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(REVERYSKY_MAP_VIEW_TYPE);
    if (leaves.length > 0) {
      workspace.detachLeavesOfType(REVERYSKY_MAP_VIEW_TYPE);
      return;
    }
    await this.activateMapView();
  }
  resolvePluginDirectory() {
    const adapter = this.app.vault.adapter;
    if (!adapter.getBasePath) {
      throw new Error("File adapter base path is unavailable.");
    }
    return import_node_path2.default.join(adapter.getBasePath(), this.app.vault.configDir, "plugins", this.manifest.id);
  }
};
