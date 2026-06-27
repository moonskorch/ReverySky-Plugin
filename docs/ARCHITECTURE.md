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
  Owns persisted map state, graph refresh timing, focus precedence, filter derivation, render-scale preference, and the transient filter-panel interaction state.
  Main code: `src/view/MapSession.ts`, `src/view/MapFilterPanelController.ts`
  Depends on: `VaultGraphBuilder`, `GraphPathFilter`, Obsidian workspace APIs, browser DOM events

- Markdown editor focus adapter
  Translates markdown editor focus updates into the same map-focus path used by active-leaf changes.
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
- `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html` - contain the iframe JavaScript wrapper. This wrapper listens for `postMessage` events, calls `unityInstance.SendMessage(...)`, and posts runtime events back to `window.parent`.
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
   Loads persisted `mapViewState`, registers `MAP_VIEW_TYPE`, and registers the `open-map` command.
2. `src/main.ts` -> command callback -> `activateMapView()`
   Finds an existing map leaf or creates one with `workspace.getRightLeaf(false)` and `leaf.setViewState(...)`, including the last persisted `mapViewState` when available.
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
1. The runtime posts `bridge:ready`.
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
8. Unity receives `graph:set`, replaces the runtime graph snapshot, rebuilds through `Cartographer`, and restores focus only from `FocusNode.LastSelectedStarId`; missing focus resets the camera.

`graph:set` and `note:focus` are latest-intent messages, not durable queues.
Before `bridge:ready`, `MapSession` keeps only the latest pending graph payload.
When an incremental Unity engine has not materialized a target star yet, `Cartographer.FocusRuntimeNote(...)` stores the target in `MapRuntimeContext.PendingFocusNoteId` and `RecursiveHubs` retries it after construction.

### Path 3. Vault or UI change -> filtered graph refresh
1. `MapSession` registers vault and workspace listeners during startup, and `MapFilterPanelController` registers filter-panel DOM listeners when the view renders.
2. A graph-significant change happens:
   vault metadata changes, path filter input changes, tag visibility toggles, or map layout changes.
3. `src/view/MapFilterPanelController.ts` updates session-owned state through `MapSession.setFilterQuery()`, `setShowTags()`, or `MapSession.setMapLayoutPreference()`.
4. `src/view/MapSession.ts` re-enters `emitGraphFromSource()`.
5. `src/graph/GraphPathFilter.ts`
   Parses the query and returns the filtered `GraphPayload` subset.
6. `src/view/MapView.ts` receives the `sendGraph` callback from `MapSession`, forwards the payload through `UnityIframeBridge`, and asks `MapFilterPanelController` to refresh visible suggestions when needed.
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Sends the effective graph that Unity should render now.

Render-scale changes are intentionally different from graph-significant changes. `MapFilterPanelController` calls `MapSession.setRenderScale()`, which updates persisted state and UI restart guidance without re-emitting `graph:set`; the new scale is applied the next time the iframe is created.

### Path 4. Markdown editor focus -> map focus
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` -> `registerEditorExtension(...)`
   Registers `createMarkdownEditorFocusExtension(...)` once at plugin scope so the plugin can hear focus changes from any open markdown editor.
2. `src/view/MarkdownEditorFocus.ts` -> `EditorView.updateListener.of(...)`
   Watches CodeMirror updates and ignores everything except a real markdown-editor focus gain with a resolvable vault path.
3. `src/main.ts` -> callback -> `requestEditorFocus(path)`
   Routes the focused path to every open map view of `MAP_VIEW_TYPE`.
4. `src/view/MapView.ts` -> `requestEditorFocus(path)` -> `MapSession.requestEditorFocus(path)`
   The view shell does not decide focus policy; it only forwards the signal into session state.
5. `src/view/MapSession.ts` -> `requestMarkdownFocus(path)` -> `dispatchPreferredFocus(...)`
   Stores the latest active markdown path, updates the active focus freshness counter, and reuses the same focus-precedence path already used by `active-leaf-change`.
6. `src/bridge/UnityIframeBridge.ts` -> `sendNoteFocus(...)`
   Sends `note:focus` only when the current effective graph still contains the matching note.

This path is intentionally separate from graph refresh. It updates the runtime's focus target without rebuilding the graph unless some other change already triggered a refresh.

### Path 5. Unity note-open request -> Obsidian note open
1. Unity sends `note:open`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the message and calls `onNoteOpen(payload)`.
3. `src/view/MapView.ts` -> `MapNoteOpenRouter.openRequestedNote(payload)`
4. `src/view/MapNoteOpenRouter.ts` resolves the target note from the required `id` and `path`, passes the current markdown path only as `openLinkText(...)` link context, and leaves final navigation routing to Obsidian.
5. Control returns to Obsidian, which opens or focuses the requested note.

### Path 6. Toggle close or plugin unload -> capture map state -> next open restore
1. `src/main.ts` -> ribbon callback -> `toggleMapView()`, or `src/main.ts` -> `onunload()`.
2. `src/main.ts` -> `captureAndPersistMapViewState()`
   Reads `leaf.view.getState()` from the current map leaf when present and writes the result through `saveData(...)`.
3. During an explicit toggle close, `workspace.detachLeavesOfType(MAP_VIEW_TYPE)` removes the active map leaves.
4. During plugin unload, the plugin leaves existing map leaves attached so Obsidian can preserve their user-chosen workspace location.
5. On a later startup or `toggleMapView()` reopen, `ReverySkyMapPlugin.onload()` and `activateMapView()` reuse `lastMapViewState`.
6. `leaf.setViewState({ type: MAP_VIEW_TYPE, active: true, state })` hands the persisted state back to `MapView`, which then forwards it into `MapSession.setState(...)`.
7. Persisted view state currently includes `pathFilterQuery`, `showTags`, `mapLayout`, and `renderScale`.

### Key plugin-side control points

- `src/main.ts` -> `ReverySkyMapPlugin`
  Owns plugin startup, command registration, view activation, persistence of the last map-view state, and lazy runtime-server creation.

- `src/view/MapView.ts` -> `MapView`
  Owns the shell execution paths after the view exists: iframe startup, bridge wiring, and collaborator orchestration.

- `src/view/MapSession.ts` -> `MapSession`
  Owns persisted map state, graph refresh timing, graph emission, note-focus precedence, and render-scale restart tracking.

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

- `src/bridge/UnityIframeBridge.ts` -> `attach()`, `sendGraphSet()`, `sendNoteFocus()`, `onMessage()`
  Owns browser-side message transport and validation handoff points.

- `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()`, `startServer()`, `handleRequest()`
  Owns runtime hosting and the boundary between plugin code and generated WebGL assets.

## State Ownership and Contracts
### Ownership rules

- Raw vault files, metadata cache, and resolved links are owned by Obsidian.
  They are the source of truth for note existence and links.

- Stable note ids, normalized paths, normalized tags, and canonical note date are owned by the TypeScript graph layer.
  They are built in `VaultGraphBuilder` and `GraphNormalizer`.

- The effective graph after filters is owned by `MapSession`.
  The session emits the filtered payload that Unity receives through the shell view.

- `pathFilterQuery`, `showTags`, `mapLayout`, and `renderScale` are owned by `MapSession`.
  They are persisted as view state and re-applied on open.

- Current markdown editor focus is also owned by `MapSession`.
  The session records the latest focused markdown path and uses it as the steady-state focus source unless a newer created-note focus is still pending.

- `renderScale` is applied at iframe startup, not through the bridge.
  `MapSession` tracks the selected value and whether it differs from the currently applied iframe value so the UI can ask the user to reopen the map.

- The most recently closed map-view state is owned by `ReverySkyMapPlugin`.
  It is stored as plugin data under `mapViewState`, then handed back into a newly created map leaf on the next open.

- Filter panel visibility, active suggestion pane, and hide-delay timers are owned by `MapFilterPanelController`.
  They are UI-only transient state and are intentionally not persisted in plugin data.

- Runtime notes, links, tag names, runtime mode, pending focus note id, and layout preference are owned by the Unity runtime.
  They are stored in `MapRuntimeContext` and consumed by `Cartographer`.

- WebGL runtime serving is owned by `UnityWebglLocalServer`.
  The runtime is hosted locally from the selected runtime source, not from an external site.

### Bridge contract
The canonical plugin-side contract lives in:
- `docs/DATA_CONTRACT.md`
- `src/bridge/BridgeTypes.ts`
- `src/bridge/MessageValidator.ts`

Important current contract facts:
- protocol version is `2.0.0`;
- startup order is `bridge:ready` first, then `graph:set`;
- runtime-to-plugin messages are `bridge:ready`, `note:open`, and `runtime:shutdown-complete`;
- plugin-to-runtime messages are `graph:set`, `note:focus`, and `runtime:shutdown`;
- `path` values must stay vault-relative and use `/` separators;
- `graph:set` carries the effective filtered graph; focus changes are sent separately via `note:focus`, which must include both `id` and `path`;
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
