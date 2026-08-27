# ReverySky 3D Graph for Obsidian - Architecture

## Purpose and Scope
ReverySky 3D Graph is an Obsidian desktop plugin that renders relationships between vault notes inside a Unity WebGL scene embedded in a custom Obsidian view.

Current in-scope behavior:
- open a dedicated graph view from an Obsidian command;
- build a graph from markdown files and resolved links;
- let the view narrow the effective graph with Ego scope and query/tag filters before sending it to Unity;
- persist graph view preferences across close and reopen;
- host the local WebGL runtime on `127.0.0.1`;
- show a packaged What's New note once after a meaningful `embedded-archive` update;
- round-trip note selection between Obsidian and the Unity runtime.

The primary workflow is one graph leaf opened by the plugin command. Duplicate graph leaves can exist through Obsidian workspace restore, popouts, or manual workspace manipulation; they should remain operable, but they are treated as a recovery case rather than the main interaction model.

## System Overview
The system has three runtime boundaries:
1. Obsidian plugin code in TypeScript.
2. A loopback HTTP host that serves the WebGL package.
3. Unity runtime code compiled into the WebGL build.

Main system parts:

- Obsidian plugin shell
  Registers the custom view, delegates command wiring to the command module, lazily creates the shared local WebGL server, and owns the latest plugin-level graph settings snapshot.
  Main code: `src/main.ts`
  Depends on: Obsidian `Plugin`, `WorkspaceLeaf`, `UnityWebglLocalServer`

- Graph view shell
  Creates the iframe, wires the bridge lifecycle, and delegates filter UI and note-open routing to focused collaborators.
  The Obsidian view sets `navigation = false` so note navigation cannot replace the persistent map leaf.
  Main code: `src/view/MapView.ts`
  Depends on: `MapSession`, `MapFilterPanelController`, `MapNoteOpenRouter`, `UnityIframeBridge`

- Graph session and filter UI
  Owns per-view live graph state, graph refresh timing, Obsidian metadata-resolution gating, Ego scope derivation, filter derivation, render-scale preference, and the transient filter-panel interaction state.
  Main code: `src/view/MapSession.ts`, `src/view/MapFilterPanelController.ts`
  Depends on: `VaultGraphBuilder`, `GraphQueryFilter`, Obsidian workspace APIs, browser DOM events

- Markdown editor focus adapter
  Translates markdown editor focus updates into the same graph-focus path used by active-file changes.
  Main code: `src/view/MarkdownEditorFocus.ts`
  Depends on: CodeMirror `ViewUpdate`, Obsidian `editorInfoField`

- Graph extraction and normalization
  Converts vault files and resolved links into a stable graph payload with normalized paths, tags, dates, byte sizes, and note ids.
  Main code: `src/graph/VaultGraphBuilder.ts`, `src/graph/GraphNormalizer.ts`
  Depends on: Obsidian `vault` and `metadataCache`

- Bridge transport and validation
  Defines the cross-runtime contract, validates payloads, and delivers `postMessage` envelopes to and from the iframe.
  Main code: `src/bridge/BridgeTypes.ts`, `src/bridge/MessageValidator.ts`, `src/bridge/UnityIframeBridge.ts`
  Depends on: browser `postMessage`, protocol version `2.0.0`

- Local WebGL host
  Serves the selected Unity runtime source over loopback HTTP and rejects path traversal or unsupported methods.
  Main code: `src/runtime/UnityWebglLocalServer.ts`, `src/runtime/EmbeddedUnityRuntimeInstaller.ts`, `src/runtime/EmbeddedUnityRuntimeArchive.ts`, `src/runtime/EmbeddedUnityIndexHtml.ts`, `src/runtime/WhatsNewFile.ts`
  Depends on: Node `http`, `fs`, `path`, embedded runtime payload helpers

- What's New announcement flow
  Packages one versioned Markdown announcement into the `embedded-archive` runtime, opens it in a plugin-owned view after fresh extraction, and persists the shown version in plugin data.
  Main code: `scripts/whats-new-selection.mjs`, `scripts/package-embedded-archive.mjs`, `src/main.ts`, `src/runtime/WhatsNewFile.ts`, `src/view/WhatsNewView.ts`
  Depends on: root `manifest.json`, `whats-new/*.md`, Obsidian `ItemView`, `MarkdownRenderer`, plugin `loadData()` / `saveData()`

- Unity runtime source
  Receives graph payloads, owns runtime graph state, rebuilds the scene, focuses notes, and requests note opening back in Obsidian.
  Main code: `unity/ReverySkyMap/Assets/Scripts/Bridge/*.cs`, `unity/ReverySkyMap/Assets/Scripts/StarScape/*.cs`, `unity/ReverySkyMap/Assets/Scripts/Interfaces/*.cs`
  Depends on: `MapRuntimeContext`, `ObsidianBridge`, `Cartographer`, `FocusNode`

- Generated WebGL package
  Delivers the compiled runtime and host page used by the iframe. Most of `unity-webgl/` is generated staging output, while the compact `embedded-archive` runtime input under `unity-webgl/Build/runtime-*` and `build-config.json` is tracked intentionally.
  Main code: `unity-webgl/`, `unity-webgl/index.template.html`, `unity-webgl/index.disk-runtime.template.html`, `scripts/import-unity-webgl.ps1`
  Depends on: Unity WebGL export pipeline

### Packaging modes

- `folder-runtime`:
  - generated `unity-webgl/` files remain beside the installed plugin;
  - `UnityWebglLocalServer` serves runtime files from disk.

- `embedded-html`:
  - root `main.js` contains the generated self-contained Unity WebGL index HTML;
  - `UnityWebglLocalServer` serves `index.html` from memory;
  - the iframe creates Blob URLs for the embedded Unity runtime;
  - no runtime files are written to disk;
  - no runtime network download is used.

- `embedded-archive`:
  - root `main.js` contains a compressed Unity runtime archive;
  - the first graph open extracts the runtime into a versioned local cache;
  - later graph opens reuse the cache when plugin version and archive SHA match;
  - the archive may contain one selected `whats-new/<version>.md` file;
  - What's New is checked only after fresh extraction, not on every plugin load or every graph view open;
  - no runtime network download is used;
  - this is the current release-shaped candidate; dashboard submission and scan status are tracked separately.

## Runtime Hosting vs Bridge Messaging

ReverySky 3D Graph uses two separate communication paths. They should not be treated as one system.

### 1. Local HTTP hosting

`UnityWebglLocalServer` only serves the selected Unity runtime source to the iframe. That source can be the local `unity-webgl/` folder for `folder-runtime`, an in-memory embedded `index.html` for `embedded-html`, or an extracted `.reverysky-runtime/<version>/unity-webgl` cache for `embedded-archive`.

The plugin owns one shared local server per plugin instance. `getUnityRuntimeUrl()` serializes cold startup so concurrent graph leaves join the same runtime URL resolution, and graph-view leases keep the server alive until the last open graph leaf closes.

It exposes a loopback URL such as:

```
http://127.0.0.1:<port>/index.html
```

The iframe loads this URL as a normal web page. `MapView.createRuntimeIframeSrc(...)` appends a cache-busting `t` query parameter and the current `renderScale` view preference before the iframe navigates.

The local server may serve files such as:

- `index.html`
- `Build/runtime-entry.js`
- `Build/runtime-code.wasm`
- `Build/runtime-data.data`
- `Build/*.js`
- `TemplateData/*`

The local HTTP server does not build the note graph, does not send `graph:set`, and does not update the Unity scene. Its responsibility is file delivery for the WebGL runtime.

`renderScale` is also not bridge data. It is a startup hint in the iframe URL. The runtime wrapper reads it from the query string and passes the effective device pixel ratio into `createUnityInstance(...)`.

### 2. Bridge messaging after Unity loads

After the iframe page loads and the Unity WebGL runtime starts, live note data travels through the bridge, not through the local HTTP server.

The bridge path is:

- Obsidian plugin TypeScript
- iframe window via `postMessage`
- JavaScript wrapper inside `index.html`
- Unity C# via `unityInstance.SendMessage(...)`
- `ObsidianBridge.cs`
- `MapRuntimeContext`

The reverse path for runtime events is:

- Unity C# `ObsidianBridge`
- JavaScript callback exposed on `window`
- `window.parent.postMessage(...)`
- Obsidian plugin TypeScript

### Bridge implementation files

The bridge is implemented across several runtime boundaries:

- `src/view/MapView.ts` - creates the iframe and attaches the bridge to `iframe.contentWindow`.
- `src/bridge/UnityIframeBridge.ts` - sends plugin-to-runtime messages and receives runtime-to-plugin messages, including note-open, tag-activate, and the best-effort screenshot request/response flow used by the settings-panel button.
- `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html` - contain the iframe JavaScript wrapper. This wrapper listens for `postMessage` events, applies wrapper-only status updates, calls `unityInstance.SendMessage(...)` for Unity-bound messages, captures screenshot requests by reading the Unity canvas, and posts runtime events back to `window.parent`.
- `unity/ReverySkyMap/Assets/Scripts/Bridge/ObsidianBridge.cs` - Unity-side bridge component. It receives graph and focus messages from JavaScript, normalizes payloads, updates `MapRuntimeContext`, and forwards note-open and tag-activate events back to the iframe JavaScript wrapper.

### ObsidianBridge lifetime

`ObsidianBridge` is a runtime-created service object, not a scene-authored visual object. `ObsidianBridge.EnsureInstance()` creates a persistent GameObject named `ObsidianBridge` before scene load when one does not already exist.

This name is part of the JavaScript-to-Unity bridge contract because the iframe wrapper calls:

`unityInstance.SendMessage("ObsidianBridge", "OnGraphSet", json)`.

The object is intentionally kept independent from a specific scene so the WebGL bridge is available early and survives scene changes.

## Execution Paths
Most plugin-side behavior now flows through a small shell in `MapView`, while `src/main.ts` owns plugin lifecycle, runtime startup, and persistence of the last graph-view state. Command wiring is delegated to `src/commands/MapCommands.ts`. The main entry points are the plugin startup path, the graph command, the view startup path, and incoming bridge messages from the runtime. The routes below show how control moves from those entry points through the code.

### Path 1. Command -> view activation -> iframe startup
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()`
   Loads plugin data `mapViewState` and `whatsNewShownVersion`, registers `MAP_VIEW_TYPE`, registers `WHATS_NEW_VIEW_TYPE`, and registers the `open-map` command.
2. `src/commands/MapCommands.ts` -> `activateMapView()`
   Finds an existing graph leaf or creates one with `workspace.getRightLeaf(false)` and `leaf.setViewState(...)`.
   The plugin intentionally opens and owns a single graph leaf: repeated open actions reveal the existing leaf instead of creating another one.
   Some cleanup and focus paths use Obsidian's array-based leaf APIs defensively. Duplicate ReverySky 3D Graph leaves are expected to keep working through the shared runtime server, but they are a recovery case rather than the primary workflow.
3. Obsidian opens the custom view and calls `src/view/MapView.ts` -> `onOpen()`.
4. `MapView.onOpen()` starts `MapSession`, creates `MapFilterPanelController`, and calls `plugin.getUnityRuntimeUrl()`.
5. `src/main.ts` -> `getUnityRuntimeUrl()` chooses the runtime source:
   embedded archive cache through `EmbeddedUnityRuntimeInstaller`, embedded index HTML through `EmbeddedUnityIndexHtml`, or local `unity-webgl/` directory for folder runtime.
   It then lazily creates `UnityWebglLocalServer` and calls `getBaseUrl()`.
6. `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()` -> `startServer()`
   Starts a loopback HTTP server and returns `http://127.0.0.1:<port>/index.html`.
7. `MapView.onOpen()` creates the iframe with that URL, cache-busting `t`, and the session `renderScale`, then waits for the iframe `load` event.
8. On iframe load, `MapView.onOpen()` calls `bridge.attach(iframe.contentWindow, callbacks)`.

### Path 1a. Fresh embedded archive extraction -> What's New view
1. `scripts/package-embedded-archive.mjs` calls `resolveWhatsNewRuntimePaths(...)`.
   The helper reads root `manifest.json`, scans source `whats-new/*.md`, parses only `x.y.z.md` names, and selects the highest semantic version that does not exceed `manifest.version`.
2. The package script copies only that selected file into the archive as `unity-webgl/whats-new/<version>.md`.
   Older source files may remain in the repository; they are not all copied into a release archive.
3. `src/main.ts` -> `getUnityRuntimeUrl()` calls `EmbeddedUnityRuntimeInstaller.resolveRuntimeDirectory(pluginDir, manifest.version)` for `embedded-archive` builds.
4. `src/runtime/EmbeddedUnityRuntimeInstaller.ts` returns `extracted: true` only when the current plugin version cache was rebuilt from the archive.
   Reused caches, folder-runtime installs, and embedded-html installs return or follow paths that do not trigger What's New.
5. On `extracted: true`, `src/main.ts` calls `showWhatsNew(runtimeDir)`.
   `showWhatsNew(...)` reads `runtimeDir/whats-new/`, lets the runtime reader choose the newest valid versioned Markdown file when several are present, exits when there is no file or when the selected version is not newer than `whatsNewShownVersion`, otherwise opens `WHATS_NEW_VIEW_TYPE` in a new tab.
6. `src/view/WhatsNewView.ts` renders the packaged Markdown with Obsidian `MarkdownRenderer`.
7. After a successful open, `src/main.ts` stores the shown version under `whatsNewShownVersion` in plugin data while preserving `mapViewState`.

### Path 2. Handshake -> graph build -> postMessage -> Unity ingest
1. After successful Unity WebGL boot, the runtime posts `bridge:ready`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the incoming message and calls the registered `onReady` callback.
3. `src/view/MapView.ts` -> `session.handleRuntimeReady()`
   Marks the bridge ready, sends runtime settings, accepts any Ego startup focus before graph emission, sends the initial graph, then dispatches accepted startup focus.
4. `src/view/MapSession.ts` -> `prepareStartupGraph()` -> `sendOutgoingGraph()`
   Reuses the latest queued effective graph when one exists; otherwise rebuilds the source graph and outgoing graph before sending the payload.
5. `src/graph/VaultGraphBuilder.ts` -> `build(app)`
   Reads markdown files from the vault, derives stable note ids, normalizes tags and paths, adds canonical date and byte-size fields, and builds links from `metadataCache.resolvedLinks`.
6. `src/view/MapView.ts` -> `bridge.sendGraphSet(outgoingPayload)`
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Validates the payload with `MessageValidator`, builds a `graph:set` envelope, and calls `iframeWindow.postMessage(...)`.
8. Unity receives `graph:set`, replaces the runtime graph snapshot, rebuilds through `Cartographer`, publishes `MapGraphIndex`, and reconciles focus from pending focus first, then `FocusNode.FocusRestoreNoteId`, then reset.
9. When the active Unity engine reaches its ready point, Unity emits `graph:ready` with the matching `requestId`; the iframe status UI ignores stale ready messages and clears `loading...` only for the latest `graph:set`.

`graph:set` and `note:focus` are latest-intent messages, not durable queues.
Before `bridge:ready`, `MapSession` keeps only the latest pending graph payload.
After a graph has been emitted, `MapSession` keeps the latest effective `GraphPayload`.
When the runtime becomes unavailable during iframe restart or window migration, `MapSession` flushes pending source-refresh, filter, and graph-settings debounce work before the next `bridge:ready` can replay a graph.
Global focus requires membership in that payload; Ego focus can change the effective graph center instead.
Active-note rename is the intentional Global gate exception: the new path can arrive before Unity ingests the renamed graph.
Startup focus uses a dedicated ordering path: Ego mode accepts the active note before the initial `graph:set`, while Global mode keeps the membership check against the emitted effective graph before sending `note:focus`.
The first graph build reads the current Obsidian `metadataCache.resolvedLinks` snapshot, then allows the first following `metadataCache.resolved` event to refresh cached vault graph data from settled links.
Graph-relevant live metadata changes use the `metadataCache.resolved` barrier described below.
Markdown editor focus primes the graph-relevant signature for that one note from the current file cache, so the first content-only edit after focus does not look like a tags/links change.
If Unity WebGL boot fails, the iframe wrapper treats the failure as terminal for that iframe, keeps the failure status visible, and intentionally does not emit `bridge:ready` or receive `graph:set`.
When Unity receives `note:focus` before the target star is present in `MapGraphIndex`, `Cartographer.FocusRuntimeNote(...)` stores the note id in `MapRuntimeContext.PendingFocusNoteId`.
The next non-transient graph-index publication applies pending focus once, then falls back to restore focus, then resets.

Graph emission timing is grouped by event intent:

- Immediate `graph:set`:
  runtime `bridge:ready` and Ego focus changes.
- Debounced `graph:set`:
  text filter input waits 500 ms; vault create/delete/rename and metadata-resolved source refreshes wait 250 ms; graph-setting changes wait 250 ms before rebuilding and sending the latest effective graph.
- No immediate `graph:set`:
  Global focus sends only `note:focus`; active-note rename sends only `note:focus` immediately and lets the scheduled rename rebuild send the fresh graph; render scale waits for iframe reopen; frame-rate mode sends `runtime:settings`.

### Path 3. Vault or UI change -> effective graph refresh
1. `MapSession` registers vault and workspace listeners during startup, and `MapFilterPanelController` registers filter-panel DOM listeners when the view renders.
2. A graph-significant change happens:
   vault metadata changes, path filter input changes, tag visibility toggles, Ego option changes, or layout changes.
3. `src/view/MapFilterPanelController.ts` updates session-owned state through `MapSession.setFilterQuery()`, `setShowTags()`, `setMapLayoutPreference()`, or Ego setting setters.
4. For valid filter, tag-visibility, Ego, and layout changes, `src/view/MapSession.ts` rebuilds the outgoing graph from the latest source graph snapshot, then sends it when the bridge is ready. Filter input keeps its own 500 ms debounce and parse/valid pipeline. Graph settings use a separate 250 ms debounce before rebuilding and sending the latest effective graph. Invalid filter input updates UI and persistence state but does not emit `graph:set`.
5. `src/graph/GraphQueryFilter.ts`
   Parses the query and returns the filtered `GraphPayload` subset. When Ego scope is enabled, `MapSession` first applies the query to the source graph while retaining the Ego center, then builds the Ego scope inside that query-visible subset.
6. `src/view/MapView.ts` receives the `sendGraph` callback from `MapSession`, forwards the payload through `UnityIframeBridge`, and asks `MapFilterPanelController` to refresh visible suggestions when needed.
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Sends the effective graph that Unity should render now.

For graph-relevant Obsidian metadata changes, `MapSession` first marks semantic refresh pending and sends `runtime:status` with `Updating graph data...`.

Ego scope is a complete effective-graph transform, not a placeholder setting. `MapSession.buildEgoGraphScope(...)` builds an undirected adjacency view from resolved note links, runs breadth-first search from the current `focusPath` up to `egoDepth`, and records each included note's shortest distance from the center. The resulting payload includes only notes at distances `0..egoDepth`. With `egoNeighborLinksEnabled` disabled, Ego keeps only links that connect different ego-depth rings and reach inward from a non-boundary ring; with it enabled, Ego keeps every note-note link whose endpoints are both inside the included scope.

Tag visibility is applied after query filtering and Ego scope, so `tag:` filters still match the real note metadata before Ego tag-line trimming. When `showTags` is disabled, all emitted note tags are cleared. With Ego scope, `showTags`, and `egoNeighborLinksEnabled` enabled, notes inside the last depth ring keep only tags that are already visible from an inner ring. With Ego scope, `showTags`, and `egoNeighborLinksEnabled` disabled, emitted note tags represent owner/discovery tag lines: each tag is kept only on the depth ring that first exposes it, and boundary-ring notes do not introduce or reconnect tag lines.
It does not rebuild from `metadataCache.resolvedLinks` until Obsidian emits `metadataCache.resolved`.
This prevents an intermediate `resolvedLinks` snapshot from being cached and then reused by later filters.
Startup metadata settling is intentionally different: after the runtime receives the initial graph, the first `metadataCache.resolved` event may trigger one extra graph rebuild without showing the metadata update status.
This one-shot startup refresh is left unconditional by design.
When the plugin is opened after Obsidian has already settled, the next global `resolved` can still spend the startup refresh after a content-only edit; avoiding that would require a startup-only graph equality pass, which is not worth the extra complexity until the edge case proves costly.

Render-scale changes are intentionally different from graph-significant changes. `MapFilterPanelController` calls `MapSession.setRenderScale()` on slider input, which updates session state, the plugin's in-memory snapshot, and UI restart guidance without re-emitting `graph:set`. The controller requests persistence on slider commit through `MapSession.persistRenderScale()`, and the new scale is applied the next time the iframe is created.

Frame-rate changes are runtime settings, not graph data. `MapFilterPanelController` calls `MapSession.setFrameRateMode()`, which updates persisted state and sends `runtime:settings` after bridge readiness. The iframe wrapper forwards the message to Unity `ObsidianBridge.OnRuntimeSettings(...)`, where Unity updates `QualitySettings.vSyncCount` and `Application.targetFrameRate` without rebuilding the graph, resetting focus, or recreating the iframe.

The `Auto` frame-rate mode sets `QualitySettings.vSyncCount = 1` and `Application.targetFrameRate = -1`, so Unity attempts to follow the host display cadence. In Obsidian desktop testing, the iframe `requestAnimationFrame` cadence was observed near 60 FPS even on a 120 Hz display, so WebGL rendering can still be capped by the Obsidian/Electron/Chromium host before Unity reaches the physical monitor refresh rate. Fixed modes use Unity's software frame cap and should be treated as frame-rate caps, not guaranteed proportional power-saving modes.

### Path 4. Markdown editor focus -> graph focus
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` -> `registerEditorExtension(...)`
   Registers `createMarkdownEditorFocusListener(...)` once at plugin scope so the plugin can hear focus changes from any open markdown editor.
2. `src/view/MarkdownEditorFocus.ts` -> `EditorView.updateListener.of(...)`
   Watches CodeMirror updates and ignores everything except a real markdown-editor focus gain with a resolvable vault path.
3. `src/main.ts` -> callback -> `forwardFocusToViews(this, path)`
   Routes the focused path to every open graph view of `MAP_VIEW_TYPE`.
4. `src/view/MapView.ts` -> `requestFocusFromEditor(path)` -> `MapSession.requestFocusFromEditor(path)`
   The view shell does not decide focus policy; it only forwards the signal into session state.
5. `src/view/MapSession.ts` -> `MapFocusController.onMarkdownFocus(path)`
   Passes the markdown editor focus event through the shared duplicate-suppression gate.
6. `src/view/MapSession.ts` -> `handleEditorFocusRequest(path)`
   Validates bridge readiness, accepts graph focus state, then applies the required Global or Ego side effects.
7. `src/bridge/UnityIframeBridge.ts` -> `sendNoteFocus(...)`
   Sends `note:focus` with a deterministic note id derived from the normalized vault path.

In Global mode, this path is intentionally separate from graph refresh. It updates the runtime's focus target without rebuilding the graph, and ordinary editor or file-open focus for notes outside the current effective graph is ignored on the TypeScript side.
In Ego mode, accepted focus updates `MapSession.focusPath`; when the center changes, it rebuilds the effective graph before sending `note:focus`.
Active-note rename uses `skipGraphCheck` for the new id and `skipEgoGraphRebuild` so the scheduled rename rebuild, not stale pre-rename source data, sends the fresh Ego graph.

`MapFocusController` keeps one short-lived 300 ms focus gate keyed by normalized vault path.
The gate collapses duplicate Obsidian focus signals, such as `file-open` followed by markdown editor focus for the same note.
It also consumes expected Obsidian focus echoes after plugin-driven note activation, including Unity note-open and active-note rename focus.
The gate slides forward while matching focus signals are consumed, so a short burst stays collapsed without blocking a later deliberate refocus.

### Path 5. Unity note-open request -> Obsidian note open
1. Unity sends `note:open`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the message and calls `onNoteOpen(payload)`.
3. `src/view/MapView.ts` -> `MapNoteOpenRouter.handleNoteOpenRequest(payload)`
4. `src/view/MapNoteOpenRouter.ts` resolves the target note from the required `id` and `path`, passes the current markdown path only as `openLinkText(...)` link context, and leaves final navigation routing to Obsidian.
5. Before calling `openLinkText(...)`, `MapNoteOpenRouter` records the target as the current plugin-side graph focus and marks the target path in the same focus gate used by normal Obsidian focus routing.
6. Control returns to Obsidian, which opens or focuses the requested note.
7. If Obsidian emits `file-open` or markdown editor focus for that same path within the 300 ms gate, `MapFocusController` consumes it and does not send `note:focus` back to Unity.

### Plugin focus scenarios

These scenarios define the intended focus behavior for the current focus work and record what the code currently does. `Warning` marks a known mismatch between the desired behavior and the implementation.

Focus before bridge readiness is out of scope. Plugin-side focus requests pass through the `bridgeReady` guard in `MapSession.handleEditorFocusRequest(...)`; Unity pending focus starts only after `note:focus` reaches `ObsidianBridge.OnNoteFocus(...)`.
In Global mode, ordinary focus also requires the note to belong to the latest effective graph payload.
In Ego mode, ordinary focus makes the note the `focusPath`; it rebuilds the Ego scope only when that center changes, then sends `note:focus`.
Unity tag activation is mode-specific: Global mode treats it as leaving note focus, while Ego mode marks note focus as suspended without replacing the Ego center. Tag focus has no restore path after a graph rebuild, so an in-Ego rebuild falls back to the Ego center note.
For rename, `MapFocusController.onRename(...)` preserves focus only when the old path matches `focusPath`, then requests focus with `skipGraphCheck` and `skipEgoGraphRebuild`.

- Startup / graph open:
  Expected: when a markdown note is active, focus that note during startup; otherwise show the start panorama.
  Current code:
  `MapSession.start(...)` resets bridge and pending graph state ->
  `MapFocusController.start(...)` registers future `file-open` handling ->
  runtime `bridge:ready` calls `MapSession.handleRuntimeReady()` ->
  `getActiveFilePath()` reads `workspace.getActiveFile()` and accepts only a markdown `TFile` path ->
  `handleRuntimeReady()` accepts Ego focus state before graph emission ->
  `prepareStartupGraph()` reuses or rebuilds the outgoing graph ->
  `sendOutgoingGraph()` sends the effective `graph:set` ->
  `handleRuntimeReady()` sends accepted Ego focus or applies the Global membership check ->
  `UnityIframeBridge.sendNoteFocus(...)` sends `note:focus` only for an accepted active note.

- Markdown editor focus:
  Expected: focus the edited note; in Ego mode, rebuild only when the Ego center changes.
  Current code:
  `handleMarkdownEditorFocusUpdate(...)` accepts a real CodeMirror focus gain and extracts the markdown path ->
  plugin `forwardFocusToViews(this, path)` forwards that path to open graph views ->
  `MapSession.requestFocusFromEditor(path)` delegates to `MapFocusController.onMarkdownFocus(path)` ->
  `MapSession.handleEditorFocusRequest(path)` validates bridge readiness, accepts focus state, and applies the current Global or Ego side effects ->
  `UnityIframeBridge.sendNoteFocus(...)` sends `note:focus`.

- Active file change:
  Expected: focus the opened note after link navigation, file explorer selection, or native graph selection.
  Current code:
  `MapFocusController.start(...)` registers Obsidian `file-open` handling ->
  the callback passes the opened file path through `MapFocusController` ->
  `MapSession.handleEditorFocusRequest(path)` uses the same bridge/path and focus policy as editor focus ->
  `UnityIframeBridge.sendNoteFocus(...)` sends `note:focus`.

- Note content edit:
  Expected: do not refresh the graph or change focus for content-only edits.
  Current code:
  markdown editor focus primes the note signature from `metadataCache.getFileCache(...)` when possible ->
  `metadataCache.on("changed", ...)` receives the metadata cache update ->
  `buildGraphRelevantSignature(cache)` derives tags and outgoing links only ->
  unchanged signature returns before `markSemanticRefreshPending()` ->
  no `graph:set` or `note:focus`.
  Size-only and date-only changes follow the same rule: they are included the next time a graph payload is rebuilt for another reason, but they do not independently trigger a live `graph:set`.
  Known limitation: an outstanding startup metadata-settling refresh can still send one `graph:set` on the next global `metadataCache.resolved`; this is kept as a simple one-shot startup repair instead of adding graph equality comparison.

- Graph-relevant metadata or link change:
  Expected: refresh the graph; keep the focused node if it still exists.
  Current code:
  `metadataCache.on("changed", ...)` detects a changed tags/links signature ->
  `markSemanticRefreshPending()` sets the pending flag and sends `runtime:status` (`Updating graph data...`) ->
  `metadataCache.on("resolved", ...)` schedules the graph refresh ->
  `handleVaultGraphChanged()` rebuilds from `metadataCache.resolvedLinks` ->
  `rebuildOutgoingGraph()` rebuilds the effective payload ->
  `sendOutgoingGraph()` sends `graph:set` ->
  Unity `ObsidianBridge.OnGraphSet(...)` updates `MapRuntimeContext` ->
  `Cartographer.RebuildGraph(...)` rebuilds the active engine ->
  `Cartographer.HandleEngineNodesChanged(...)` publishes `MapGraphIndex` and `ApplyGraphFocus()` tries pending focus, then restore focus, then reset.

- Filter change:
  Expected: keep focus if the node remains visible. Empty or irrelevant intermediate filters should not erase graph focus; until the user explicitly selects another node, Unity's last focus should survive and return when that node is visible again.
  Current code:
  `setFilterQuery(...)` parses the filter and ignores invalid input ->
  valid input schedules a debounced outgoing graph rebuild and send ->
  `rebuildOutgoingGraph()` applies the active query filter, applies Ego scope when enabled, and prepares the effective payload ->
  `sendOutgoingGraph()` sends effective `graph:set` ->
  Unity `ApplyGraphFocus()` tries pending focus if one exists, otherwise restores visible `FocusRestoreNoteId`; `ResetFocus()` resets the camera but keeps `FocusRestoreNoteId`.

- Layout change:
  Expected: change layout; keep focus if the node remains visible.
  Current code:
  `setMapLayoutPreference(...)` normalizes the selected layout ->
  `rebuildOutgoingGraph()` prepares the effective payload with `mapLayout` ->
  `sendOutgoingGraph()` sends `graph:set` ->
  Unity `ObsidianBridge.OnGraphSet(...)` stores `MapRuntimeContext.MapLayoutPreference` ->
  `Cartographer.RebuildGraph(...)` rebuilds and `ApplyGraphFocus()` restores focus from pending or `FocusRestoreNoteId`.

- Create:
  Expected: focus the new note once Obsidian opens or focuses it after creation; until then the previous focus may remain visible.
  Current code:
  `vault.on("create", file)` checks for a markdown path and schedules graph refresh ->
  no code passes the created path to `MapFocusController` directly ->
  if Obsidian emits `file-open` or markdown-editor focus for the created note, `MapSession.handleEditorFocusRequest(...)` may send `note:focus` after the note appears in the latest effective graph ->
  `UnityIframeBridge.sendNoteFocus(...)` can then move focus to the new note.
  Warning: create focus is order-sensitive and best-effort; the old focus can stay in place if `file-open` or editor focus does not arrive, but later user editing will still correct it.

- Rename:
  Expected: keep focus on the renamed active note; do not steal focus for other renames.
  Current code:
  `vault.on("rename", file, oldPath)` forwards old/new paths to `MapFocusController.onRename(...)` ->
  `onRename(...)` compares the active markdown path with old/new path ->
  matching active note calls `requestFocus(newPath, { skipGraphCheck: true, skipEgoGraphRebuild: true })` ->
  `MapSession.handleEditorFocusRequest(...)` sends `note:focus` without requiring the new id in the previous graph or forcing an immediate Ego rebuild ->
  Unity applies it immediately if the star is indexed, or stores it in `MapRuntimeContext.PendingFocusNoteId` until the next real graph-index publication.

- Delete:
  Expected: no separate delete-specific focus trigger; keep the visible focused note when it still exists and fall back cleanly when it does not.
  Current code:
  `vault.on("delete", file)` removes the cached signature and schedules graph refresh ->
  `rebuildOutgoingGraph()` prepares the effective payload ->
  `sendOutgoingGraph()` sends `graph:set` ->
  Unity `ApplyGraphFocus()` restores visible `FocusRestoreNoteId`; otherwise `ResetFocus()` clears the camera view while keeping the restore id for a later graph where it may return.
  No additional delete focus routing is needed.

- Unity note open:
  Expected: focus the Unity star and ask Obsidian to open the note.
  Current code:
  `FocusNode.HandleTouch(...)` selects and focuses the tapped star ->
  `MapRuntimeContext.RequestOpenNote(star.Data)` requests a note open event ->
  `ObsidianBridge.HandleOpenNoteRequested(...)` emits `note:open` ->
  iframe `onNoteOpen` callback passes the payload to `MapNoteOpenRouter.handleNoteOpenRequest(payload)`.

- Unity tag activate:
  Expected: in Global mode, selecting a tag clears the note focus target. In Ego mode, selecting a tag suspends visible note focus while keeping the current Ego center for in-Ego graph rebuilds. Because tag focus has no restore mechanism after rebuild, the next in-Ego rebuild restores focus to the Ego center note. If the view leaves Ego first, the suspended Ego center is cleared.
  Current code:
  `FocusNode.HandleSelect(...)` selects the tapped tag and clears Unity note restore state ->
  `MapRuntimeContext.RequestTagActivate(...)` emits `tag:activate` through `ObsidianBridge` ->
  iframe `onTagActivate` callback calls `MapSession.handleRuntimeTagActivate()` ->
  Global mode clears `focusPath`, while Ego mode keeps `focusPath` and sets `isEgoNoteFocusSuspended` ->
  the next in-Ego `sendOutgoingGraph()` sends `graph:set`, then `restoreEgoFocus()` sends `note:focus` for the Ego center note. If Ego is disabled first, `MapSession` clears the suspended `focusPath` so returning to Ego starts from no center.

### Path 6. Settings persistence -> next open restore
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` reads plugin data with `loadData()` and stores `mapViewState` in the plugin-owned `mapViewState` snapshot.
2. New `MapView` instances receive that snapshot as `initialState`.
3. `src/view/MapView.ts` -> `MapView.onOpen()` applies `initialState` to `MapSession`.
4. `src/view/MapSession.ts` reports user setting changes through `onStateChanged(...)`.
5. Filter text changes update the in-memory snapshot immediately and reuse the filter debounce before requesting `saveData(...)`.
6. Render-scale slider input updates the in-memory snapshot immediately and requests `saveData(...)` on slider commit.
7. Other graph setting changes update the in-memory snapshot immediately and request `saveData(...)` directly, while live `graph:set` emission is coalesced by the graph-settings debounce.
8. `toggleMapView()` close, `onunload()`, and workspace `quit` flush the latest in-memory snapshot before shutdown paths continue.
9. Obsidian workspace view state is intentionally not used as a persistence source for `filterQuery`, `showTags`, `mapLayout`, or `renderScale`.

Open graph leaves do not share live filter state. Each leaf's `MapSession` owns its own current filter, effective graph, bridge readiness, source-refresh timer, filter debounce timer, and graph-settings debounce timer. Persistence remains one plugin-level snapshot, so later opens restore the most recently reported settings rather than per-window settings.

### Path 7. View close -> bridge shutdown -> runtime lease release
1. `src/view/MapView.ts` -> `MapView.onClose()`
   Stops the `MapSession`, cancels deferred iframe rendering, disposes the runtime shell, and calls `bridge.shutdown(300)`.
2. `src/bridge/UnityIframeBridge.ts` -> `shutdown(...)`
   Sends `runtime:shutdown` with a generated `requestId` to the attached iframe and waits for a matching `runtime:shutdown-complete` or timeout.
3. `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html`
   The iframe wrapper enters shutdown mode, removes wrapper-owned bridge listeners, sends `runtime:shutdown` to Unity as a guard, and replies to the parent with `runtime:shutdown-complete`.
4. `unity/ReverySkyMap/Assets/Scripts/Bridge/ObsidianBridge.cs`
   Treats shutdown as a bridge guard so later `graph:set`, `note:focus`, and note-open sends are ignored by that runtime bridge instance.
5. `MapView.onClose()` detaches the bridge and clears the view content if no newer open lifecycle replaced the closing iframe.
6. `src/main.ts` -> graph lifecycle close callback -> `releaseUnityRuntimeLease(...)`
   Releases the view lease; `stopUnityRuntimeServer()` stops the shared loopback server only after the last open graph leaf releases its lease.

### Key plugin-side control points

- `src/main.ts` -> `ReverySkyMapPlugin`
  Owns plugin startup, persistence of the last graph-view state, shared runtime-server startup, and graph-view runtime leases.

- `src/commands/MapCommands.ts`
  Owns command registration and the command callbacks for opening, closing, toggling, screenshot copy, and editor-focus routing.

- `src/view/MapView.ts` -> `MapView`
  Owns the shell execution paths after the view exists: iframe startup, bridge wiring, and collaborator orchestration.

- `src/view/MapSession.ts` -> `MapSession`
  Owns per-view live graph state, source-refresh timing, graph-settings emission debounce, metadata-resolution waiting, Ego depth and neighbor-link scope derivation, graph emission, render-scale restart tracking, and the bridge-facing focus policy.

- `src/view/MapFocusController.ts` -> `MapFocusController`
  Owns plugin-side focus event routing for workspace `file-open`, markdown editor focus, active-note rename, and short-lived suppression of expected focus echoes after Unity note-open or rename focus. It emits focus intents to `MapSession` instead of sending bridge payloads directly.

- `src/view/MarkdownEditorFocus.ts` -> `handleMarkdownEditorFocusUpdate(...)`
  Owns the markdown-editor focus detection logic that feeds the graph-focus path.

- `src/view/MapFilterPanelController.ts` -> `MapFilterPanelController`
  Owns filter-panel DOM creation, control wiring, and delegation to the focused suggestion controller.

- `src/view/MapFilterSuggestionsController.ts` -> `MapFilterSuggestionsController`
  Owns filter suggestion rendering, suggestion-pane transitions, keyboard behavior, ARIA state, and suggestion hide timers.

- `src/view/MapNoteOpenRouter.ts` -> `MapNoteOpenRouter`
  Owns note-open resolution from bridge payloads back into Obsidian workspace behavior.

- `src/graph/VaultGraphBuilder.ts` -> `VaultGraphBuilder.build(app)`
  Owns graph extraction from Obsidian state.

- `src/graph/GraphQueryFilter.ts` -> parse/apply helpers
  Owns query parsing and graph narrowing before handoff to Unity, with an optional center-note exception used by Ego scope.

- `src/bridge/UnityIframeBridge.ts` -> `attach()`, `sendGraphSet()`, `sendStatus()`, `sendNoteFocus()`, `onMessage()`
  Owns browser-side message transport and validation handoff points.

- `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()`, `startServer()`, `handleRequest()`
  Owns runtime hosting and the boundary between plugin code and generated WebGL assets.

## State Ownership and Contracts
### Ownership rules

- Raw vault files, metadata cache, and resolved links are owned by Obsidian.
  They are the source of truth for note existence and links.
  `MapSession` waits for `metadataCache.resolved` after graph-relevant `metadataCache.changed` events before treating `resolvedLinks` as ready for a live rebuild.
  On view startup, it also allows one metadata-settling refresh after the first `metadataCache.resolved` event so an early restored view does not keep an incomplete initial snapshot.

- Stable note ids, normalized paths, normalized tags, canonical note date, and byte-size value are owned by the TypeScript graph layer.
  They are built in `VaultGraphBuilder` and `GraphNormalizer`.

- The source graph and effective graph are both owned by `MapSession`.
  `sourceGraphPayload` is the latest full vault snapshot built from Obsidian state.
  `outgoingGraphPayload` is the effective payload Unity should render now: query filter with the Ego center retained when needed, optional Ego depth scope and neighbor-link selection, then tag visibility, then layout hint.
  If more than one graph leaf is open, each leaf has its own effective graph and can rebuild or re-emit independently.

- `filterQuery`, `showTags`, `mapLayout`, `renderScale`, and Ego settings are owned by `MapSession`.
  They are live per-view state while the leaf is open.
  They are reported to `ReverySkyMapPlugin`, which keeps one latest snapshot in plugin data under `mapViewState` and re-applies that snapshot on later opens.

- Ego settings are fully active in the effective graph pipeline.
  `egoEnabled` switches between global and scoped payloads, `egoDepth` controls breadth-first expansion from the focused note, and `egoNeighborLinksEnabled` controls whether same-ring and cross-neighborhood links inside the included scope are retained.

- Markdown focus events are routed by `MapFocusController`.
  The controller does not store focus history or a focus queue. It keeps only a short-lived path gate to collapse duplicate Obsidian focus signals and consume expected Unity-open or rename echoes, then emits a focus intent to `MapSession`.

- Bridge focus dispatch is owned by `MapSession`.
  In Global mode, ordinary focus is sent only when the requested note is part of the latest effective graph payload.
  In Ego mode, accepted focus rebuilds the effective graph only when the center changes.
  `MapSession` stores the current plugin-side graph `focusPath` after successful TypeScript focus dispatch and after Unity-originated `note:open` requests.
  `focusPath` also acts as the Ego center; when Unity activates a tag, Global mode clears it, while Ego mode keeps it and marks note focus as suspended. Since tag focus cannot be restored after graph rebuild, the next in-Ego rebuild restores the center note instead; leaving Ego first clears that suspended center.
  Rename may bypass the Global membership check only when the renamed old path matches that `focusPath`, because the new path can legitimately arrive before the renamed graph payload reaches Unity.
  Rename also skips immediate Ego graph rebuild; the vault rename listener already schedules a fresh source rebuild, and rebuilding before that would scope around the new path in stale source data.

- Focus responsibility is split across the bridge boundary.
  TypeScript decides whether ordinary focus belongs to the graph Unity should be rendering now. After tag selection forces an in-Ego graph rebuild, the fallback from suspended note focus to the Ego center note is an explicit center intent and is allowed to reach Unity without an outgoing membership check so Unity pending focus can cover graph-index timing.
  Unity does not decide vault/filter membership; its pending focus exists only for the short gap between receiving a valid `note:focus` and exposing the target star in `MapGraphIndex`.

- `renderScale` is applied at iframe startup, not through the bridge.
  `MapSession` tracks the selected value and whether it differs from the currently applied iframe value so the UI can ask the user to reopen the graph.

- The latest settings snapshot is owned by `ReverySkyMapPlugin`.
  It is stored as plugin data under `mapViewState`, then passed to a newly created `MapView` as `initialState` on the next open.
  It is not per-window persisted state.

- The latest shown What's New version is owned by `ReverySkyMapPlugin`.
  It is stored in plugin data under `whatsNewShownVersion`.
  Missing `whatsNewShownVersion` is valid old data and means no announcement has been recorded as shown yet.
  This field is checked only after a fresh `embedded-archive` extraction; it is not a general plugin-startup notification system.

- Filter panel visibility is owned by `MapFilterPanelController`.
  Active suggestion pane, selected suggestion index, ARIA active descendant state, and suggestion hide-delay timers are owned by `MapFilterSuggestionsController`.
  They are UI-only transient state and are intentionally not persisted in plugin data.

- Runtime notes, links, tag names, runtime mode, pending focus note id, layout preference, and note-length-derived visual scale are owned by the Unity runtime.
  They are stored in `MapRuntimeContext` and consumed by `Cartographer`. `ObsidianBridge` maps bridge `size` to `NoteData.Length`, and `StarSO` uses the current runtime note set to derive relative star scale. `PendingFocusNoteId` is a one-shot runtime delivery/materialization buffer; `FocusNode.FocusRestoreNoteId` is the graph-continuity fallback across graph rebuilds.

- WebGL runtime serving is owned by `UnityWebglLocalServer`.
  The runtime is hosted locally from the selected runtime source, not from an external site.
  Server lifecycle is owned by the plugin so multiple graph leaves share one server instead of creating or stopping independent servers.

### Bridge contract
The canonical plugin-side contract lives in:
- `docs/DATA_CONTRACT.md`
- `src/bridge/BridgeTypes.ts`
- `src/bridge/MessageValidator.ts`

Important current contract facts:
- protocol version is `2.0.0`;
- successful startup order is `bridge:ready` first, then `graph:set`;
- Unity WebGL boot failure is terminal inside the iframe wrapper and does not emit `bridge:ready`;
- runtime-to-plugin messages are `bridge:ready`, `graph:ready`, `note:open`, `tag:activate`, and `runtime:shutdown-complete`;
- plugin-to-runtime messages are `graph:set`, `runtime:settings`, `runtime:status`, `note:focus`, and `runtime:shutdown`;
- `path` values must stay vault-relative and use `/` separators;
- `notes[].size` is a non-negative byte count produced from Obsidian file metadata and mapped to Unity `NoteData.Length`;
- `graph:set` carries the effective graph after Ego scope and filters; focus changes are sent separately via `note:focus`, which must include both `id` and `path`;
- Ego `graph:set` payloads use `egoDepth` for note inclusion, `egoNeighborLinksEnabled` for link selection, and two-mode tag-line visibility;
- ordinary Global `note:focus` dispatch is gated by the latest effective graph on the TypeScript side; Global `tag:activate` clears the note focus target; Ego `tag:activate` suspends note focus, keeps the Ego center only while the view remains in Ego, restores the center note after the next in-Ego `graph:set` because tag focus has no restore path, and clears that suspended center if Ego is disabled first; Ego focus rebuilds only when the center changes; active-note rename can bypass the Global gate to cover bridge ordering around path-derived ids;
- `graph:ready` must echo the latest `graph:set` `requestId` before the iframe clears the loading status;
- `runtime:status` updates iframe wrapper status text only and is not forwarded into Unity;
- `runtime:settings` applies Unity runtime frame-rate mode live and does not rebuild graph state;
- `runtime:shutdown` is a bridge/runtime-wrapper lifecycle handshake, not a full Unity engine shutdown;
- `mapLayout` is an optional plugin-owned runtime hint;
- `renderScale` is a plugin-owned iframe startup hint and does not belong to the bridge payload contract;
- invalid outgoing payloads are rejected before dispatch;
- invalid incoming bridge messages are ignored with non-fatal error reporting.

### Filter suggestion behavior
Filter suggestions are a UI contract, not persisted plugin state.

- The root suggestion pane offers filter operators: `path:`, `date:`, and `tag:`.
  Typing an operator prefix filters this pane.
  Selecting a root operator replaces the active trailing prefix and opens the matching second-level pane.
- Second-level panes offer values for the active operator: folders for `path:`, presets for `date:`, and known tags for `tag:`.
  Filtering uses only the active trailing term, so compound queries such as `path:Projects date:to` filter date presets by `date:to`.
- Selecting a second-level value commits that value to the query and returns to the root pane.
  This keeps compound filter construction available after every value choice.
- A trailing whitespace after a completed token returns suggestions to the root pane.
- Keyboard behavior follows ordinary combobox expectations.
  `ArrowDown` and `ArrowUp` navigate an open pane; when suggestions are closed, `ArrowDown` opens on the first item and `ArrowUp` opens on the last item.
  `Enter` commits the active suggestion.
  `Escape` first hides an open suggestion pane; with no pane open, it clears the filter query and restores the root pane.
- Accessibility semantics mirror the visible behavior.
  The filter input is a combobox that controls an inner `listbox`.
  Suggestion rows are `option` elements with `aria-selected`.
  The active row is exposed through `aria-activedescendant`.
  Empty states and section titles stay outside the `listbox` and clear the active descendant.
- The behavior is covered by `tests/view/MapFilterPanelController.test.ts` for focused suggestion interactions and by `tests/view/MapView.test.ts` for view-level integration.

## Build, Packaging, and Deployment Boundaries
Source and generated surfaces are intentionally separate:

Main repository surfaces:

- `src/`
  Role: Obsidian plugin source
  Type: source

- `unity/ReverySkyMap/`
  Role: Unity source project
  Type: source

- `unity-webgl/index.template.html`
  Role: tracked host template
  Type: source

- `unity-webgl/index.disk-runtime.template.html`
  Role: tracked disk-runtime host template for compact archive packaging
  Type: source

- `unity-webgl/index.html`
  Role: local runtime host page
  Type: generated

- `unity-webgl/Build/build-config.json`, `runtime-entry.js`, `runtime-core.js`, `runtime-data.*`, and `runtime-code.*`
  Role: compact Unity runtime input for `embedded-archive` release builds
  Type: tracked generated input

- `whats-new/*.md`
  Role: versioned source announcements for `embedded-archive` releases
  Type: source

- other `unity-webgl/Build/*` files and `unity-webgl/TemplateData/*`
  Role: local WebGL export staging artifacts
  Type: generated

- `main.js`
  Role: bundled plugin entry output
  Type: generated

Build and import flow:
1. Unity exports WebGL from `unity/ReverySkyMap`.
2. `scripts/import-unity-webgl.ps1` copies the export into `unity-webgl/` and regenerates runtime files used by all package modes.
3. `npm run build` builds the current `embedded-archive` release candidate from the prepared runtime, copies the selected `whats-new/<version>.md` file into the archive when one is eligible, and writes root `main.js`.
4. Local folder-runtime installs can be built with `npm run package:folder-runtime`.
5. Other release-shaped package modes can be built with `npm run package:embedded-html` or `npm run package:embedded-archive`.

What's New packaging rules:
- Source announcement files may accumulate in `whats-new/`.
- File names must be exact semantic versions in `x.y.z.md` form.
- The selected file is the highest `whats-new` version less than or equal to `manifest.version`, using numeric `major`, `minor`, and `patch` comparison.
- Intermediate plugin releases without their own announcement reuse the nearest lower eligible announcement.
- A release archive contains at most one announcement file, so a skipped-version user sees the selected release note, not a sequence of every older note.
- Unity does not need to be rebuilt when only `whats-new/*.md` changes; rebuilding root `main.js` through `npm run build` is enough.

## Verification
Detailed commands live in `docs/VERIFICATION.md`. This section only maps the main architecture areas to their checks.

- Entry path: command -> view -> runtime startup
  Automated checks: `npm run build`
  Manual checks: confirm the graph command opens the custom view and the iframe starts successfully

- Handshake and bridge transport
  Automated checks: `npm run test`, especially `tests/bridge/*`
  Manual checks: verify `bridge:ready` -> `graph:set` flow in the graph view

- View execution paths, filter state, editor-focus routing, and note-open flow
  Automated checks: `npm run test`, especially `tests/view/MapView.test.ts`, `tests/view/MapFilterPanelController.test.ts`, `tests/view/MarkdownEditorFocus.test.ts`, `tests/view/MapSession.test.ts`, `tests/view/MapNoteOpenRouter.test.ts`, and `tests/bridge/UnityIframeBridge.test.ts`
  Manual checks: open the graph, click into a markdown note, change filters, reopen the graph, and open a note from the runtime

- Graph state persistence across close and reopen
  Automated checks: `npm run test`, especially `tests/main.test.ts`
  Manual checks: set filters, tags visibility, layout, and render scale; close the graph through the ribbon toggle; reopen it; then repeat after restarting Obsidian

- What's New packaging and one-time display
  Automated checks: `npm run test`, especially `tests/scripts/whatsNewSelection.test.ts`, `tests/runtime/WhatsNewFile.test.ts`, `tests/view/WhatsNewView.test.ts`, and `tests/main.test.ts`
  Manual checks: install or update an `embedded-archive` build, open the graph after plugin reload, confirm the announcement opens once, then reopen the graph and confirm it does not repeat

- Visual plugin UI states
  Automated checks: `npm run test:ui-visual` when UI changed
  Manual checks: review screenshots for search/filter controls, toggles, layout selector, and render-scale slider

- Unity runtime source changes
  Automated checks: Unity-side tests when available
  Manual checks: open the Unity project, enter Play mode, and verify runtime behavior

## Known Risks and Open Questions
- There is no repository-defined CI, so architecture regressions depend on local verification discipline.
- TypeScript tests cover the plugin side well enough to show intent, but they do not prove the packaged Unity WebGL build is fresh.
- Unity runtime quality depends on a new export plus a correct `scripts/import-unity-webgl.ps1` import step after Unity-side changes.
- The repository contains source-of-truth docs, generated runtime assets, and tracked generated runtime inputs for `embedded-archive`; future work must keep those boundaries explicit to avoid editing the wrong surface.
- Live metadata refresh currently keys off tags and outgoing links. Size-only or date-only changes can leave Unity visual scale or date layout stale until another graph refresh occurs.
