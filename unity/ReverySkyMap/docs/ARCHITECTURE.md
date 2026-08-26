# ReverySkyMap Unity Architecture

## Purpose and Scope

This Unity project renders the Obsidian note graph inside the WebGL scene embedded by the parent plugin. This document covers the Unity runtime scene, bridge ingestion and shutdown handling, graph layout and indexing, line rendering and culling, focus and camera interaction, and the Unity tests that protect those flows.

The Unity runtime does not query the vault on its own. It consumes filtered bridge payloads from the parent plugin and works only on the runtime models in this subproject.

Runtime shape:

```text
Obsidian plugin
  -> ObsidianBridge
  -> MapRuntimeContext
  -> Cartographer
  -> active ICartographerEngine
  -> MapGraphIndex
  -> LineBuilder / CullingManager / FocusHighlighter / FocusNode / BuildingManager
```

## System Overview

- Scene and serialized wiring
  - Responsibility: hosts the runtime scene and the serialized references for the map, UI, camera, culling, and engine components.
  - Main code location: `Assets/Scenes/StarScapeScene.unity`
  - Important dependencies: `GameInput`, `CameraOrbitalController`, `FocusNode`, `Cartographer`, `CartographerForcesEngine`, `Cartographer25DEngine`, `CartographerEngineRecursiveHubsEngine`, `ScapeCameraWarper`, `LineBuilder`, `CullingManager`, `FocusHighlighter`, `ChangeViewControl`, `RotateCameraUI`, `RotateHoldButton`, `Notification`
- Bridge and runtime state
  - Responsibility: validates inbound bridge envelopes, converts graph payloads into runtime models, applies targeted note building updates and runtime settings, stores the normalized source graph, derives direct note-neighbor counts, and raises outbound events for parent bridge messages.
  - Main code location: `Assets/Scripts/Bridge/ObsidianBridge.cs`, `Assets/Scripts/Bridge/MapRuntimeContext.cs`, `Assets/Scripts/Models/BridgeEnvelopeModels.cs`, `Assets/Scripts/Models/BridgePayloadModels.cs`, `Assets/Scripts/Models/MapFrameRateMode.cs`, `Assets/Scripts/Models/NoteData.cs`
  - Important dependencies: `Cartographer`, `MapRuntimeContext.OnNotesChanged`, `MapRuntimeContext.OnOpenNoteRequested`, `MapRuntimeContext.OnTagActivateRequested`, `MapRuntimeContext.OnGraphReady`
- Graph orchestration
  - Responsibility: chooses the active layout engine, rebuilds the graph when runtime notes change, creates the shared visual graph index, forwards that index to consumers, and reconciles pending or restored focus after real index publications.
  - Main code location: `Assets/Scripts/StarScape/Cartographer.cs`
  - Important dependencies: `ICartographerEngine`, `MapGraphIndex`, `FocusNode`, `FocusHighlighter`, `ChangeViewControl`, `Notification`, `SampleDataGenerator`, `MapRuntimeContext`, `LineBuilder`, `CullingManager`
- Visual graph index
  - Responsibility: provides the read-only topology index for the current engine-built scene graph: star nodes, tag nodes, note-note edges, note-tag edges, lookups, and adjacency.
  - Main code location: `Assets/Scripts/StarScape/MapGraphIndex.cs`, `Assets/Scripts/Models/MapGraphNodeId.cs`, `Assets/Scripts/Models/MapGraphNode.cs`, `Assets/Scripts/Models/MapGraphEdge.cs`, `Assets/Scripts/Models/MapGraphEnums.cs`
  - Important dependencies: active engine `Star` and `TagNode` scene objects, `MapRuntimeContext.RuntimeNoteLink`, `NoteData.TagIds`
- Layout engines
  - Responsibility: build and clear the active visual node layout, tick when needed, and publish the star and tag node lists plus line budgets consumed by `Cartographer`.
  - Main code location: `Assets/Scripts/StarScape/CartographerForcesEngine.cs`, `Assets/Scripts/StarScape/Cartographer25DEngine.cs`, `Assets/Scripts/StarScape/CartographerEngineRecursiveHubsEngine.cs`, `Assets/Scripts/Interfaces/ICartographerEngine.cs`
  - Important dependencies: `StarSO`, `TagNodeSO`, `ScapeCameraWarper`, `NoteData`, `MapRuntimeContext.RuntimeNoteLink`, `MaxActiveLines`, `MaxActiveLongLines`, `OnNodesChanged`
- Line rendering and culling
  - Responsibility: consume `MapGraphIndex`, build pooled line renderers for indexed edges, keep the visible edge set in sync with node visibility and focus, and share the distance-culling pipeline with other consumers.
  - Main code location: `Assets/Scripts/StarScape/LineBuilder.cs`, `Assets/Scripts/StarScape/CullingManager.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`, `Assets/Scripts/StarScape/LabelPresenter.cs`
  - Important dependencies: `MapGraphIndex`, `FocusNode.SelectedNode`, `FocusHighlighter`, `ICullingConsumer`, `LineRenderer`, `ObjectPool<LineRenderer>`, `CullingGroup`
- Interaction, focus, and camera
  - Responsibility: turns device input into selection, pan, orbit, zoom, view switching, label emphasis, and note-open actions.
  - Main code location: `Assets/Scripts/GameInput/GameInput.cs`, `Assets/Scripts/StarScape/FocusNode.cs`, `Assets/Scripts/StarScape/FocusHighlighter.cs`, `Assets/Scripts/Camera/CameraOrbitalController.cs`, `Assets/Scripts/UI/ChangeViewControl.cs`, `Assets/Scripts/UI/RotateCameraUI.cs`, `Assets/Scripts/UI/RotateHoldButton.cs`
  - Important dependencies: `EventSystem`, cached main camera references, `MapRuntimeContext`, `Cartographer.I`, `GameSettings`
- Visual support objects
  - Responsibility: provide prefabs, note-length scale calibration, direct-link crystal buckets, labels, pooled building callouts, shared culling consumers, notifications, and optional sample graph injection.
  - Main code location: `Assets/Scripts/ScriptableObjects/StarSO.cs`, `Assets/Scripts/ScriptableObjects/TagNodeSO.cs`, `Assets/Scripts/StarScape/StarVisual.cs`, `Assets/Scripts/StarScape/BuildingManager.cs`, `Assets/Scripts/StarScape/BuildingCallout.cs`, `Assets/Scripts/StarScape/LabelPresenter.cs`, `Assets/Scripts/StarScape/LabelHighlightPresenter.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`, `Assets/Scripts/Notification/Notification.cs`, `Assets/Scripts/StarScape/SampleDataGenerator.cs`
  - Important dependencies: `MapRuntimeContext.NotesVersion`, `MapRuntimeContext.HasRuntimeNotes`, `Cartographer.CurrentView`, `NodeVisibility.IsDistanceVisible`, `NodeVisibility.HighlightState`, `ObjectPool<BuildingCallout>`, prefab assets in `Assets/Prefabs` and `Assets/_Visuals`
- Automated checks
  - Responsibility: guard bridge parsing, layout rules, focus and highlight behavior, and PlayMode bootstrap and visual stability.
  - Main code location: `Assets/Tests/EditMode/*`, `Assets/Tests/PlayMode/*`
  - Important dependencies: `ReverySkyMap.Runtime`, Unity Test Assemblies

## Execution Paths

### 1. Scene startup and editor-only sample data seed

1. Unity loads `Assets/Scenes/StarScapeScene.unity`.
2. `ObsidianBridge.EnsureInstance()` in `Assets/Scripts/Bridge/ObsidianBridge.cs` creates a persistent bridge object if the scene does not already contain one.
3. Scene wiring activates `GameInput`, `CameraOrbitalController`, `FocusNode`, `FocusHighlighter`, `Cartographer`, the engine components, `ScapeCameraWarper`, `ChangeViewControl`, `RotateCameraUI`, `RotateHoldButton`, and `Notification`.
4. `Cartographer.Start()` calls `SampleDataGenerator.TryInjectSampleDataIfNeeded()` only inside `UNITY_EDITOR`, then calls `RebuildGraph(MapRuntimeContext.MapLayoutPreference, MapRuntimeContext.LatestGraphRequestId)`.
5. `Cartographer` subscribes to `MapRuntimeContext.OnNotesChanged` and the view toggle so later payloads or button clicks can rebuild or restyle the active graph.

### 2. `graph:set` ingestion and graph rebuild

1. `ObsidianBridge.OnGraphSet(string json)` exits early during shutdown, rejects empty JSON, and parses the envelope with `JsonUtility.FromJson`.
2. The bridge rejects payloads with a wrong `protocolVersion` or `type`, then normalizes the payload into `NoteData` and `MapRuntimeContext.RuntimeNoteLink` objects.
3. Tags are trimmed and mapped by case-insensitive name to shared runtime tag ids, blank titles become `GameSettings.DefaultTitle`, invalid dates become `DateTime.MinValue`, and note size is clamped to `0` or greater.
4. Links with empty endpoints or self-links are dropped, and non-positive link weights are normalized to `1`.
5. `MapRuntimeContext.SetTagNames`, `SetLinks`, and `SetNotes` store the runtime source of truth. `SetNotes` stores the envelope `requestId`, derives each note's unique direct note-neighbor count from the current links, increments `NotesVersion`, and raises `OnNotesChanged(requestId)`.
6. `Cartographer.HandleRuntimeNotesChanged(requestId)` calls `RebuildGraph(MapRuntimeContext.MapLayoutPreference, requestId)`.
7. `Cartographer.ResolveModeByNotesCount()` uses `defaultEngine` first. Without an override, explicit `Dates` and `ScalableLinks` stay fixed, while `Auto` and `DynamicLinks` resolve by note count: small graphs use `DynamicLinks`, large graphs use `ScalableLinks`.
8. `Cartographer` clears the engine that owns stale visuals/state, clears `BuildingManager` building callouts, applies `MapGraphIndex.Empty` using the selected engine contract, waits one frame so Unity can destroy old objects, then builds the current `MapRuntimeContext.Notes`. New `graph:set` events stop the pending rebuild coroutine before starting a replacement rebuild.
9. The chosen engine runs `BuildGraph(notes)` and emits `OnNodesChanged` with the instantiated `Star` and `TagNode` scene objects.
10. `Cartographer.HandleEngineNodesChanged(...)` builds `GraphIndex = MapGraphIndex.Build(stars, tagNodes, MapRuntimeContext.Links)`.
11. `Cartographer` passes the same `GraphIndex` to `LineBuilder.Rebuild(...)` and `CullingManager.Rebuild(...)`.
12. `BuildClearedGraph(...)` calls `ApplyCurrentView()`, which applies `CurrentView` to the active engine, notifies star visuals through `OnViewChanged`, and sets `LineBuilder` visibility from the current view before the active `ScapeCameraWarper` is rebound and build timing is logged.
13. After each non-transient index publication, `Cartographer.ApplyGraphFocus()` tries `MapRuntimeContext.PendingFocusNoteId` once, then tries `FocusNode.FocusRestoreNoteId`, then calls `ResetFocus()`.
14. When a build starts, `Cartographer` sets the building graph request id from the request id carried by the rebuild coroutine.
15. When the active engine reaches its ready point, it calls `MapRuntimeContext.RequestGraphReady()`. `ObsidianBridge` forwards the building graph `requestId` to JavaScript as `graph:ready`, unless the id is empty; the iframe wrapper ignores stale ready ids when updating loading status.

### 3. Note focus, label emphasis, and open-note callback

1. `FocusNode.HandleSelect()` raycasts against `GameInput.Instance.InteractableLayers`.
2. Selecting a `Star` resolves the node through `MapGraphIndex`, focuses the camera, and calls `MapRuntimeContext.RequestOpenNote(star.Data)`. If RecursiveHubs stars are clickable before the final index exists, the current code ignores the click instead of logging an error.
3. `MapRuntimeContext.OnOpenNoteRequested` reaches `ObsidianBridge.HandleOpenNoteRequested`.
4. In WebGL builds, `ObsidianBridge` forwards the event to JavaScript via `ReverySkyBridgePostNoteOpen(noteId, notePath)`.
5. Selecting a `TagNode` resolves the node through `MapGraphIndex`, focuses the camera locally, and calls `MapRuntimeContext.RequestTagActivate(tagNode.UserTagId)`.
6. `MapRuntimeContext.OnTagActivateRequested` reaches `ObsidianBridge.HandleTagActivateRequested`; WebGL builds forward the event to JavaScript as `tag:activate` with payload `{ tag: string }`.
7. Incoming `note:focus` messages call `ObsidianBridge.OnNoteFocus()`, which reaches `Cartographer.FocusRuntimeNote()`.
8. `Cartographer.FocusRuntimeNote()` resolves the star through `GraphIndex.TryGetStar(noteId, out star)` and stores `noteId` in `MapRuntimeContext.PendingFocusNoteId` when the current visual graph has not materialized that star.
9. The next non-transient `HandleEngineNodesChanged(...)` call rebuilds `GraphIndex` and lets `ApplyGraphFocus()` consume pending focus before falling back to restore focus.
10. `FocusHighlighter.SetFocus(...)` reads `MapGraphIndex.GetNeighborIds(...)`, marks the focused node as `Focused`, marks adjacent nodes as `Linked`, and calls `LineBuilder.ApplyHighlight(...)` so incident edges restyle together with the labels.
11. Incoming `note:update` messages call `ObsidianBridge.OnNoteUpdate()`, which replaces the matching runtime note's building list through `MapRuntimeContext.TryUpdateNoteBuildings(...)`.
12. `Cartographer.HandleNoteBuildingsChanged(...)` resolves the current star through `GraphIndex.TryGetStar(...)` and asks `StarVisual.RefreshBuildings()` to resync only that star with the pooled building-callout renderer.

### 4. Runtime frame-rate settings

1. The parent plugin persists `frameRateMode` as map view state and sends it after the iframe reports `bridge:ready`.
2. The iframe JavaScript wrapper receives `runtime:settings` and forwards it to `ObsidianBridge.OnRuntimeSettings(string json)` only after `runtimeMode` is `unity`.
3. `ObsidianBridge.OnRuntimeSettings` exits during shutdown, rejects empty JSON, parses `BridgeRuntimeSettingsEnvelope`, and rejects wrong `protocolVersion` or `type`.
4. `ApplyFrameRateMode(...)` maps `auto` to `Application.targetFrameRate = -1` and `QualitySettings.vSyncCount = 1`.
5. `fps60`, `fps30`, and `fps24` disable vSync with `QualitySettings.vSyncCount = 0` and set `Application.targetFrameRate` to `60`, `30`, or `24`.
6. Unknown runtime-side mode values log a warning and fall back to `Auto`; the parent TypeScript bridge should reject them before delivery.
7. This path does not call `MapRuntimeContext.SetNotes`, does not rebuild graph data, does not reset focus, and does not recreate the iframe.

### 5. Runtime shutdown guard

1. Before the parent plugin detaches the iframe, the WebGL wrapper receives `runtime:shutdown` and forwards it to `ObsidianBridge.OnRuntimeShutdown(string json)` when the Unity instance can receive messages.
2. `ObsidianBridge` marks the bridge as shutting down and unsubscribes from `MapRuntimeContext.OnOpenNoteRequested`, `MapRuntimeContext.OnTagActivateRequested`, and `MapRuntimeContext.OnGraphReady`.
3. After shutdown starts, `OnGraphSet`, `OnNoteFocus`, `OnRuntimeSettings`, `HandleOpenNoteRequested`, and `HandleTagActivateRequested` return without processing so the closing runtime cannot ingest new graph state, focus notes, apply late frame-rate changes, or send late activate/open callbacks.
4. `HandleGraphReadyRequested` also returns during shutdown so late engine completion cannot send `graph:ready`.
5. This is a bridge lifecycle guard only; parent hosting, iframe detachment, and full Unity engine teardown remain outside the Unity project boundary.

### 6. Camera, view, and rotation controls

1. `GameInput` translates raw pointer and touch input into semantic events such as select, pan, pinch zoom, scroll zoom, and orbit drag.
2. `CameraOrbitalController` listens to those events and keeps the camera orbiting around the current pivot.
3. `FocusNode` uses `CameraOrbitalController` to focus stars or tag nodes.
4. `ChangeViewControl` raises `OnChangeScapeView`, and `Cartographer.CycleView()` switches between `ScapeView.Planets`, `ScapeView.Plain`, and `ScapeView.Buildings`, updates the button icon, and calls `ApplyCurrentView()`.
5. `RotateHoldButton` feeds `RotateCameraUI`, and `RotateCameraUI` emits the clockwise and pressed state consumed by `CameraOrbitalController`.
6. `ScapeCameraWarper.OnWarpApplied` refreshes culling targets after 2.5D warp movement, and the date slider only appears when the active engine is `Dates`.

### 7. Line rendering and node distance culling

1. `Cartographer.HandleEngineNodesChanged(...)` receives rebuilt `Star` and `TagNode` scene objects, builds `GraphIndex`, and forwards it with the active engine's line budgets.
2. `LineBuilder.Rebuild(MapGraphIndex, ...)` stores the new limits, clears active line renderers and cached state, resizes its `ObjectPool<LineRenderer>`, registers indexed graph nodes, and creates line candidates directly from `MapGraphIndex.Edges`.
3. `CullingManager.Rebuild(MapGraphIndex, lineBuilder)` scans `MapGraphIndex.Nodes` and asks each `ICullingConsumer` for an `Entry`; `LineBuilder.TryCreateDistanceEntry(...)` provides one consumer-specific culling rule per indexed graph node.
4. `Cartographer.Update()` refreshes culling targets after ticking moving engines.
5. When `CullingGroup` changes a node's visibility, `CullingManager` calls `LineBuilder.SetDistanceVisible(...)`, which updates the visible-node set and marks the edge set dirty.
6. `LineBuilder.LateUpdate()` applies the focused-node priority, keeps recently visible regions within a refresh budget, reconciles the desired edge set against the pooled renderers, and rewrites each active line's endpoints from the live transforms.
7. `Cartographer.ApplyCurrentView()` sets `LineBuilder` visibility from `CurrentView`, so switching between `Planets` and `Plain` toggles whether existing line renderers are shown; it does not rebuild the candidate edge set.

### 8. Building callout rendering

1. `StarVisual.Start()` subscribes to `Cartographer.OnViewChanged`, `NodeVisibility.OnDistanceVisibilityChanged`, and `NodeVisibility.OnHighlightStateChanged`.
2. When the current view is `ScapeView.Buildings`, `StarVisual.SyncBuildings()` asks `BuildingManager.Register(...)` to show or hide this star's building callouts when the star is distance-visible or focused. Linked state alone does not make buildings visible.
3. `BuildingManager` owns the shared `ObjectPool<BuildingCallout>` and enforces `maxActiveCallouts` for non-focused stars so building mode can scale without each star instantiating its own full callout set.
4. Focused stars may exceed the normal callout budget by one full callout set so selected building names remain complete.
5. `BuildingCallout.PrepareForUse(...)` reparents a pooled callout under the target star's building root, initializes its line, marker, text, and highlight material, then enables related behaviours such as camera-facing text.
6. `BuildingCallout.PrepareForPool(...)` clears the rendered line/text, disables related behaviours, reparents the callout under `BuildingManager`, and deactivates it for reuse.

## Subsystems

### Bridge and runtime state

- `ObsidianBridge`
  - Responsibility: owns bridge validation, graph payload normalization, runtime settings application, the shutdown guard, and WebGL callbacks back into the parent plugin.
  - Code anchor: `Assets/Scripts/Bridge/ObsidianBridge.cs::OnGraphSet`, `OnNoteFocus`, `OnNoteUpdate`, `OnRuntimeSettings`, `OnRuntimeShutdown`, `HandleOpenNoteRequested`, `HandleGraphReadyRequested`
  - Entry point: bridge messages from the parent runtime
  - Calls / sends to: `MapRuntimeContext`, `Cartographer`, `ReverySkyBridgePostNoteOpen`, `ReverySkyBridgePostGraphReady`
- `MapRuntimeContext`
  - Responsibility: owns the normalized source graph data from the bridge, current graph request id, and pending focus note id.
  - Code anchor: `Assets/Scripts/Bridge/MapRuntimeContext.cs`
  - Entry point: `SetNotes`, `SetLinks`, `SetTagNames`, `SetLatestGraphRequestId`, `RequestOpenNote`, `RequestGraphReady`
  - Calls / sends to: `Cartographer`, `FocusNode`, `ObsidianBridge`
- `NoteData`
  - Responsibility: represents the normalized runtime note model consumed by engines and visuals.
  - Code anchor: `Assets/Scripts/Models/NoteData.cs`
  - Entry point: created by `ObsidianBridge` and sample data generation
  - Calls / sends to: `StarSO` and the active `ICartographerEngine` implementation

### Graph engines and layout

- `Cartographer`
  - Responsibility: chooses the active engine, rebuilds the graph, builds `GraphIndex`, applies the current view, and reconciles focus from pending focus, restore focus, or reset after real index publications.
  - Code anchor: `Assets/Scripts/StarScape/Cartographer.cs::Start`, `RebuildGraph`, `BuildClearedGraph`, `ApplyCurrentView`, `HandleEngineNodesChanged`, `ApplyGraphFocus`, `FocusRuntimeNote`
  - Entry point: `MapRuntimeContext.OnNotesChanged`, UI events, scene start
  - Calls / sends to: `ICartographerEngine`, `MapGraphIndex`, `LineBuilder`, `CullingManager`, `FocusNode`, `FocusHighlighter`, `Notification`, `ScapeCameraWarper`
- `ICartographerEngine`
  - Responsibility: defines the common contract for engine selection, graph building, ticking, active line budgets, and published scene nodes.
  - Code anchor: `Assets/Scripts/Interfaces/ICartographerEngine.cs`
  - Entry point: implemented by active layout engines
  - Calls / sends to: `Cartographer`, `CameraOrbitalController`, `FocusNode`
- `MapGraphIndex`
  - Responsibility: indexes the current instantiated map as read-only visual topology: nodes, edges, note/tag/component lookups, and adjacency.
  - Code anchor: `Assets/Scripts/StarScape/MapGraphIndex.cs::Build`, `TryGetStar`, `GetNeighborIds`, `GetIncidentEdges`
  - Entry point: `Cartographer.HandleEngineNodesChanged`
  - Calls / sends to: `LineBuilder`, `CullingManager`, `FocusHighlighter`, `Cartographer.FocusRuntimeNote`
- `CartographerForcesEngine`
  - Responsibility: builds the `DynamicLinks` layout with note-tag edges, note-note links, and per-frame ticks.
  - Code anchor: `Assets/Scripts/StarScape/CartographerForcesEngine.cs::BuildGraph`, `Tick`, `ClearGraph`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `TagNodeSO`, `MapRuntimeContext.Links`
- `Cartographer25DEngine`
  - Responsibility: builds the `Dates` layout and publishes the date-axis range for the camera slider.
  - Code anchor: `Assets/Scripts/StarScape/Cartographer25DEngine.cs::BuildGraph`, `ClearGraph`, `OnDateAxisRangeChanged`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `ScapeCameraWarper`, `CameraOrbitalController`
- `CartographerEngineRecursiveHubsEngine`
  - Responsibility: builds the `ScalableLinks` large-graph layout by selecting structural maxima, recursively placing hub systems, refining links after placement, and preserving node space through a two-radius node-spacing constraint.
  - Code anchor: `Assets/Scripts/StarScape/CartographerEngineRecursiveHubsEngine.cs::BuildGraph`, `RunRefinementPass`, `ApplyLinkContractionCorrections`, `ApplyNodeSpacingPass`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `TagNodeSO`, `MapRuntimeContext.RuntimeNoteLink`, `MapRuntimeContext.RequestGraphReady`
- `ScapeCameraWarper`
  - Responsibility: warps the 2.5D layout around the camera based on the active engine's depth profile.
  - Code anchor: `Assets/Scripts/StarScape/ScapeCameraWarper.cs::Rebind`, `ApplyWarp`, `Clear`
  - Entry point: rebound by `Cartographer` after a `Dates` build
  - Calls / sends to: active engine `Stars`, serialized `cam`, `layoutParent`
- `StarSO`
  - Responsibility: instantiates star prefabs and scales them from runtime note-length statistics.
  - Code anchor: `Assets/Scripts/ScriptableObjects/StarSO.cs::Instantiate`
  - Entry point: called by the active layout engines while building stars
  - Calls / sends to: `MapRuntimeContext.NotesVersion`, `NoteData`, `Star`
- `StarVisual`
  - Responsibility: subscribes to `Cartographer.OnViewChanged`, applies the initial `Cartographer.CurrentView` on start, selects stable sphere material from note path, maps direct note-neighbor count into crystal visual buckets, and delegates building callout rendering to `BuildingManager`.
  - Code anchor: `Assets/Scripts/StarScape/StarVisual.cs::Start`, `ApplyView`, `ShowSphere`, `ShowCrystal`, `SyncBuildings`, `RefreshBuildings`, `ResolveCrystalTypeByDirectLinkCount`
  - Entry point: star prefab `Start` and `Cartographer.OnViewChanged`
  - Calls / sends to: `Cartographer.CurrentView`, `NoteData.Path`, `NoteData.DirectLinkCount`, `NodeVisibility`, `BuildingManager`, `SphereMaterialCatalogSO`, `CrystalTypeScaleMapperSO`
- `BuildingManager`
  - Responsibility: owns pooled building callout rendering, applies the active callout budget, prioritizes focused stars, and releases callouts during graph rebuilds or view/visibility changes.
  - Code anchor: `Assets/Scripts/StarScape/BuildingManager.cs::Awake`, `Register`, `Refresh`, `Clear`
  - Entry point: scene startup, `StarVisual.SyncBuildings`, `StarVisual.RefreshBuildings`, `Cartographer.PrepareGraphClear`
  - Calls / sends to: `BuildingCallout`, `StarVisual`, `ObjectPool<BuildingCallout>`
- `BuildingCallout`
  - Responsibility: renders one building label, marker, and surface-to-label line, and prepares itself for active use or pool reuse.
  - Code anchor: `Assets/Scripts/StarScape/BuildingCallout.cs::PrepareForUse`, `Init`, `ApplyHighlight`, `PrepareForPool`
  - Entry point: `BuildingManager.Register` and `BuildingManager.Refresh`
  - Calls / sends to: `LabelHighlightPresenter`, `LineRenderer`, `TextMeshPro`
- `TagNodeSO`
  - Responsibility: supplies the tag-node prefab used by the layout engines that instantiate tags.
  - Code anchor: `Assets/Scripts/ScriptableObjects/TagNodeSO.cs`
  - Entry point: called by `TagNode.Create`
  - Calls / sends to: `CartographerForcesEngine`, `CartographerEngineRecursiveHubsEngine`

### Line rendering, focus, and culling

- `LineBuilder`
  - Responsibility: consumes `MapGraphIndex`, owns pooled line renderers, focus-priority ordering, recent-visibility refresh, and per-frame endpoint updates for visible indexed edges.
  - Code anchor: `Assets/Scripts/StarScape/LineBuilder.cs::Rebuild`, `SetDistanceVisible`, `LateUpdate`, `ShowLine`
  - Entry point: `Cartographer.HandleEngineNodesChanged`, `CullingManager`, `FocusHighlighter`, `Cartographer.ApplyCurrentView`
  - Calls / sends to: `CullingManager`, `MapGraphIndex`, `FocusNode`, `LineRenderer`
- `FocusHighlighter`
  - Responsibility: derives focused and linked label states from graph adjacency and keeps line highlighting in sync with the current selection.
  - Code anchor: `Assets/Scripts/StarScape/FocusHighlighter.cs::SetFocus`, `ApplyHighlight`
  - Entry point: `FocusNode` selection changes
  - Calls / sends to: `MapGraphIndex`, `LabelPresenter`, `LineBuilder`
- `CullingManager`
  - Responsibility: shares one `CullingGroup` across graph-node consumers and dispatches visibility changes only when a threshold actually changes.
  - Code anchor: `Assets/Scripts/StarScape/CullingManager.cs::Rebuild`, `Register`, `RefreshTargets`, `ApplyTargetVisibility`
  - Entry point: `Cartographer.HandleEngineNodesChanged`, `Cartographer.Update`, `ScapeCameraWarper.OnWarpApplied`
  - Calls / sends to: `MapGraphIndex`, `LineBuilder`, `LabelPresenter`, `BehaviourCullingTarget`
- `ICullingConsumer` and prefab culling targets
  - Responsibility: define the distance-visibility contract used by graph-level consumers such as `LineBuilder`, `LabelPresenter`, and `BehaviourCullingTarget`.
  - Code anchor: `Assets/Scripts/StarScape/CullingManager.cs::ICullingConsumer`, `Assets/Scripts/StarScape/LabelPresenter.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`
  - Entry point: `CullingManager.Rebuild`
  - Calls / sends to: `CullingManager`

### Interaction and camera

- `GameInput`
  - Responsibility: converts raw input into semantic gestures and blocks UI hits before they reach the map.
  - Code anchor: `Assets/Scripts/GameInput/GameInput.cs::Update`, `HandleMouseInput`
  - Entry point: Unity `Update()`
  - Calls / sends to: `FocusNode`, `CameraOrbitalController`, `EventSystem`
- `FocusNode`
  - Responsibility: resolves taps on stars and tags into focus changes and note-open requests.
  - Code anchor: `Assets/Scripts/StarScape/FocusNode.cs::HandleSelect`, `SetSelectedStar`, `ResetFocus`
  - Entry point: `GameInput` events
  - Calls / sends to: `CameraOrbitalController`, `MapRuntimeContext`, `Cartographer.I`, `FocusHighlighter`
- `CameraOrbitalController`
  - Responsibility: owns orbit radius, pivot follow, zoom, and date-slider interaction. Focus placement always flattens onto the pivot's equatorial XZ plane so stars and tags do not inherit vertical drift from the previous focus target.
  - Code anchor: `Assets/Scripts/Camera/CameraOrbitalController.cs::Start`, `Update`, `Focus`, `ResetToStart`
  - Entry point: `GameInput` events, UI sliders, `RotateCameraUI`
  - Calls / sends to: `Cartographer`, `FocusNode`, `ScapeCameraWarper`
- `ChangeViewControl`
  - Responsibility: raises the view toggle action from the scene button.
  - Code anchor: `Assets/Scripts/UI/ChangeViewControl.cs::Start`
  - Entry point: UI button click
  - Calls / sends to: `Cartographer.CycleView`
- `RotateCameraUI`
  - Responsibility: emits held-button rotation state for the camera.
  - Code anchor: `Assets/Scripts/UI/RotateCameraUI.cs`
  - Entry point: UI button events
  - Calls / sends to: `CameraOrbitalController`
- `RotateHoldButton`
  - Responsibility: turns pointer-down, pointer-up, and pointer-exit events into the `RotateCameraUI` hold signal.
  - Code anchor: `Assets/Scripts/UI/RotateHoldButton.cs`
  - Entry point: UI pointer events
  - Calls / sends to: `RotateCameraUI`
- `Notification`
  - Responsibility: shows or hides the "no entries" notice.
  - Code anchor: `Assets/Scripts/Notification/Notification.cs::UpdateNoticeMessage`
  - Entry point: `Cartographer.RebuildGraph`
  - Calls / sends to: scene UI object
- `SampleDataGenerator`
  - Responsibility: optionally injects a deterministic sample graph in the Unity Editor when no runtime notes exist.
  - Code anchor: `Assets/Scripts/StarScape/SampleDataGenerator.cs::TryInjectSampleDataIfNeeded`
  - Entry point: `Cartographer.Start()`
  - Calls / sends to: `MapRuntimeContext.SetNotes`, `SetLinks`, `SetTagNames`

## State Ownership and Contracts

- `MapRuntimeContext` is the source of truth for live runtime notes, links, tag names, pending focus note id, layout preference, graph request id, and the `NotesVersion` counter. `PendingFocusNoteId` is a one-shot focus delivery/materialization buffer, not a durable remembered selection.
- `MapRuntimeContext.SetNotes(notes, requestId)` derives `NoteData.DirectLinkCount` from unique direct note-note neighbors in `MapRuntimeContext.Links`. `StarVisual` reads that value to choose crystal buckets; layout engines do not own this visual metric.
- `ObsidianBridge` owns bridge validation and all conversion from the JSON envelope into runtime models.
- `Cartographer` owns engine selection, rebuild timing, current view, `GraphIndex` creation, and focus reconciliation after the index changes. `ApplyCurrentView()` is the single place that applies view state to the active engine, star visuals, and line visibility. The focus order is pending once, restore, then reset.
- `NoteData` does not own view state. Stars keep runtime note data, while `Cartographer.CurrentView` is broadcast through `OnViewChanged` for view-dependent visuals.
- Unity does not decide whether a focused note belongs to the active Obsidian filter. The parent plugin gates ordinary focus by the effective graph; Unity pending only bridges the delay between a valid focus message and an indexed star.
- `CartographerForcesEngine`, `Cartographer25DEngine`, and `CartographerEngineRecursiveHubsEngine` own placement and cleanup of instantiated stars and tags for `DynamicLinks`, `Dates`, and `ScalableLinks`; line visuals are handed off to `LineBuilder` after the engine raises `OnNodesChanged`.
- `BuildingManager` owns pooled building callout GameObjects independently from engine-owned stars. `StarVisual` exposes the target root, sphere radius, note building data, and highlight state; the manager decides how many callouts are active, reparents them to visible stars, applies normal, linked, or focused styling, and returns them to the pool on hide, refresh, or graph clear. Linked state affects styling only; it does not make a distance-hidden star's buildings visible.
- Cartographer engines expose a stable camera navigation pivot at the layout parent origin. Bounds may grow to cover placed nodes, but engines must not move the pivot to the current graph centroid during rebuilds.
- `MapGraphIndex` is the shared read-only topology index for the current engine-built visual map. It is built once per engine node publication from engine-owned `Star` and `TagNode` objects and `MapRuntimeContext.Links`, remains valid until the next graph rebuild, and is read by line rendering, culling, label emphasis, and focus lookup.
- `FocusNode.FocusRestoreNoteId` is the continuity fallback for graph rebuilds. It is updated by successful focus selection and is not copied into pending focus during reconciliation.
- `FocusHighlighter` derives label and line emphasis from `MapGraphIndex` adjacency. It does not own graph topology or source notes.
- `LineBuilder` owns pooled line renderers, focus-priority ordering, recent-visibility refresh, and the per-frame endpoint refresh for indexed edges. It does not rebuild note/tag lookups or own graph topology.
- `ScapeCameraWarper` owns the 2.5D warp state and only participates when the active engine is `Dates`.
- `StarSO` recomputes note-length scale buckets whenever `MapRuntimeContext.NotesVersion` changes.
- `CullingManager` owns the shared `CullingGroup` and threshold transitions for graph nodes. Runtime tracking is split into `NodeTarget` and `Interest`: a `NodeTarget` is one physical graph node and one culling sphere, while each `Interest` is one consumer-specific distance rule and last visibility state. Bounds refreshes are explicit after engine ticks and warp application, not a standalone every-frame manager loop.
- `ICullingConsumer` is the prefab-side contract for distance-driven behavior. A consumer describes its own `Entry` request and receives `SetDistanceVisible(node, visible)` only for first application or real threshold changes. Current consumers are `LabelPresenter` for label roots and related label behaviors, and `BehaviourCullingTarget` for one serialized `Behaviour`.
- `GameInput` treats UI hits as blocked input and only forwards gestures that originate on the map.
- Bridge contract rules that matter locally:
  - `protocolVersion` must match `2.0.0`.
  - Accepted parent-to-Unity message types are `graph:set`, `note:focus`, `note:update`, `runtime:settings`, and `runtime:shutdown`.
  - Accepted Unity-to-parent interaction events include `note:open` and `tag:activate`; `tag:activate` carries `{ tag: string }`.
  - `graph:set` payloads are already filtered by the parent plugin; Unity does not own vault query logic.
  - `graph:set` carries only the filtered graph payload; focus is handled separately through `note:focus`, and frame-rate settings are handled separately through `runtime:settings`.
  - `graph:set.requestId` is echoed in `graph:ready` after active engine readiness; empty ids suppress outbound `graph:ready`.
  - `runtime:settings.payload.frameRateMode` applies live frame-rate mode: `auto` enables vSync and uses `Application.targetFrameRate = -1`, while `fps60`, `fps30`, and `fps24` disable vSync and set Unity's software frame cap.
  - `runtime:settings` must not mutate `MapRuntimeContext` graph data or trigger a graph rebuild.
  - `runtime:shutdown` is a lifecycle guard that stops bridge input and output without calling Unity quit APIs.
  - `path` values are treated as vault-relative and normalized with `/` separators when path lookup is needed.
  - Empty titles fall back to `GameSettings.DefaultTitle`.
  - Negative note sizes clamp to `0`.
  - Empty link endpoints and self-links are dropped.
  - Non-positive link weights normalize to `1`.
  - Unknown bridge fields are ignored.
- `Cartographer.ResolveModeByNotesCount()` uses `defaultEngine` first, then preserves explicit `Dates` and `ScalableLinks`, then resolves `Auto` and `DynamicLinks` by the note-count threshold.
- Camera focus contract: `CameraOrbitalController.Focus()` always flattens the focus direction to the horizontal XZ plane before placing the camera. The resulting camera position keeps the focused pivot's `y`, the orbit stays equatorial, and the rule does not depend on the active engine. `Dates` uses the same universal camera placement rule.

## Build, Packaging, and Deployment

- Runtime code is grouped under `ReverySkyMap.Runtime` in `Assets/Scripts/ReverySkyMap.Runtime.asmdef`.
- Test assemblies are split by Unity test mode:
  - `Assets/Tests/EditMode/ReverySkyMap.EditModeTests.asmdef`
  - `Assets/Tests/PlayMode/ReverySkyMap.PlayModeTests.asmdef`
- The scene entry point is `Assets/Scenes/StarScapeScene.unity`.
- Prefabs and ScriptableObjects that define the visible runtime live under `Assets/Prefabs`, `Assets/_Visuals`, and `Assets/ScriptableObjects`.
- The Unity side stops at the exported scene/runtime boundary; parent plugin hosting and WebGL import are handled outside this subproject.

## Verification

- Bridge parsing and runtime mapping
  - Automated checks: `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs`
  - Manual checks when needed: load the scene and confirm `graph:set` populates notes, links, tags, request id, and focus state without errors; change the parent plugin frame-rate setting and confirm Unity logs/applies the selected mode without rebuilding the graph; in the parent plugin, close and quickly reopen the map view and confirm there are no delayed `note:open`, stale `graph:ready`, or bridge errors
- Engine selection and layout
  - Automated checks: `Assets/Tests/EditMode/CartographerForcesEngineRadiusEditModeTests.cs`, `Assets/Tests/EditMode/CartographerScalableLinksEngineEditModeTests.cs`, PlayMode engine-preference checks in `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs`
  - Manual checks when needed: inspect `DynamicLinks`, `ScalableLinks`, and `Dates`, RecursiveHubs node spacing on hub-heavy maps, and the `Dates` camera slider
- Focus, labels, and line highlights
  - Automated checks: `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs`, `Assets/Tests/EditMode/MapGraphIndexEditModeTests.cs`, `Assets/Tests/EditMode/FocusLabelHighlightEditModeTests.cs`, `Assets/Tests/EditMode/LineBuilderEditModeTests.cs`
  - Manual checks when needed: focus stars and tags, confirm focused and linked label states, and confirm incident lines restyle together with selection
- Building callout rendering
  - Automated checks: `Assets/Tests/EditMode/BuildingManagerEditModeTests.cs`, building-update coverage in `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs`
  - Manual checks when needed: switch to `Buildings`, inspect callout budget behavior on dense graphs, focus a star with buildings, and confirm updated building lists refresh only the target star
- PlayMode bootstrap and visual stability
  - Automated checks: `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs`
  - Manual checks when needed: open `Assets/Scenes/StarScapeScene.unity`, enter Play mode, and confirm no missing scripts or critical console errors
- Interaction and camera
  - Automated checks: `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs` for universal equatorial focus direction, `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs` for runtime bootstrap and visual stability
  - Manual checks when needed: focus stars and tags in `DynamicLinks`, `ScalableLinks`, and `Dates`, then rotate and zoom to confirm the camera stays on the selected pivot's equator and only the horizontal orbit and distance change

Use `docs/VERIFICATION.md` for the exact check order, MCP-first policy, and fallback rules.

## Known Risks and Open Questions

- The scene YAML still references `Assembly-CSharp::CartographerStatic25DEngine` for the 2.5D component, while the code defines `Cartographer25DEngine`. Unity uses the script GUID, but the naming drift is worth keeping visible.
- `CartographerForcesEngine` destroys and recreates graph objects on each rebuild, so large note sets will pay that cost on every `graph:set`.
- `Cartographer25DEngine` still contains TODOs for date labels, radial movement, LOD, and the preferred camera start position.
- `GameInput` still depends on legacy `Input` and `EventSystem` APIs rather than the newer Input System package.
- `CartographerEngineRecursiveHubsEngine` remains serialized through the scene, so active large-graph ownership still depends on scene wiring.
- RecursiveHubs can make stars clickable before the final `MapGraphIndex` exists. Current click handling suppresses the early missing-index error; a complete UX fix would publish index entries incrementally as visible nodes are placed.
