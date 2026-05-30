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
var BRIDGE_PROTOCOL_VERSION = "1.0.0";

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
        if (!note.dates || typeof note.dates !== "object") errors.push(`payload.notes[${i}].dates must be an object`);
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
    const frontmatterId = typeof frontmatter?.id === "string" ? frontmatter.id.trim() : "";
    const tags = GraphNormalizer.normalizeTags([
      ..._VaultGraphBuilder.getInlineTags(cache),
      ..._VaultGraphBuilder.getFrontmatterTags(frontmatter?.tags)
    ]);
    const created = Number.isFinite(file.stat.ctime) ? new Date(file.stat.ctime).toISOString() : void 0;
    const modified = Number.isFinite(file.stat.mtime) ? new Date(file.stat.mtime).toISOString() : void 0;
    const noteDate = _VaultGraphBuilder.getFrontmatterDate(frontmatter?.date);
    return {
      id: frontmatterId || _VaultGraphBuilder.makeStableId(file.path),
      path: GraphNormalizer.normalizePath(file.path),
      title: file.basename,
      tags,
      dates: {
        ...created ? { created } : {},
        ...modified ? { modified } : {},
        ...noteDate ? { noteDate } : {}
      }
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
      return Number.isNaN(d.getTime()) ? trimmed : d.toISOString();
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
};

// src/view/ReverySkyMapView.ts
var REVERYSKY_MAP_VIEW_TYPE = "reverysky-map-view";
var ReverySkyMapView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin, deps = {}) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
    this.lastGraphPayload = null;
    this.lastMarkdownLeaf = null;
    this.leafTrackingRegistered = false;
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
  async onOpen() {
    this.ensureLeafTracking();
    const container = this.contentEl;
    emptyElement(container);
    let iframeSrc;
    try {
      iframeSrc = await this.plugin.getUnityRuntimeUrl();
    } catch (error) {
      this.notify(`Failed to start Unity runtime server: ${String(error)}`);
      return;
    }
    const iframe = createChild(container, "iframe");
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
          const payload = this.buildGraph(this.app);
          this.lastGraphPayload = payload;
          this.bridge.sendGraphSet(payload);
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
    this.bridge.detach();
    this.lastGraphPayload = null;
    emptyElement(this.contentEl);
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
    } else {
      this.lastMarkdownLeaf = this.findAnyMarkdownLeaf();
    }
    this.registerEvent(
      workspace.on("active-leaf-change", (leaf) => {
        if (this.isMarkdownLeaf(leaf)) {
          this.lastMarkdownLeaf = leaf;
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
    const view = leaf.view;
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
  resolvePluginDirectory() {
    const adapter = this.app.vault.adapter;
    if (!adapter.getBasePath) {
      throw new Error("File adapter base path is unavailable.");
    }
    return import_node_path2.default.join(adapter.getBasePath(), this.app.vault.configDir, "plugins", this.manifest.id);
  }
};
