# ReverySky Map for Obsidian - Architecture

## Purpose and Scope
ReverySky Map is an Obsidian desktop plugin that renders relationships between vault notes inside a Unity WebGL scene embedded in a custom Obsidian view.

Current in-scope behavior:
- open a dedicated map view from an Obsidian command;
- build a graph from markdown files and resolved links;
- let the view filter the effective graph before sending it to Unity;
- persist map view preferences across close and reopen;
- host the local WebGL runtime on `127.0.0.1`;
- round-trip note selection between Obsidian and the Unity runtime.

## System Overview
The system has three runtime boundaries:
1. Obsidian plugin code in TypeScript.
2. A loopback HTTP host that serves the WebGL package.
3. Unity runtime code compiled into the WebGL build.

Main system parts:

- Obsidian plugin shell
  Registers the custom view and the `Open map` command, and lazily creates the local WebGL server.
  Main code: `src/main.ts`
  Depends on: Obsidian `Plugin`, `WorkspaceLeaf`, `UnityWebglLocalServer`

- Map view shell
  Creates the iframe, wires the bridge lifecycle, and delegates filter UI and note-open routing to focused collaborators.
  Main code: `src/view/MapView.ts`
  Depends on: `MapSession`, `MapFilterPanelController`, `MapNoteOpenRouter`, `UnityIframeBridge`

- Map session and filter UI
  Owns persisted map state, graph refresh timing, Obsidian metadata-resolution gating, filter derivation, render-scale preference, and the transient filter-panel interaction state.
  Main code: `src/view/MapSession.ts`, `src/view/MapFilterPanelController.ts`
  Depends on: `VaultGraphBuilder`, `GraphPathFilter`, Obsidian workspace APIs, browser DOM events

- Markdown editor focus adapter
  Translates markdown editor focus updates into the same map-focus path used by active-file changes.
  Main code: `src/view/MarkdownEditorFocus.ts`
  Depends on: CodeMirror `ViewUpdate`, Obsidian `editorInfoField`

- Graph extraction and normalization
  Converts vault files and resolved links into a stable graph payload with normalized paths, tags, dates, and note ids.
  Main code: `src/graph/VaultGraphBuilder.ts`, `src/graph/GraphNormalizer.ts`
  Depends on: Obsidian `vault` and `metadataCache`

- Bridge transport and validation
  Defines the cross-runtime contract, validates payloads, and delivers `postMessage` envelopes to and from the iframe.
  Main code: `src/bridge/BridgeTypes.ts`, `src/bridge/MessageValidator.ts`, `src/bridge/UnityIframeBridge.ts`
  Depends on: browser `postMessage`, protocol version `2.0.0`

- Local WebGL host
  Serves the selected Unity runtime source over loopback HTTP and rejects path traversal or unsupported methods.
  Main code: `src/runtime/UnityWebglLocalServer.ts`, `src/runtime/EmbeddedUnityRuntimeInstaller.ts`, `src/runtime/EmbeddedUnityRuntimeArchive.ts`, `src/runtime/EmbeddedUnityIndexHtml.ts`
  Depends on: Node `http`, `fs`, `path`, embedded runtime payload helpers

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
  - the first map open extracts the runtime into a versioned local cache;
  - later map opens reuse the cache when plugin version and archive SHA match;
  - no runtime network download is used;
  - this is the current release-shaped candidate; dashboard submission and scan status are tracked separately.

## Runtime Hosting vs Bridge Messaging

ReverySky Map uses two separate communication paths. They should not be treated as one system.

### 1. Local HTTP hosting

`UnityWebglLocalServer` only serves the selected Unity runtime source to the iframe. That source can be the local `unity-webgl/` folder for `folder-runtime`, an in-memory embedded `index.html` for `embedded-html`, or an extracted `.reverysky-runtime/<version>/unity-webgl` cache for `embedded-archive`.

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
- `src/bridge/UnityIframeBridge.ts` - sends plugin-to-runtime messages and receives runtime-to-plugin messages.
- `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html` - contain the iframe JavaScript wrapper. This wrapper listens for `postMessage` events, applies wrapper-only status updates, calls `unityInstance.SendMessage(...)` for Unity-bound messages, and posts runtime events back to `window.parent`.
- `unity/ReverySkyMap/Assets/Scripts/Bridge/ObsidianBridge.cs` - Unity-side bridge component. It receives graph and focus messages from JavaScript, normalizes payloads, updates `MapRuntimeContext`, and forwards note-open events back to the iframe JavaScript wrapper.

### ObsidianBridge lifetime

`ObsidianBridge` is a runtime-created service object, not a scene-authored visual object. `ObsidianBridge.EnsureInstance()` creates a persistent GameObject named `ObsidianBridge` before scene load when one does not already exist.

This name is part of the JavaScript-to-Unity bridge contract because the iframe wrapper calls:

`unityInstance.SendMessage("ObsidianBridge", "OnGraphSet", json)`.

The object is intentionally kept independent from a specific scene so the WebGL bridge is available early and survives scene changes.

## Execution Paths
Most plugin-side behavior now flows through a small shell in `MapView`, while `src/main.ts` owns plugin lifecycle, view activation, and persistence of the last map-view state. The main entry points are the plugin startup path, the map command, the view startup path, and incoming bridge messages from the runtime. The routes below show how control moves from those entry points through the code.

### Path 1. Command -> view activation -> iframe startup
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()`
   Loads plugin data `mapViewState`, registers `MAP_VIEW_TYPE`, and registers the `open-map` command.
2. `src/main.ts` -> command callback -> `activateMapView()`
   Finds an existing map leaf or creates one with `workspace.getRightLeaf(false)` and `leaf.setViewState(...)`.
3. Obsidian opens the custom view and calls `src/view/MapView.ts` -> `onOpen()`.
4. `MapView.onOpen()` starts `MapSession`, creates `MapFilterPanelController`, and calls `plugin.getUnityRuntimeUrl()`.
5. `src/main.ts` -> `getUnityRuntimeUrl()` chooses the runtime source:
   embedded archive cache through `EmbeddedUnityRuntimeInstaller`, embedded index HTML through `EmbeddedUnityIndexHtml`, or local `unity-webgl/` directory for folder runtime.
   It then lazily creates `UnityWebglLocalServer` and calls `getBaseUrl()`.
6. `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()` -> `startServer()`
   Starts a loopback HTTP server and returns `http://127.0.0.1:<port>/index.html`.
7. `MapView.onOpen()` creates the iframe with that URL, cache-busting `t`, and the session `renderScale`, then waits for the iframe `load` event.
8. On iframe load, `MapView.onOpen()` calls `bridge.attach(iframe.contentWindow, callbacks)`.

### Path 2. Handshake -> graph build -> postMessage -> Unity ingest
1. After successful Unity WebGL boot, the runtime posts `bridge:ready`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the incoming message and calls the registered `onReady` callback.
3. `src/view/MapView.ts` -> `session.setBridgeReady(true)` -> `session.flushOrRefresh()`
   Starts the first graph emission or flushes the latest queued graph if refresh work already happened before the handshake.
4. `src/view/MapSession.ts` -> `refreshGraphNow()` -> `emitGraphFromSource()`
   Rebuilds the source graph, applies the active filter, applies `showTags`, and includes `mapLayout`.
5. `src/graph/VaultGraphBuilder.ts` -> `build(app)`
   Reads markdown files from the vault, derives stable note ids, normalizes tags and paths, and builds links from `metadataCache.resolvedLinks`.
6. `src/view/MapView.ts` -> `bridge.sendGraphSet(outgoingPayload)`
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Validates the payload with `MessageValidator`, builds a `graph:set` envelope, and calls `iframeWindow.postMessage(...)`.
8. Unity receives `graph:set`, replaces the runtime graph snapshot, rebuilds through `Cartographer`, publishes `MapGraphIndex`, and reconciles focus from pending focus first, then `FocusNode.FocusRestoreNoteId`, then reset.
9. When the active Unity engine reaches its ready point, Unity emits `graph:ready` with the matching `requestId`; the iframe status UI ignores stale ready messages and clears `loading...` only for the latest `graph:set`.

`graph:set` and `note:focus` are latest-intent messages, not durable queues.
Before `bridge:ready`, `MapSession` keeps only the latest pending graph payload.
After a graph has been emitted, `MapSession` keeps the latest effective `GraphPayload` and sends ordinary `note:focus` only when the requested note path or id belongs to that payload.
Active-note rename is the one intentional exception: the new path bypasses the graph-membership gate because the rename focus can arrive before Unity ingests the next graph.
The first graph build reads the current Obsidian `metadataCache.resolvedLinks` snapshot, then accepts the first following `metadataCache.resolved` event as a one-time startup correction refresh.
Graph-relevant live metadata changes use the `metadataCache.resolved` barrier described below.
Markdown editor focus primes the graph-relevant signature for that one note from the current file cache, so the first content-only edit after focus does not look like a tags/links change.
If Unity WebGL boot fails, the iframe wrapper treats the failure as terminal for that iframe, keeps the failure status visible, and intentionally does not emit `bridge:ready` or receive `graph:set`.
When Unity receives `note:focus` before the target star is present in `MapGraphIndex`, `Cartographer.FocusRuntimeNote(...)` stores the note id in `MapRuntimeContext.PendingFocusNoteId`.
The next non-transient graph-index publication applies pending focus once, then falls back to restore focus, then resets.

### Path 3. Vault or UI change -> filtered graph refresh
1. `MapSession` registers vault and workspace listeners during startup, and `MapFilterPanelController` registers filter-panel DOM listeners when the view renders.
2. A graph-significant change happens:
   vault metadata changes, path filter input changes, tag visibility toggles, or map layout changes.
3. `src/view/MapFilterPanelController.ts` updates session-owned state through `MapSession.setFilterQuery()`, `setShowTags()`, or `MapSession.setMapLayoutPreference()`.
4. For valid filter, tag-visibility, and layout changes, `src/view/MapSession.ts` re-enters `emitGraphFromSource()` using the latest source graph snapshot. Filter input is debounced before graph emission; invalid filter input updates UI and persistence state but does not emit `graph:set`.
5. `src/graph/GraphPathFilter.ts`
   Parses the query and returns the filtered `GraphPayload` subset.
6. `src/view/MapView.ts` receives the `sendGraph` callback from `MapSession`, forwards the payload through `UnityIframeBridge`, and asks `MapFilterPanelController` to refresh visible suggestions when needed.
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Sends the effective graph that Unity should render now.

For graph-relevant Obsidian metadata changes, `MapSession` first marks semantic refresh pending and sends `runtime:status` with `Updating map data...`.
It does not rebuild from `metadataCache.resolvedLinks` until Obsidian emits `metadataCache.resolved`.
This prevents an intermediate `resolvedLinks` snapshot from being cached and then reused by later filters.
Startup correction is intentionally different: after the runtime receives the initial graph, the first `metadataCache.resolved` event may trigger one extra graph rebuild without showing the metadata update status.
This one-shot startup refresh is left unconditional by design.
When the plugin is opened after Obsidian has already settled, the next global `resolved` can still spend the startup refresh after a content-only edit; avoiding that would require a startup-only graph equality pass, which is not worth the extra complexity until the edge case proves costly.

Render-scale changes are intentionally different from graph-significant changes. `MapFilterPanelController` calls `MapSession.setRenderScale()` on slider input, which updates session state, the plugin's in-memory snapshot, and UI restart guidance without re-emitting `graph:set`. The controller requests persistence on slider commit through `MapSession.persistRenderScale()`, and the new scale is applied the next time the iframe is created.

### Path 4. Markdown editor focus -> map focus
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` -> `registerEditorExtension(...)`
   Registers `createMarkdownEditorFocusExtension(...)` once at plugin scope so the plugin can hear focus changes from any open markdown editor.
2. `src/view/MarkdownEditorFocus.ts` -> `EditorView.updateListener.of(...)`
   Watches CodeMirror updates and ignores everything except a real markdown-editor focus gain with a resolvable vault path.
3. `src/main.ts` -> callback -> `requestEditorFocus(path)`
   Routes the focused path to every open map view of `MAP_VIEW_TYPE`.
4. `src/view/MapView.ts` -> `requestEditorFocus(path)` -> `MapSession.requestEditorFocus(path)`
   The view shell does not decide focus policy; it only forwards the signal into session state.
5. `src/view/MapSession.ts` -> `MapFocusController.onMarkdownFocus(path)`
   Passes the markdown editor focus event through the shared duplicate-suppression gate.
6. `src/view/MapSession.ts` -> `trySendFocusForPath(path)`
   Validates bridge readiness, markdown path shape, and membership in the latest effective graph.
7. `src/bridge/UnityIframeBridge.ts` -> `sendNoteFocus(...)`
   Sends `note:focus` with a deterministic note id derived from the normalized vault path.

This path is intentionally separate from graph refresh. It updates the runtime's focus target without rebuilding the graph unless some other change already triggered a refresh.
Ordinary editor and file-open focus for notes outside the current effective graph is ignored on the TypeScript side.
Active-note rename uses the same dispatch path with `skipGraphCheck` because the new note id may not be present in the previously emitted graph.

`MapFocusController` keeps one short-lived 250 ms focus gate keyed by normalized vault path.
The gate collapses duplicate Obsidian focus signals, such as `file-open` followed by markdown editor focus for the same note.
The gate slides forward while matching duplicate focus signals are consumed, so a short burst stays collapsed without blocking a later deliberate refocus.

### Path 5. Unity note-open request -> Obsidian note open
1. Unity sends `note:open`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the message and calls `onNoteOpen(payload)`.
3. `src/view/MapView.ts` -> `MapNoteOpenRouter.openRequestedNote(payload)`
4. `src/view/MapNoteOpenRouter.ts` resolves the target note from the required `id` and `path`, passes the current markdown path only as `openLinkText(...)` link context, and leaves final navigation routing to Obsidian.
5. Before calling `openLinkText(...)`, `MapNoteOpenRouter` records the target as the current plugin-side map focus and marks the target path in the same focus gate used by normal Obsidian focus routing.
6. Control returns to Obsidian, which opens or focuses the requested note.
7. If Obsidian emits `file-open` or markdown editor focus for that same path within the 250 ms gate, `MapFocusController` consumes it and does not send `note:focus` back to Unity.

### Plugin focus scenarios

These scenarios define the intended focus behavior for the current focus work and record what the code currently does. `Warning` marks a known mismatch between the desired behavior and the implementation.

Focus before bridge readiness is out of scope. Plugin-side focus requests pass through the `bridgeReady` guard in `MapSession.trySendFocusForPath(...)`; Unity pending focus starts only after `note:focus` reaches `ObsidianBridge.OnNoteFocus(...)`.
For ordinary focus, `MapSession.trySendFocusForPath(...)` also requires the note to belong to the latest effective graph payload.
For rename, `MapFocusController.onRename(...)` preserves focus only when the renamed old path matches `MapSession`'s plugin-side `focusPath`, then requests focus with `skipGraphCheck` so the new id can be handed to Unity before the following graph rebuild reaches the runtime.

- Startup / map open:
  Expected: no focused note; show the start panorama.
  Current code:
  `MapSession.start(...)` resets bridge and pending graph state ->
  `MapFocusController.start(...)` registers future `file-open` handling only ->
  no code reads the current active leaf or sends startup `note:focus`.

- Markdown editor focus:
  Expected: focus the edited note; do not rebuild the graph.
  Current code:
  `handleMarkdownEditorFocusUpdate(...)` accepts a real CodeMirror focus gain and extracts the markdown path ->
  plugin `requestEditorFocus(path)` forwards that path to open map views ->
  `MapSession.requestEditorFocus(path)` delegates to `MapFocusController.onMarkdownFocus(path)` ->
  `MapSession.trySendFocusForPath(path)` validates bridge/path and latest-graph membership ->
  `UnityIframeBridge.sendNoteFocus(...)` sends `note:focus`.

- Active file change:
  Expected: focus the opened note after link navigation, file explorer selection, or native graph selection.
  Current code:
  `MapFocusController.start(...)` registers Obsidian `file-open` handling ->
  the callback passes the opened file path through `MapFocusController` ->
  `MapSession.trySendFocusForPath(path)` uses the same bridge/path and latest-graph membership checks as editor focus ->
  `UnityIframeBridge.sendNoteFocus(...)` sends `note:focus`.

- Note content edit:
  Expected: do not refresh the graph or change focus for content-only edits.
  Current code:
  markdown editor focus primes the note signature from `metadataCache.getFileCache(...)` when possible ->
  `metadataCache.on("changed", ...)` receives the metadata cache update ->
  `buildGraphRelevantSignature(cache)` derives tags and outgoing links only ->
  unchanged signature returns before `markSemanticRefreshPending()` ->
  no `graph:set` or `note:focus`.
  Known limitation: an outstanding startup correction can still send one `graph:set` on the next global `metadataCache.resolved`; this is kept as a simple one-shot startup repair instead of adding graph equality comparison.

- Graph-relevant metadata or link change:
  Expected: refresh the graph; keep the focused node if it still exists.
  Current code:
  `metadataCache.on("changed", ...)` detects a changed tags/links signature ->
  `markSemanticRefreshPending()` sets the pending flag and sends `runtime:status` (`Updating map data...`) ->
  `metadataCache.on("resolved", ...)` schedules the graph refresh ->
  `refreshGraphNow()` rebuilds from `metadataCache.resolvedLinks` ->
  `emitGraphFromSource()` sends `graph:set` ->
  Unity `ObsidianBridge.OnGraphSet(...)` updates `MapRuntimeContext` ->
  `Cartographer.RebuildGraph(...)` rebuilds the active engine ->
  `Cartographer.HandleEngineNodesChanged(...)` publishes `MapGraphIndex` and `ApplyGraphFocus()` tries pending focus, then restore focus, then reset.

- Filter change:
  Expected: keep focus if the node remains visible. Empty or irrelevant intermediate filters should not erase map focus; until the user explicitly selects another node, Unity's last focus should survive and return when that node is visible again.
  Current code:
  `setFilterQuery(...)` parses the filter and ignores invalid input ->
  valid input schedules debounced `emitGraphFromSource()` ->
  `emitGraphFromSource()` applies active filters and sends filtered `graph:set` ->
  Unity `ApplyGraphFocus()` tries pending focus if one exists, otherwise restores visible `FocusRestoreNoteId`; `ResetFocus()` resets the camera but keeps `FocusRestoreNoteId`.

- Layout change:
  Expected: change layout; keep focus if the node remains visible.
  Current code:
  `setMapLayoutPreference(...)` normalizes the selected layout ->
  `emitGraphFromSource()` sends `graph:set` with `mapLayout` ->
  Unity `ObsidianBridge.OnGraphSet(...)` stores `MapRuntimeContext.MapLayoutPreference` ->
  `Cartographer.RebuildGraph(...)` rebuilds and `ApplyGraphFocus()` restores focus from pending or `FocusRestoreNoteId`.

- Create:
  Expected: focus the new note once Obsidian opens or focuses it after creation; until then the previous focus may remain visible.
  Current code:
  `vault.on("create", file)` checks for a markdown path and schedules graph refresh ->
  no code passes the created path to `MapFocusController` directly ->
  if Obsidian emits `file-open` or markdown-editor focus for the created note, `MapSession.trySendFocusForPath(...)` may send `note:focus` after the note appears in the latest effective graph ->
  `UnityIframeBridge.sendNoteFocus(...)` can then move focus to the new note.
  Warning: create focus is order-sensitive and best-effort; the old focus can stay in place if `file-open` or editor focus does not arrive, but later user editing will still correct it.

- Rename:
  Expected: keep focus on the renamed active note; do not steal focus for other renames.
  Current code:
  `vault.on("rename", file, oldPath)` forwards old/new paths to `MapFocusController.onRename(...)` ->
  `onRename(...)` compares the active markdown path with old/new path ->
  matching active note calls `requestFocus(newPath, { skipGraphCheck: true })` ->
  `MapSession.trySendFocusForPath(...)` sends `note:focus` without requiring the new id in the previously emitted graph ->
  Unity applies it immediately if the star is indexed, or stores it in `MapRuntimeContext.PendingFocusNoteId` until the next real graph-index publication.

- Delete:
  Expected: no separate delete-specific focus trigger; keep the visible focused note when it still exists and fall back cleanly when it does not.
  Current code:
  `vault.on("delete", file)` removes the cached signature and schedules graph refresh ->
  `emitGraphFromSource()` sends `graph:set` ->
  Unity `ApplyGraphFocus()` restores visible `FocusRestoreNoteId`; otherwise `ResetFocus()` clears the camera view while keeping the restore id for a later graph where it may return.
  No additional delete focus routing is needed.

- Unity note open:
  Expected: focus the Unity star and ask Obsidian to open the note.
  Current code:
  `FocusNode.HandleTouch(...)` selects and focuses the tapped star ->
  `MapRuntimeContext.RequestOpenNote(star.Data)` requests a note open event ->
  `ObsidianBridge.HandleOpenNoteRequested(...)` emits `note:open` ->
  iframe `onNoteOpen` callback passes the payload to `MapNoteOpenRouter.openRequestedNote(payload)`.

### Path 6. Map settings persistence -> next open restore
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` reads plugin data with `loadData()` and stores `mapViewState` in the plugin-owned `mapViewState` snapshot.
2. New `MapView` instances receive that snapshot as `initialState`.
3. `src/view/MapView.ts` -> `MapView.onOpen()` applies `initialState` to `MapSession`.
4. `src/view/MapSession.ts` reports user setting changes through `onStateChanged(...)`.
5. Filter text changes update the in-memory snapshot immediately and reuse the existing filter debounce before requesting `saveData(...)`.
6. Render-scale slider input updates the in-memory snapshot immediately and requests `saveData(...)` on slider commit.
7. Other map setting changes request `saveData(...)` directly because they are low-frequency actions.
8. `toggleMapView()` close, `onunload()`, and workspace `quit` flush the latest in-memory snapshot before shutdown paths continue.
9. Obsidian workspace view state is intentionally not used as a persistence source for `pathFilterQuery`, `showTags`, `mapLayout`, or `renderScale`.

### Key plugin-side control points

- `src/main.ts` -> `ReverySkyMapPlugin`
  Owns plugin startup, command registration, view activation, persistence of the last map-view state, and lazy runtime-server creation.

- `src/view/MapView.ts` -> `MapView`
  Owns the shell execution paths after the view exists: iframe startup, bridge wiring, and collaborator orchestration.

- `src/view/MapSession.ts` -> `MapSession`
  Owns persisted map state, graph refresh timing, metadata-resolution waiting, graph emission, render-scale restart tracking, and the bridge-facing focus membership gate.

- `src/view/MapFocusController.ts` -> `MapFocusController`
  Owns plugin-side focus event routing for workspace `file-open`, markdown editor focus, active-note rename, and short-lived suppression of Unity-open focus echo. It emits focus intents to `MapSession` instead of sending bridge payloads directly.

- `src/view/MarkdownEditorFocus.ts` -> `handleMarkdownEditorFocusUpdate(...)`
  Owns the markdown-editor focus detection logic that feeds the map-focus path.

- `src/view/MapFilterPanelController.ts` -> `MapFilterPanelController`
  Owns filter-panel DOM creation, suggestion rendering, and UI-only interaction state.

- `src/view/MapNoteOpenRouter.ts` -> `MapNoteOpenRouter`
  Owns note-open resolution from bridge payloads back into Obsidian workspace behavior.

- `src/graph/VaultGraphBuilder.ts` -> `VaultGraphBuilder.build(app)`
  Owns graph extraction from Obsidian state.

- `src/graph/GraphPathFilter.ts` -> parse/apply helpers
  Owns query parsing and graph narrowing before handoff to Unity.

- `src/bridge/UnityIframeBridge.ts` -> `attach()`, `sendGraphSet()`, `sendStatus()`, `sendNoteFocus()`, `onMessage()`
  Owns browser-side message transport and validation handoff points.

- `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()`, `startServer()`, `handleRequest()`
  Owns runtime hosting and the boundary between plugin code and generated WebGL assets.

## State Ownership and Contracts
### Ownership rules

- Raw vault files, metadata cache, and resolved links are owned by Obsidian.
  They are the source of truth for note existence and links.
  `MapSession` waits for `metadataCache.resolved` after graph-relevant `metadataCache.changed` events before treating `resolvedLinks` as ready for a live rebuild.
  On view startup, it also allows one correction refresh after the first `metadataCache.resolved` event so an early restored view does not keep an incomplete initial snapshot.

- Stable note ids, normalized paths, normalized tags, and canonical note date are owned by the TypeScript graph layer.
  They are built in `VaultGraphBuilder` and `GraphNormalizer`.

- The effective graph after filters is owned by `MapSession`.
  The session emits the filtered payload that Unity receives through the shell view.

- `pathFilterQuery`, `showTags`, `mapLayout`, and `renderScale` are owned by `MapSession`.
  They are reported to `ReverySkyMapPlugin`, persisted in plugin data under `mapViewState`, and re-applied on open.

- Markdown focus events are routed by `MapFocusController`.
  The controller does not store focus history or a focus queue. It keeps only a short-lived path gate to collapse duplicate Obsidian focus signals and consume Unity-open echo, then emits a focus intent to `MapSession`.

- Bridge focus dispatch is owned by `MapSession`.
  Ordinary focus is sent only when the requested note is part of the latest effective graph payload.
  `MapSession` stores the current plugin-side map `focusPath` after successful TypeScript focus dispatch and after Unity-originated `note:open` requests.
  Rename may bypass the membership check only when the renamed old path matches that `focusPath`, because the new path can legitimately arrive before the renamed graph payload reaches Unity.

- Focus responsibility is split across the bridge boundary.
  TypeScript decides whether a focus request belongs to the map Unity should be rendering now. Unity does not decide vault/filter membership; its pending focus exists only for the short gap between receiving a valid `note:focus` and exposing the target star in `MapGraphIndex`.

- `renderScale` is applied at iframe startup, not through the bridge.
  `MapSession` tracks the selected value and whether it differs from the currently applied iframe value so the UI can ask the user to reopen the map.

- The latest map settings snapshot is owned by `ReverySkyMapPlugin`.
  It is stored as plugin data under `mapViewState`, then passed to a newly created `MapView` as `initialState` on the next open.

- Filter panel visibility, active suggestion pane, and hide-delay timers are owned by `MapFilterPanelController`.
  They are UI-only transient state and are intentionally not persisted in plugin data.

- Runtime notes, links, tag names, runtime mode, pending focus note id, and layout preference are owned by the Unity runtime.
  They are stored in `MapRuntimeContext` and consumed by `Cartographer`. `PendingFocusNoteId` is a one-shot runtime delivery/materialization buffer; `FocusNode.FocusRestoreNoteId` is the map-continuity fallback across graph rebuilds.

- WebGL runtime serving is owned by `UnityWebglLocalServer`.
  The runtime is hosted locally from the selected runtime source, not from an external site.

### Bridge contract
The canonical plugin-side contract lives in:
- `docs/DATA_CONTRACT.md`
- `src/bridge/BridgeTypes.ts`
- `src/bridge/MessageValidator.ts`

Important current contract facts:
- protocol version is `2.0.0`;
- successful startup order is `bridge:ready` first, then `graph:set`;
- Unity WebGL boot failure is terminal inside the iframe wrapper and does not emit `bridge:ready`;
- runtime-to-plugin messages are `bridge:ready`, `graph:ready`, `note:open`, and `runtime:shutdown-complete`;
- plugin-to-runtime messages are `graph:set`, `runtime:status`, `note:focus`, and `runtime:shutdown`;
- `path` values must stay vault-relative and use `/` separators;
- `graph:set` carries the effective filtered graph; focus changes are sent separately via `note:focus`, which must include both `id` and `path`;
- ordinary `note:focus` dispatch is gated by the latest effective graph on the TypeScript side; active-note rename can bypass this gate to cover bridge ordering around path-derived ids;
- `graph:ready` must echo the latest `graph:set` `requestId` before the iframe clears the loading status;
- `runtime:status` updates iframe wrapper status text only and is not forwarded into Unity;
- `runtime:shutdown` is a bridge/runtime-wrapper lifecycle handshake, not a full Unity engine shutdown;
- `mapLayout` is an optional plugin-owned runtime hint;
- `renderScale` is a plugin-owned iframe startup hint and does not belong to the bridge payload contract;
- invalid outgoing payloads are rejected before dispatch;
- invalid incoming bridge messages are ignored with non-fatal error reporting.

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

- other `unity-webgl/Build/*` files and `unity-webgl/TemplateData/*`
  Role: local WebGL export staging artifacts
  Type: generated

- `main.js`
  Role: bundled plugin entry output
  Type: generated

Build and import flow:
1. Unity exports WebGL from `unity/ReverySkyMap`.
2. `scripts/import-unity-webgl.ps1` copies the export into `unity-webgl/` and regenerates runtime files used by all package modes.
3. `npm run build` builds the current `embedded-archive` release candidate from the prepared runtime and writes root `main.js`.
4. Local folder-runtime installs can be built with `npm run package:folder-runtime`.
5. Other release-shaped package modes can be built with `npm run package:embedded-html` or `npm run package:embedded-archive`.

## Verification
Detailed commands live in `docs/VERIFICATION.md`. This section only maps the main architecture areas to their checks.

- Entry path: command -> view -> runtime startup
  Automated checks: `npm run build`
  Manual checks: confirm the map command opens the custom view and the iframe starts successfully

- Handshake and bridge transport
  Automated checks: `npm run test`, especially `tests/bridge/*`
  Manual checks: verify `bridge:ready` -> `graph:set` flow in the map view

- View execution paths, filter state, editor-focus routing, and note-open flow
  Automated checks: `npm run test`, especially `tests/view/MapView.test.ts`, `tests/view/MapFilterPanelController.test.ts`, `tests/view/MarkdownEditorFocus.test.ts`, `tests/view/MapSession.test.ts`, and `tests/view/MapNoteOpenRouter.test.ts`
  Manual checks: open the map, click into a markdown note, change filters, reopen the map, and open a note from the runtime

- Map state persistence across close and reopen
  Automated checks: `npm run test`, especially `tests/main.test.ts`
  Manual checks: set filters, tags visibility, map layout, and render scale; close the map through the ribbon toggle; reopen it; then repeat after restarting Obsidian

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
