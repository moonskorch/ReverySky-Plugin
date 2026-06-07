# ReverySky Map for Obsidian - Architecture

## Purpose and Scope
ReverySky Map is an Obsidian desktop plugin that renders relationships between vault notes inside a Unity WebGL scene embedded in a custom Obsidian view.

Current in-scope behavior:
- open a dedicated map view from an Obsidian command;
- build a graph from markdown files and resolved links;
- let the view filter the effective graph before sending it to Unity;
- host the local WebGL runtime on `127.0.0.1`;
- round-trip note selection between Obsidian and the Unity runtime.

## System Overview
The system has three runtime boundaries:
1. Obsidian plugin code in TypeScript.
2. A loopback HTTP host that serves the WebGL package.
3. Unity runtime code compiled into the WebGL build.

Main system parts:

- Obsidian plugin shell
  Registers the custom view and the `Open ReverySky Map` command, and lazily creates the local WebGL server.
  Main code: `src/main.ts`
  Depends on: Obsidian `Plugin`, `WorkspaceLeaf`, `UnityWebglLocalServer`

- Map view shell
  Creates the iframe, wires the bridge lifecycle, and delegates filter UI and note-open routing to focused collaborators.
  Main code: `src/view/MapView.ts`
  Depends on: `MapSession`, `MapFilterPanelController`, `MapNoteOpenRouter`, `UnityIframeBridge`

- Map session and filter UI
  Owns persisted map state, graph refresh timing, focus precedence, filter derivation, and the transient filter-panel interaction state.
  Main code: `src/view/MapSession.ts`, `src/view/MapFilterPanelController.ts`
  Depends on: `VaultGraphBuilder`, `GraphPathFilter`, Obsidian workspace APIs, browser DOM events

- Graph extraction and normalization
  Converts vault files and resolved links into a stable graph payload with normalized paths, tags, dates, and note ids.
  Main code: `src/graph/VaultGraphBuilder.ts`, `src/graph/GraphNormalizer.ts`
  Depends on: Obsidian `vault` and `metadataCache`

- Bridge transport and validation
  Defines the cross-runtime contract, validates payloads, and delivers `postMessage` envelopes to and from the iframe.
  Main code: `src/bridge/BridgeTypes.ts`, `src/bridge/MessageValidator.ts`, `src/bridge/UnityIframeBridge.ts`
  Depends on: browser `postMessage`, protocol version `2.0.0`

- Local WebGL host
  Serves `unity-webgl/` over loopback HTTP and rejects path traversal or unsupported methods.
  Main code: `src/runtime/UnityWebglLocalServer.ts`
  Depends on: Node `http`, `fs`, `path`

- Unity runtime source
  Receives graph payloads, owns runtime graph state, rebuilds the scene, focuses notes, and requests note opening back in Obsidian.
  Main code: `unity/ReverySkyMap/Assets/Scripts/Bridge/*.cs`, `unity/ReverySkyMap/Assets/Scripts/DreamScape/*.cs`
  Depends on: `MapRuntimeContext`, `ObsidianBridge`, `Cartographer`, `FocusNode`

- Generated WebGL package
  Delivers the compiled runtime and host page used by the iframe.
  Main code: `unity-webgl/`, `unity-webgl/index.template.html`, `scripts/import-unity-webgl.ps1`
  Depends on: Unity WebGL export pipeline

## Execution Paths
Most plugin-side behavior now flows through a small shell in `MapView`, while `src/main.ts` owns plugin lifecycle, view activation, and persistence of the last map-view state. The main entry points are the plugin startup path, the map command, the view startup path, and incoming bridge messages from the runtime. The routes below show how control moves from those entry points through the code.

### Path 1. Command -> view activation -> iframe startup
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()`
   Loads persisted `mapViewState`, registers `MAP_VIEW_TYPE`, and registers the `open-reverysky-map` command.
2. `src/main.ts` -> command callback -> `activateMapView()`
   Finds an existing map leaf or creates one with `workspace.getRightLeaf(false)` and `leaf.setViewState(...)`, including the last persisted `mapViewState` when available.
3. Obsidian opens the custom view and calls `src/view/MapView.ts` -> `onOpen()`.
4. `MapView.onOpen()` starts `MapSession`, creates `MapFilterPanelController`, and calls `plugin.getUnityRuntimeUrl()`.
5. `src/main.ts` -> `getUnityRuntimeUrl()` lazily creates `UnityWebglLocalServer`, then calls `getBaseUrl()`.
6. `src/runtime/UnityWebglLocalServer.ts` -> `getBaseUrl()` -> `startServer()`
   Starts a loopback HTTP server and returns `http://127.0.0.1:<port>/index.html`.
7. `MapView.onOpen()` creates the iframe with that URL and waits for the iframe `load` event.
8. On iframe load, `MapView.onOpen()` calls `bridge.attach(iframe.contentWindow, callbacks)`.

### Path 2. Handshake -> graph build -> postMessage -> Unity ingest
1. The runtime posts `bridge:ready`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the incoming message and calls the registered `onReady` callback.
3. `src/view/MapView.ts` -> `session.setBridgeReady(true)` -> `session.flushOrRefresh()`
   Starts the first graph emission or flushes the latest queued graph if refresh work already happened before the handshake.
4. `src/view/MapSession.ts` -> `refreshGraphNow()` -> `emitGraphFromSource()`
   Rebuilds the source graph, applies the active filter, applies `showTags`, and includes `enginePreference`.
5. `src/graph/VaultGraphBuilder.ts` -> `build(app)`
   Reads markdown files from the vault, derives stable note ids, normalizes tags and paths, and builds links from `metadataCache.resolvedLinks`.
6. `src/view/MapView.ts` -> `bridge.sendGraphSet(outgoingPayload)`
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Validates the payload with `MessageValidator`, builds a `graph:set` envelope, and calls `iframeWindow.postMessage(...)`.
8. Unity receives `graph:set`, updates `MapRuntimeContext`, and rebuilds the visible graph through `Cartographer`.

### Path 3. Vault or UI change -> filtered graph refresh
1. `MapSession` registers vault and workspace listeners during startup, and `MapFilterPanelController` registers filter-panel DOM listeners when the view renders.
2. A graph-significant change happens:
   vault metadata changes, path filter input changes, tag visibility toggles, or engine preference changes.
3. `src/view/MapFilterPanelController.ts` updates session-owned state through `MapSession.setFilterQuery()`, `setShowTags()`, or `setEnginePreference()`.
4. `src/view/MapSession.ts` re-enters `emitGraphFromSource()`.
5. `src/graph/GraphPathFilter.ts`
   Parses the query and returns the filtered `GraphPayload` subset.
6. `src/view/MapView.ts` receives the `sendGraph` callback from `MapSession`, forwards the payload through `UnityIframeBridge`, and asks `MapFilterPanelController` to refresh visible suggestions when needed.
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Sends the effective graph that Unity should render now.

### Path 4. Unity note-open request -> Obsidian note open
1. Unity sends `note:open`.
2. `src/bridge/UnityIframeBridge.ts` -> `onMessage()`
   Validates the message and calls `onNoteOpen(payload)`.
3. `src/view/MapView.ts` -> `MapNoteOpenRouter.openRequestedNote(payload)`
4. `src/view/MapNoteOpenRouter.ts` resolves the target note by id and path, chooses the target leaf, and calls `app.workspace.openLinkText(...)`.
5. Control returns to Obsidian, which opens or focuses the requested note.

### Path 5. Toggle close or plugin unload -> capture map state -> next open restore
1. `src/main.ts` -> ribbon callback -> `toggleMapView()`, or `src/main.ts` -> `onunload()`.
2. `src/main.ts` -> `captureAndPersistMapViewState()`
   Reads `leaf.view.getState()` from the current map leaf when present and writes the result through `saveData(...)`.
3. `workspace.detachLeavesOfType(MAP_VIEW_TYPE)` removes the active map leaves.
4. On a later startup or `toggleMapView()` reopen, `ReverySkyMapPlugin.onload()` and `activateMapView()` reuse `lastMapViewState`.
5. `leaf.setViewState({ type: MAP_VIEW_TYPE, active: true, state })` hands the persisted state back to `MapView`, which then forwards it into `MapSession.setState(...)`.

### Key plugin-side control points

- `src/main.ts` -> `ReverySkyMapPlugin`
  Owns plugin startup, command registration, view activation, persistence of the last map-view state, and lazy runtime-server creation.

- `src/view/MapView.ts` -> `MapView`
  Owns the shell execution paths after the view exists: iframe startup, bridge wiring, and collaborator orchestration.

- `src/view/MapSession.ts` -> `MapSession`
  Owns persisted map state, graph refresh timing, graph emission, and note-focus precedence.

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

- `pathFilterQuery`, `showTags`, and `enginePreference` are owned by `MapSession`.
  They are persisted as view state and re-applied on open.

- The most recently closed map-view state is owned by `ReverySkyMapPlugin`.
  It is stored as plugin data under `mapViewState`, then handed back into a newly created map leaf on the next open.

- Filter panel visibility, active suggestion pane, and hide-delay timers are owned by `MapFilterPanelController`.
  They are UI-only transient state and are intentionally not persisted in plugin data.

- Runtime notes, links, selected note, and graph layout are owned by the Unity runtime.
  They are stored in `MapRuntimeContext` and consumed by `Cartographer`.

- WebGL file serving is owned by `UnityWebglLocalServer`.
  The runtime is hosted locally, not from an external site.

### Bridge contract
The canonical plugin-side contract lives in:
- `docs/DATA_CONTRACT.md`
- `src/bridge/BridgeTypes.ts`
- `src/bridge/MessageValidator.ts`

Important current contract facts:
- protocol version is `2.0.0`;
- startup order is `bridge:ready` first, then `graph:set`;
- `path` values must stay vault-relative and use `/` separators;
- `graph:set` carries the effective filtered graph;
- `enginePreference` is an optional plugin-owned runtime hint;
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

- `unity-webgl/index.html`
  Role: local runtime host page
  Type: generated

- `unity-webgl/Build/*` and `unity-webgl/TemplateData/*`
  Role: WebGL export artifacts
  Type: generated

- `main.js`
  Role: bundled plugin entry output
  Type: generated

Build and import flow:
1. `npm run build` validates TypeScript and writes `main.js`.
2. Unity exports WebGL from `unity/ReverySkyMap`.
3. `scripts/import-unity-webgl.ps1` copies the export into `unity-webgl/` and regenerates runtime files used by the plugin.
4. At runtime the plugin starts `UnityWebglLocalServer`, and the iframe loads the served `index.html`.

## Verification
Detailed commands live in `docs/VERIFICATION.md`. This section only maps the main architecture areas to their checks.

- Entry path: command -> view -> runtime startup
  Automated checks: `npm run build`
  Manual checks: confirm the map command opens the custom view and the iframe starts successfully

- Handshake and bridge transport
  Automated checks: `npm run test`, especially `tests/bridge/*`
  Manual checks: verify `bridge:ready` -> `graph:set` flow in the map view

- View execution paths, filter state, and note-open flow
  Automated checks: `npm run test`, especially `tests/view/MapView.test.ts`, `tests/view/MapFilterPanelController.test.ts`, and `tests/view/MapNoteOpenRouter.test.ts`
  Manual checks: open the map, change filters, reopen the map, and open a note from the runtime

- Map state persistence across close and reopen
  Automated checks: `npm run test`, especially `tests/main.test.ts`
  Manual checks: set filters, tags visibility, and engine preference; close the map through the ribbon toggle; reopen it; then repeat after restarting Obsidian

- Visual plugin UI states
  Automated checks: `npm run test:ui-visual` when UI changed
  Manual checks: review screenshots for search/filter controls and toggles

- Unity runtime source changes
  Automated checks: Unity-side tests when available
  Manual checks: open the Unity project, enter Play mode, and verify runtime behavior

## Known Risks and Open Questions
- There is no repository-defined CI, so architecture regressions depend on local verification discipline.
- TypeScript tests cover the plugin side well enough to show intent, but they do not prove the packaged Unity WebGL build is fresh.
- Unity runtime quality depends on a new export plus a correct `scripts/import-unity-webgl.ps1` import step after Unity-side changes.
- The repository contains both source-of-truth docs and generated runtime assets; future work must keep those boundaries explicit to avoid editing generated files as if they were source.
