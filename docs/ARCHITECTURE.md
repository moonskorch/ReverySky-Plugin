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

The primary workflow is one graph leaf opened by the plugin command.
Duplicate graph leaves can exist through Obsidian workspace restore, popouts, or manual workspace manipulation.
They should remain operable, but they are treated as a recovery case rather than the main interaction model.

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
  Owns per-view live graph state, graph refresh timing, metadata-resolution gating, Ego scope, filters, render-scale preference, and transient filter-panel interaction state.
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
  Main code:
  `src/runtime/UnityWebglLocalServer.ts`,
  `src/runtime/EmbeddedUnityRuntimeInstaller.ts`,
  `src/runtime/EmbeddedUnityRuntimeArchive.ts`,
  `src/runtime/EmbeddedUnityIndexHtml.ts`,
  `src/runtime/WhatsNewFile.ts`
  Depends on: Node `http`, `fs`, `path`, embedded runtime payload helpers

- What's New announcement flow
  Packages one versioned Markdown announcement into the `embedded-archive` runtime.
  Opens it in a plugin-owned view after fresh extraction and persists the shown version in plugin data.
  Main code: `scripts/whats-new-selection.mjs`, `scripts/package-embedded-archive.mjs`, `src/main.ts`, `src/runtime/WhatsNewFile.ts`, `src/view/WhatsNewView.ts`
  Depends on: root `manifest.json`, `whats-new/*.md`, Obsidian `ItemView`, `MarkdownRenderer`, plugin `loadData()` / `saveData()`

- Unity runtime source
  Receives graph payloads, owns runtime graph state, rebuilds the scene, focuses notes, and requests note opening back in Obsidian.
  Main code: `unity/ReverySkyMap/Assets/Scripts/Bridge/*.cs`, `unity/ReverySkyMap/Assets/Scripts/StarScape/*.cs`, `unity/ReverySkyMap/Assets/Scripts/Interfaces/*.cs`
  Depends on: `MapRuntimeContext`, `ObsidianBridge`, `Cartographer`, `FocusNode`

- Generated WebGL package
  Delivers the compiled runtime and host page used by the iframe.
  Most of `unity-webgl/` is generated staging output.
  Compact `embedded-archive` runtime input under `unity-webgl/Build/runtime-*` and `build-config.json` is tracked intentionally.
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

## Runtime Boundaries

Runtime hosting and bridge messaging are separate paths.

Local HTTP hosting:
- `UnityWebglLocalServer` serves only the selected WebGL runtime source.
- Runtime source can be `folder-runtime`, in-memory `embedded-html`, or extracted `embedded-archive` cache.
- `getUnityRuntimeUrl()` serializes cold startup so concurrent graph leaves share one startup.
- Graph-view leases keep the loopback server alive until the last graph leaf closes.
- The server exposes `http://127.0.0.1:<port>/index.html`, rejects traversal and unsupported methods, and does not build graphs or send bridge messages.

Iframe startup hints:
- `MapView.createRuntimeIframeSrc(...)` appends cache-busting `t` and `renderScale`.
- `renderScale` is read by the wrapper before `createUnityInstance(...)`.
- `renderScale` is not bridge data.

Bridge messaging:
- TypeScript sends live data through iframe `postMessage`.
- The host template wrapper forwards Unity-bound messages through `unityInstance.SendMessage(...)`.
- `ObsidianBridge.cs` receives graph, focus, and settings calls and updates `MapRuntimeContext`.
- Runtime events travel back through wrapper callbacks and `window.parent.postMessage(...)`.

Bridge implementation:
- `src/view/MapView.ts` attaches the bridge to `iframe.contentWindow`.
- `src/bridge/UnityIframeBridge.ts` validates and routes messages.
- `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html` implement wrapper forwarding, status text, screenshots, and shutdown replies.
- `unity/ReverySkyMap/Assets/Scripts/Bridge/ObsidianBridge.cs` receives Unity-bound calls and emits note/tag events.

Unity bridge lifetime:
- `ObsidianBridge.EnsureInstance()` creates a persistent runtime service object named `ObsidianBridge`.
- The object name is part of the JavaScript-to-Unity contract because the wrapper calls `unityInstance.SendMessage("ObsidianBridge", "OnGraphSet", json)`.

## Execution Paths
Most plugin-side behavior flows through `MapView`.
`src/main.ts` owns plugin lifecycle, runtime startup, and persistence of the last graph-view state.
Command wiring is delegated to `src/commands/MapCommands.ts`.
The main entry points are plugin startup, the graph command, view startup, and incoming bridge messages from the runtime.

### Path 1. Command -> view activation -> iframe startup
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()`
   Loads plugin data `mapViewState` and `whatsNewShownVersion`, registers `MAP_VIEW_TYPE`, registers `WHATS_NEW_VIEW_TYPE`, and registers the `open-map` command.
2. `src/commands/MapCommands.ts` -> `activateMapView()`
   Finds an existing graph leaf or creates one with `workspace.getRightLeaf(false)` and `leaf.setViewState(...)`.
   The plugin intentionally opens and owns a single graph leaf: repeated open actions reveal the existing leaf instead of creating another one.
   Some cleanup and focus paths use Obsidian's array-based leaf APIs defensively.
   Duplicate ReverySky 3D Graph leaves should keep working through the shared runtime server, but they are a recovery case.
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
   The helper reads root `manifest.json`, scans source `whats-new/*.md`, and parses only `x.y.z.md` names.
   It selects the highest semantic version that does not exceed `manifest.version`.
2. The package script copies only that selected file into the archive as `unity-webgl/whats-new/<version>.md`.
   Older source files may remain in the repository; they are not all copied into a release archive.
3. `src/main.ts` -> `getUnityRuntimeUrl()` calls `EmbeddedUnityRuntimeInstaller.resolveRuntimeDirectory(pluginDir, manifest.version)` for `embedded-archive` builds.
4. `src/runtime/EmbeddedUnityRuntimeInstaller.ts` returns `extracted: true` only when the current plugin version cache was rebuilt from the archive.
   Reused caches, folder-runtime installs, and embedded-html installs return or follow paths that do not trigger What's New.
5. On `extracted: true`, `src/main.ts` calls `showWhatsNew(runtimeDir)`.
   `showWhatsNew(...)` reads `runtimeDir/whats-new/`.
   The runtime reader chooses the newest valid versioned Markdown file when several are present.
   The flow exits when there is no file or the selected version is not newer than `whatsNewShownVersion`.
   Otherwise it opens `WHATS_NEW_VIEW_TYPE` in a new tab.
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
5. `src/graph/VaultGraphBuilder.ts` -> `build(app, landmarkSource)`
   Reads markdown files from the vault, derives stable note ids, normalizes tags and paths, reads `notes[].buildings` from the selected frontmatter landmark source, adds date and byte-size fields, and builds links from `metadataCache.resolvedLinks`.
6. `src/view/MapView.ts` -> `bridge.sendGraphSet(outgoingPayload)`
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Validates the payload with `MessageValidator`, builds a `graph:set` envelope, and calls `iframeWindow.postMessage(...)`.
8. Unity receives `graph:set`, replaces the runtime graph snapshot, rebuilds through `Cartographer`, and publishes `MapGraphIndex`.
   Focus reconciliation tries pending focus first, then `FocusNode.FocusRestoreNoteId`, then reset.
9. When the active Unity engine reaches its ready point, Unity emits `graph:ready` with the matching `requestId`.
   The iframe status UI ignores stale ready messages and clears `loading...` only for the latest `graph:set`.

`graph:set` and `note:focus` are latest-intent messages, not durable queues.
Before `bridge:ready`, `MapSession` keeps only the latest pending graph payload.
After a graph has been emitted, `MapSession` keeps the latest effective `GraphPayload`.
When the runtime becomes unavailable during iframe restart or window migration, `MapSession` flushes pending source-refresh, filter, and graph-settings debounce work.
The next `bridge:ready` can then replay the latest graph.
Global focus requires membership in that payload; Ego focus can change the effective graph center instead.
Active-note rename is the intentional Global gate exception: the new path can arrive before Unity ingests the renamed graph.
Startup focus uses a dedicated ordering path:
- Ego mode accepts the active note before the initial `graph:set`.
- Global mode keeps the membership check against the emitted effective graph before sending `note:focus`.

The first graph build reads the current Obsidian `metadataCache.resolvedLinks` snapshot.
The first following `metadataCache.resolved` event may refresh cached vault graph data from settled links.
Graph-relevant live metadata changes use the `metadataCache.resolved` barrier described below.
Markdown editor focus primes the graph-relevant signature for that note from the current file cache.
This keeps the first content-only edit after focus from looking like a tags/links change.
If Unity WebGL boot fails, the iframe wrapper treats the failure as terminal for that iframe.
It keeps the failure status visible and does not emit `bridge:ready` or receive `graph:set`.
When Unity receives `note:focus` before the target star is present in `MapGraphIndex`, focus is deferred.
`Cartographer.FocusRuntimeNote(...)` stores the note id in `MapRuntimeContext.PendingFocusNoteId`.
The next non-transient graph-index publication applies pending focus once, then falls back to restore focus, then resets.

Graph emission timing is grouped by event intent:

- Immediate `graph:set`:
  runtime `bridge:ready` and Ego focus changes.
- Debounced `graph:set`:
  text filter input waits 500 ms.
  vault create/delete/rename and metadata-resolved source refreshes wait 250 ms.
  graph-setting changes wait 250 ms before rebuilding and sending the latest effective graph.
- No immediate `graph:set`:
  Global focus sends only `note:focus`.
  metadata changes limited to the selected landmark source send `note:update`.
  active-note rename sends only `note:focus` immediately and lets the scheduled rename rebuild send the fresh graph.
  render scale waits for iframe reopen.
  frame-rate mode sends `runtime:settings`.

### Path 3. Vault or UI change -> effective graph refresh
1. `MapSession` registers vault and workspace listeners during startup, and `MapFilterPanelController` registers filter-panel DOM listeners when the view renders.
2. A graph-significant change happens:
   vault metadata changes, path filter input changes, tag visibility toggles, Ego option changes, or layout changes.
3. `src/view/MapFilterPanelController.ts` updates session-owned state through `MapSession.setFilterQuery()`, `setShowTags()`, `setMapLayoutPreference()`, or Ego setting setters.
4. For valid filter, tag-visibility, Ego, and layout changes, `src/view/MapSession.ts` rebuilds the outgoing graph from the latest source graph snapshot.
   It sends the payload when the bridge is ready.
   Invalid filter input updates UI and persistence state but does not emit `graph:set`.
5. `src/graph/GraphQueryFilter.ts`
   Parses the query and returns the filtered `GraphPayload` subset.
   When Ego scope is enabled, `MapSession` first applies the query while retaining the Ego center.
   It then builds Ego scope inside that query-visible subset.
6. `src/view/MapView.ts` receives the `sendGraph` callback from `MapSession`.
   It forwards the payload through `UnityIframeBridge` and asks `MapFilterPanelController` to refresh visible suggestions when needed.
7. `src/bridge/UnityIframeBridge.ts` -> `sendGraphSet()`
   Sends the effective graph that Unity should render now.

Important refresh rules:
- Graph-relevant metadata changes first send `runtime:status` with `Updating graph data...`.
- Live rebuilds wait for `metadataCache.resolved` before reading `metadataCache.resolvedLinks`.
- Startup may spend one unconditional post-initial-graph `metadataCache.resolved` refresh without showing update status.
- Filter input waits 500 ms before graph emission.
- Vault create/delete/rename, metadata-resolved refreshes, and graph setting changes wait 250 ms.

Ego scope:
- `MapSession.buildEgoGraphScope(...)` builds undirected adjacency from resolved note links.
- Breadth-first search starts at `focusPath` and includes notes at distances `0..egoDepth`.
- With `egoNeighborLinksEnabled` disabled, links must connect different depth rings and reach inward from a non-boundary ring.
- With `egoNeighborLinksEnabled` enabled, every note-note link inside the included scope is retained.

Tag visibility:
- Query filtering runs before Ego tag-line trimming, so `tag:` filters see real note metadata.
- When `showTags` is disabled, emitted note tags are cleared.
- In Ego scope with neighbor links enabled, boundary-ring notes keep only tags visible from an inner ring.
- In Ego scope without neighbor links, emitted tags represent owner/discovery lines and boundary-ring notes do not introduce or reconnect tag lines.

Non-graph settings:
- `renderScale` updates session state and persistence but waits for iframe recreation.
- `frameRateMode` sends `runtime:settings` after bridge readiness.
- Unity applies frame-rate settings in `ObsidianBridge.OnRuntimeSettings(...)` without rebuilding graph state.
- `Auto` frame-rate uses `vSyncCount = 1` and `Application.targetFrameRate = -1`; Obsidian/Electron may still cap WebGL cadence below the physical display rate.

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

In Global mode, this path is intentionally separate from graph refresh.
It updates the runtime's focus target without rebuilding the graph.
Editor or file-open focus for notes outside the current effective graph is ignored on the TypeScript side.
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
4. `src/view/MapNoteOpenRouter.ts` resolves the target note from the required `id` and `path`.
   It passes the current markdown path only as `openLinkText(...)` link context.
   Final navigation routing stays with Obsidian.
5. Before calling `openLinkText(...)`, `MapNoteOpenRouter` records the target as current plugin-side graph focus.
   It also marks the target path in the same focus gate used by normal Obsidian focus routing.
6. Control returns to Obsidian, which opens or focuses the requested note.
7. If Obsidian emits `file-open` or markdown editor focus for that same path within the 300 ms gate, `MapFocusController` consumes it and does not send `note:focus` back to Unity.

### Focus scenarios

Focus requests are accepted only after bridge readiness.
Global focus also requires membership in the latest effective graph.
Ego focus updates `focusPath`, rebuilds the scoped graph only when the center changes, then sends `note:focus`.

- Startup:
  `MapSession.handleRuntimeReady()` reads the active markdown file.
  Ego startup accepts focus before initial graph emission.
  Global startup focus is checked against the emitted effective graph.

- Editor focus and active-file changes:
  `handleMarkdownEditorFocusUpdate(...)` and `MapFocusController` route focus through the same duplicate-suppression gate.
  Accepted focus ends at `UnityIframeBridge.sendNoteFocus(...)`.

- Content-only edits:
  Markdown focus primes the note metadata signature.
  Later `metadataCache.changed` events compare tags and outgoing links only.
  Unchanged signatures do not emit `graph:set` or `note:focus`.
  Size-only and date-only changes are picked up by a later graph rebuild.

- Graph-relevant metadata changes:
  Changed tags or outgoing links mark semantic refresh pending.
  The session sends `runtime:status` with `Updating graph data...`.
  It waits for `metadataCache.resolved`, rebuilds from `resolvedLinks`, and sends a fresh effective `graph:set`.

- Filter and layout changes:
  Valid filter, tag visibility, Ego, and layout changes rebuild the effective graph. Unity then restores pending focus, visible `FocusRestoreNoteId`, or resets cleanly.

- Create, rename, and delete:
  Creates schedule graph refresh and rely on later Obsidian focus to focus the new note.
  Rename preserves focus only when the old path matches `focusPath`, using `skipGraphCheck` and `skipEgoGraphRebuild`.
  Delete has no separate focus route; Unity restores visible focus or resets.

- Unity note open:
  `FocusNode.HandleTouch(...)` requests note open through `MapRuntimeContext` and `ObsidianBridge`.
  `MapNoteOpenRouter.handleNoteOpenRequest(...)` resolves the note and lets Obsidian perform navigation.

- Unity tag activate:
  Global mode clears note focus. Ego mode suspends visible note focus while keeping the Ego center; the next in-Ego `graph:set` restores center focus unless Ego is disabled first.

### Path 6. Settings persistence -> next open restore
1. `src/main.ts` -> `ReverySkyMapPlugin.onload()` reads plugin data with `loadData()` and stores `mapViewState` in the plugin-owned `mapViewState` snapshot.
2. New `MapView` instances receive that snapshot as `initialState`.
3. `src/view/MapView.ts` -> `MapView.onOpen()` applies `initialState` to `MapSession`.
4. `src/view/MapSession.ts` reports user setting changes through `onStateChanged(...)`.
5. Filter text changes update the in-memory snapshot immediately and reuse the filter debounce before requesting `saveData(...)`.
6. Render-scale slider input updates the in-memory snapshot immediately and requests `saveData(...)` on slider commit.
7. Other graph setting changes update the in-memory snapshot immediately and request `saveData(...)` directly.
   Live `graph:set` emission is coalesced by the graph-settings debounce.
8. `toggleMapView()` close, `onunload()`, and workspace `quit` flush the latest in-memory snapshot before shutdown paths continue.
9. Obsidian workspace view state is intentionally not used as a persistence source for `filterQuery`, `showTags`, `mapLayout`, or `renderScale`.

Open graph leaves do not share live filter state.
Each leaf's `MapSession` owns its current filter, effective graph, bridge readiness, and timers.
Persistence remains one plugin-level snapshot, so later opens restore the most recently reported settings rather than per-window settings.

### Path 7. View close -> bridge shutdown -> runtime lease release
1. `src/view/MapView.ts` -> `MapView.onClose()`
   Stops the `MapSession`, cancels deferred iframe rendering, disposes the runtime shell, and calls `bridge.shutdown(300)`.
2. `src/bridge/UnityIframeBridge.ts` -> `shutdown(...)`
   Sends `runtime:shutdown` with a generated `requestId` to the attached iframe and waits for a matching `runtime:shutdown-complete` or timeout.
3. `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html`
   The iframe wrapper enters shutdown mode and removes wrapper-owned bridge listeners.
   It sends `runtime:shutdown` to Unity as a guard and replies to the parent with `runtime:shutdown-complete`.
4. `unity/ReverySkyMap/Assets/Scripts/Bridge/ObsidianBridge.cs`
   Treats shutdown as a bridge guard so later `graph:set`, `note:focus`, and note-open sends are ignored by that runtime bridge instance.
5. `MapView.onClose()` detaches the bridge and clears the view content if no newer open lifecycle replaced the closing iframe.
6. `src/main.ts` -> graph lifecycle close callback -> `releaseUnityRuntimeLease(...)`
   Releases the view lease; `stopUnityRuntimeServer()` stops the shared loopback server only after the last open graph leaf releases its lease.

### Key plugin-side control points

- Lifecycle, persistence, and runtime leases:
  `ReverySkyMapPlugin` in `src/main.ts`.

- Command callbacks:
  `registerCommands(...)`, `activateMapView(...)`, `toggleMapView(...)`, and `forwardFocusToViews(...)` in `src/commands/MapCommands.ts`.

- View shell:
  `MapView` in `src/view/MapView.ts`.

- Per-view graph and focus policy:
  `MapSession` in `src/view/MapSession.ts` and `MapFocusController` in `src/view/MapFocusController.ts`.

- Filter UI:
  `MapFilterPanelController` and `MapFilterSuggestionsController` in `src/view/`.

- Graph extraction and filtering:
  `VaultGraphBuilder.build(app)`, `GraphNormalizer`, and `GraphQueryFilter` in `src/graph/`.

- Bridge and runtime hosting:
  `UnityIframeBridge` in `src/bridge/UnityIframeBridge.ts` and `UnityWebglLocalServer` in `src/runtime/UnityWebglLocalServer.ts`.

## State Ownership and Contracts
### Ownership rules

- Raw vault files, metadata cache, and resolved links are owned by Obsidian.
  They are the source of truth for note existence and links. `MapSession` waits for `metadataCache.resolved` before live graph rebuilds that depend on `resolvedLinks`.

- Stable note ids, normalized paths, normalized tags, canonical note date, and byte-size value are owned by the TypeScript graph layer.
  They are built in `VaultGraphBuilder` and `GraphNormalizer`.

- The source graph and effective graph are both owned by `MapSession`.
  `sourceGraphPayload` is the full vault snapshot.
  `outgoingGraphPayload` is the effective Unity payload after query filtering, optional Ego scope, tag visibility, and layout hint.
  Each open graph leaf owns its own live session state.

- `filterQuery`, `showTags`, `mapLayout`, `renderScale`, `landmarkSource`, and Ego settings are owned by `MapSession`.
  They are live per-view while the leaf is open. `ReverySkyMapPlugin` stores one latest snapshot under `mapViewState` and applies it to later opens.

- The selected landmark source defaults to `landmarks` and is used by both graph extraction and editor-side `Add to <property name>` writes.
  Changing it clears cached metadata signatures, re-reads current frontmatter values into the source graph, rebuilds the effective graph, and sends the latest payload.
  Metadata changes that affect only the normalized landmark list for the selected source update cached `buildings` values and dispatch `note:update` instead of waiting for a full graph rebuild.

- Ego settings are fully active in the effective graph pipeline.
  `egoEnabled` chooses global or scoped payloads.
  `egoDepth` controls breadth-first expansion from the focused note.
  `egoNeighborLinksEnabled` controls whether same-ring and cross-neighborhood links inside the scope are retained.

- Markdown focus events are routed by `MapFocusController`.
  It keeps no focus history or queue.
  Its short-lived path gate collapses duplicate Obsidian focus signals and consumes expected Unity-open or rename echoes before emitting focus intent to `MapSession`.

- Bridge focus dispatch is owned by `MapSession`.
  Global focus is gated by the latest effective graph.
  Ego focus uses `focusPath` as the center and rebuilds only when that center changes.
  Tag activation clears Global focus.
  In Ego mode, tag activation suspends visible note focus and restores the center after the next in-Ego `graph:set`.
  Rename may bypass the Global membership check only when the old path matches `focusPath`.
  Rename skips immediate Ego rebuild because the vault rename listener schedules the fresh source rebuild.

- Focus responsibility is split across the bridge boundary.
  TypeScript decides vault/filter membership. Unity pending focus covers only the gap between receiving `note:focus` and publishing the target in `MapGraphIndex`.

- `renderScale` is applied at iframe startup, not through the bridge.
  `MapSession` tracks the selected value and whether it differs from the currently applied iframe value so the UI can ask the user to reopen the graph.

- The latest settings snapshot is owned by `ReverySkyMapPlugin`.
  It is plugin-level state, not per-window state.

- The latest shown What's New version is owned by `ReverySkyMapPlugin`.
  It is stored under `whatsNewShownVersion` and checked only after fresh `embedded-archive` extraction. Missing data is valid old data.

- Filter panel visibility is owned by `MapFilterPanelController`.
  Suggestion pane state, selected index, ARIA active descendant state, and hide timers are owned by `MapFilterSuggestionsController` and are not persisted.

- Runtime notes, links, tag names, runtime mode, pending focus note id, layout preference, and note-length-derived visual scale are owned by the Unity runtime.
  They are stored in `MapRuntimeContext` and consumed by `Cartographer`.
  `ObsidianBridge` maps bridge `size` to `NoteData.Length`.
  `PendingFocusNoteId` is one-shot delivery state.
  `FocusNode.FocusRestoreNoteId` preserves graph-continuity focus.

- WebGL runtime serving is owned by `UnityWebglLocalServer`.
  The runtime is hosted locally from the selected runtime source. Server lifecycle is plugin-owned so multiple graph leaves share one server.

### Bridge contract
The canonical plugin-side contract lives in:
- `docs/DATA_CONTRACT.md`
- `src/bridge/BridgeTypes.ts`
- `src/bridge/MessageValidator.ts`

Important current contract facts:
- protocol version is `2.0.0`;
- successful startup order is `bridge:ready` first, then `graph:set`;
- Unity WebGL boot failure is terminal inside the iframe wrapper and does not emit `bridge:ready`;
- invalid outgoing payloads are rejected before dispatch;
- invalid incoming bridge messages are ignored with non-fatal error reporting.

Runtime-to-plugin messages:
- `bridge:ready`
- `graph:ready`
- `note:open`
- `tag:activate`
- `runtime:screenshot-response`
- `runtime:shutdown-complete`

Plugin-to-runtime messages:
- `graph:set`
- `note:focus`
- `note:update`
- `runtime:screenshot-request`
- `runtime:settings`
- `runtime:status`
- `runtime:shutdown`

Payload rules:
- `path` values stay vault-relative and use `/` separators.
- `notes[].size` is a non-negative byte count from Obsidian file metadata and maps to Unity `NoteData.Length`.
- `notes[].buildings` is read from the selected frontmatter landmark source, defaults to `landmarks`, and may be updated independently through `note:update`.
- `graph:set` carries the effective graph after query filtering, Ego scope, tag visibility, and layout hint.
- Focus changes are sent separately via `note:focus`, which must include both `id` and `path`.
- Ego `graph:set` payloads use `egoDepth` for note inclusion and `egoNeighborLinksEnabled` for link selection.
- `graph:ready` must echo the latest `graph:set` `requestId` before the iframe clears loading status.
- `runtime:status` updates iframe wrapper status text only and is not forwarded into Unity.
- `runtime:settings` applies frame-rate mode live and does not rebuild graph state.
- `runtime:shutdown` is a bridge/runtime-wrapper lifecycle handshake, not a full Unity engine shutdown.
- `mapLayout` is an optional plugin-owned runtime hint.
- `renderScale` is a plugin-owned iframe startup hint and does not belong to the bridge payload contract.

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

Source surfaces:
- `src/`: Obsidian plugin source.
- `unity/ReverySkyMap/`: Unity source project.
- `unity-webgl/index.template.html`: tracked host template.
- `unity-webgl/index.disk-runtime.template.html`: tracked disk-runtime host template.
- `whats-new/*.md`: versioned source announcements for `embedded-archive` releases.

Tracked generated input:
- `unity-webgl/Build/build-config.json`
- `unity-webgl/Build/runtime-entry.js`
- `unity-webgl/Build/runtime-core.js`
- `unity-webgl/Build/runtime-data.*`
- `unity-webgl/Build/runtime-code.*`

Generated local artifacts:
- `main.js`: bundled plugin entry output.
- `unity-webgl/index.html`: local runtime host page.
- other `unity-webgl/Build/*` files.
- `unity-webgl/TemplateData/*`.

Build and import flow:
1. Unity exports WebGL from `unity/ReverySkyMap`.
2. `scripts/import-unity-webgl.ps1` copies the export into `unity-webgl/` and regenerates runtime files used by all package modes.
3. `npm run build` builds the current `embedded-archive` release candidate from the prepared runtime.
   It copies the selected `whats-new/<version>.md` file into the archive when one is eligible and writes root `main.js`.
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
  Automated checks: `npm run test`, especially:
  `tests/view/MapView.test.ts`,
  `tests/view/MapFilterPanelController.test.ts`,
  `tests/view/MarkdownEditorFocus.test.ts`,
  `tests/view/MapSession.test.ts`,
  `tests/view/MapNoteOpenRouter.test.ts`,
  `tests/bridge/UnityIframeBridge.test.ts`
  Manual checks: open the graph, click into a markdown note, change filters, reopen the graph, and open a note from the runtime

- Graph state persistence across close and reopen
  Automated checks: `npm run test`, especially `tests/main.test.ts`
  Manual checks: set filters, tags visibility, layout, and render scale; close the graph through the ribbon toggle; reopen it; then repeat after restarting Obsidian

- What's New packaging and one-time display
  Automated checks: `npm run test`, especially:
  `tests/scripts/whatsNewSelection.test.ts`,
  `tests/runtime/WhatsNewFile.test.ts`,
  `tests/view/WhatsNewView.test.ts`,
  `tests/main.test.ts`
  Manual checks:
  install or update an `embedded-archive` build,
  open the graph after plugin reload,
  confirm the announcement opens once,
  then reopen the graph and confirm it does not repeat.

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
- The repository contains source-of-truth docs, generated runtime assets, and tracked generated runtime inputs for `embedded-archive`.
  Future work must keep those boundaries explicit to avoid editing the wrong surface.
- Live metadata refresh currently keys off tags and outgoing links.
  Size-only or date-only changes can leave Unity visual scale or date layout stale until another graph refresh occurs.
