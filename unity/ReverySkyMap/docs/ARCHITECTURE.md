# ReverySkyMap Unity Architecture

## Purpose and Scope

This Unity project renders the Obsidian note graph in a WebGL scene that is embedded in the parent plugin. The Unity-side scope is the runtime scene, bridge ingestion, graph layout, camera and interaction handling, and Unity tests that guard those paths.

High-level flow:

`Obsidian plugin -> WebGL bridge -> MapRuntimeContext -> Cartographer -> active engine -> camera/UI`

The Unity runtime consumes bridge payloads and never derives the vault graph on its own. Parent plugin lifecycle, packaging, and local host orchestration live outside this project boundary.

## System Overview

- Scene entry point:
  - Responsibility: hosts the runtime scene and serialized wiring for the map, UI, camera, and engines.
  - Main code location: `Assets/Scenes/StarScapeScene.unity`
  - Important dependencies: `GameInput`, `CameraOrbitalController`, `Cartographer`, `CartographerForcesEngine`, `Cartographer25DEngine`, the serialized `StaticLinks` slot engine, `ScapeCameraWarper`, `ChangeViewControl`, `RotateCameraUI`, `Notification`
- Bridge and runtime state:
  - Responsibility: validates inbound bridge envelopes, converts payloads into runtime models, stores the current graph snapshot, and raises outbound runtime events for parent bridge messages.
  - Main code location: `Assets/Scripts/Bridge/ObsidianBridge.cs`, `Assets/Scripts/Bridge/MapRuntimeContext.cs`, `Assets/Scripts/Models/NoteData.cs`
  - Important dependencies: `GameSettings`, `CartographerEngine`, `MapRuntimeContext.OnNotesChanged`, `MapRuntimeContext.OnOpenNoteRequested`, `MapRuntimeContext.OnGraphReady`
- Graph orchestration:
  - Responsibility: chooses the active layout engine, rebuilds the graph when runtime notes change, forwards rebuilt node lists into `LineBuilder` and `CullingManager`, and restores focus after ingest or selection.
  - Main code location: `Assets/Scripts/StarScape/Cartographer.cs`
  - Important dependencies: `ICartographerEngine`, `FocusNode`, `ChangeViewControl`, `Notification`, `SampleDataGenerator`, `MapRuntimeContext`, `LineBuilder`, `CullingManager`, `OnGraphVisualsChanged`
- Graph layout engines:
  - Responsibility: build and clear the active graph layout, tick when needed, and publish the star/tag node lists plus line budgets consumed by `LineBuilder`.
  - Main code location: `Assets/Scripts/StarScape/CartographerForcesEngine.cs`, `Assets/Scripts/StarScape/Cartographer25DEngine.cs`, `Assets/Scripts/StarScape/CartographerEngineRecursiveHubsEngine.cs`, `Assets/Scripts/StarScape/EngineExperiments/*`, `Assets/Scripts/Interfaces/ICartographerEngine.cs`
  - Important dependencies: `StarSO`, `TagNodeSO`, `ScapeCameraWarper`, `NoteData`, `MapRuntimeContext.RuntimeNoteLink`, `MaxActiveLines`, `MaxActiveLongLines`, `OnNodesChanged`
- Line rendering and culling:
  - Responsibility: build pooled line renderers for active note-note and note-tag connections, keep the visible edge set in sync with node visibility and focus, and share the distance-culling pipeline with other consumers.
  - Main code location: `Assets/Scripts/StarScape/LineBuilder.cs`, `Assets/Scripts/StarScape/CullingManager.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`, `Assets/Scripts/StarScape/LabelCullingTarget.cs`
  - Important dependencies: `MapRuntimeContext.Links`, `Star.Data.TagIds`, `FocusNode.SelectedStar`, `ICullingConsumer`, `LineRenderer`, `ObjectPool<LineRenderer>`, `CullingGroup`
- Interaction and camera:
  - Responsibility: turns touch and mouse input into focus, orbit, zoom, view switching, and note-open actions.
  - Main code location: `Assets/Scripts/GameInput/GameInput.cs`, `Assets/Scripts/StarScape/FocusNode.cs`, `Assets/Scripts/Camera/CameraOrbitalController.cs`, `Assets/Scripts/UI/ChangeViewControl.cs`, `Assets/Scripts/UI/RotateCameraUI.cs`
  - Important dependencies: `EventSystem`, `Camera.main`, `MapRuntimeContext`, `Cartographer.I`, `GameSettings`
- Visual assets and support objects:
  - Responsibility: provide prefabs, scale calibration, labels, shared culling consumers, and the optional sample graph injector.
  - Main code location: `Assets/Scripts/ScriptableObjects/StarSO.cs`, `Assets/Scripts/ScriptableObjects/TagNodeSO.cs`, `Assets/Scripts/StarScape/CullingManager.cs`, `Assets/Scripts/StarScape/LabelCullingTarget.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`, `Assets/Scripts/Notification/Notification.cs`, `Assets/Scripts/StarScape/SampleDataGenerator.cs`
  - Important dependencies: `Cartographer.OnGraphVisualsChanged`, `MapRuntimeContext.NotesVersion`, `MapRuntimeContext.HasRuntimeNotes`, prefab assets in `Assets/Prefabs`
- Automated checks:
  - Responsibility: guard bridge parsing, layout rules, and PlayMode bootstrap/visual stability.
  - Main code location: `Assets/Tests/EditMode/*`, `Assets/Tests/PlayMode/*`
  - Important dependencies: `ReverySkyMap.Runtime`, Unity Test Assemblies

## Execution Paths

### 1. Scene startup and editor-only sample data seed

1. Unity loads `Assets/Scenes/StarScapeScene.unity`.
2. `ObsidianBridge.EnsureInstance()` in `Assets/Scripts/Bridge/ObsidianBridge.cs` creates a persistent bridge object if the scene does not already contain one.
3. Scene wiring activates `GameInput`, `CameraOrbitalController`, `FocusNode`, `Cartographer`, the engine components, `ScapeCameraWarper`, `ChangeViewControl`, `RotateCameraUI`, and `Notification`. `SampleDataGenerator` is retained for editor-only sample seeding, not for shipped runtime fallback.
4. `Cartographer.Start()` calls `SampleDataGenerator.TryInjectSampleDataIfNeeded()` only inside `UNITY_EDITOR`, then calls `RebuildGraph(MapRuntimeContext.MapLayoutPreference)`.
5. `Cartographer` subscribes to `MapRuntimeContext.OnNotesChanged` and UI events so later payloads or button clicks can rebuild the active graph.

### 2. `graph:set` ingestion and graph rebuild

1. `ObsidianBridge.OnGraphSet(string json)` sets runtime mode and parses the envelope with `JsonUtility.FromJson`.
2. The bridge rejects payloads with a wrong `protocolVersion` or `type`, stores the envelope `requestId` in `MapRuntimeContext.GraphRequestId`, then normalizes the payload into `NoteData` and `MapRuntimeContext.RuntimeNoteLink` objects.
3. Tags are de-duplicated by name, blank titles become `GameSettings.DefaultTitle`, invalid dates become `DateTime.MinValue`, and non-positive link weights are normalized to `1`.
4. `MapRuntimeContext.SetTagNames`, `SetLinks`, and `SetNotes` store the runtime source of truth and raise `OnNotesChanged`.
5. `Cartographer.HandleRuntimeNotesChanged()` calls `RebuildGraph(MapRuntimeContext.MapLayoutPreference)`.
6. `Cartographer.ResolveModeByNotesCount()` uses `defaultEngine` first. Without an override, explicit `Static25D` and `StaticLinks` stay fixed, while `Auto` and `Forces` resolve by note count: small graphs use `Forces`, large graphs use `StaticLinks`.
7. The chosen engine runs `BuildGraph(notes)`, which emits `OnNodesChanged`; `Cartographer.HandleEngineNodesChanged(...)` immediately rebuilds `LineBuilder` and `CullingManager` from the same node lists and line budgets, then `ApplyView(CurrentView)` and `Cartographer`'s `ScapeCameraWarper` rebinding follow.
8. After `BuildGraph()`, `Cartographer` restores focus only from `FocusNode.FocusRestoreNoteId`; missing focus calls `ResetFocus()`.
9. Incremental engines retry delayed focus through `MapRuntimeContext.PendingFocusNoteId`.
10. When the active engine reaches its ready point, it calls `MapRuntimeContext.RequestGraphReady()`. `ObsidianBridge` forwards the matching `requestId` to JavaScript as `graph:ready`, unless the id is empty.

### 3. Note focus and open-note callback

1. `FocusNode.HandleTouch()` raycasts against `GameInput.Instance.InteractableLayers`.
2. Tapping a `Star` selects it, focuses the camera, and calls `MapRuntimeContext.RequestOpenNote(star.Data)`.
3. `MapRuntimeContext.OnOpenNoteRequested` reaches `ObsidianBridge.HandleOpenNoteRequested`.
4. In WebGL builds, `ObsidianBridge` forwards the event to JavaScript via `ReverySkyBridgePostNoteOpen(noteId, notePath)`.
5. Incoming `note:focus` messages call `ObsidianBridge.OnNoteFocus()`, which resolves the note through `Cartographer.FocusRuntimeNote()` and defers focus restore when the graph rebuild has not yet materialized the star.

`note:focus` is the live-follow path for active note changes without a graph rebuild and carries full note identity.

### 4. Runtime shutdown guard

1. Before the parent plugin detaches the iframe, the WebGL wrapper receives `runtime:shutdown` and forwards it to `ObsidianBridge.OnRuntimeShutdown(string json)` when the Unity instance can receive messages.
2. `ObsidianBridge` marks the bridge as shutting down and unsubscribes from `MapRuntimeContext.OnOpenNoteRequested`.
3. After shutdown starts, `OnGraphSet`, `OnNoteFocus`, and `HandleOpenNoteRequested` return without processing so the closing runtime cannot ingest new graph state, focus notes, or send late `note:open` callbacks.
4. `HandleGraphReadyRequested` also returns during shutdown so late engine completion cannot send `graph:ready`.
5. This is a bridge lifecycle guard only; parent hosting, iframe detachment, and full Unity engine teardown remain outside the Unity project boundary.

### 5. Camera and view controls

1. `GameInput` translates touch and mouse gestures into semantic events such as tap, swipe, pinch, wheel zoom, and right-drag rotation.
2. `CameraOrbitalController` listens to those events and keeps the camera orbiting around the current pivot.
3. `FocusNode` uses `CameraOrbitalController` to focus stars or tag nodes.
4. `ChangeViewControl` raises `OnChangeScapeView`, and `Cartographer.CycleView()` switches between `ScapeView.Planets` and `ScapeView.Plain`.
5. `RotateCameraUI` triggers continuous orbit rotation while a rotate button is held.

### 6. Line rendering and node distance culling

1. `Cartographer.HandleEngineNodesChanged(...)` receives the rebuilt `Star` and `TagNode` lists from the active engine, then forwards them with the active engine's line budgets to `LineBuilder.Rebuild(...)`.
2. `LineBuilder.Rebuild(...)` stores the new limits, clears active line renderers and cached state, resizes its `ObjectPool<LineRenderer>`, registers the graph nodes, and creates candidate note-note edges from `MapRuntimeContext.Links` plus note-tag edges from each star's `TagIds`.
3. `CullingManager.Rebuild(stars, tagNodes, lineBuilder)` scans the same physical nodes and asks each `ICullingConsumer` for an `Entry`; `LineBuilder.TryCreateDistanceEntry(...)` provides one consumer-specific culling rule per registered graph node.
4. When `CullingGroup` changes a node's visibility, `CullingManager` calls `LineBuilder.SetDistanceVisible(...)`, which updates the visible-node set and marks the edge set dirty.
5. `LineBuilder.LateUpdate()` applies the focused-node priority, keeps recently visible regions within a refresh budget, reconciles the desired edge set against the pooled renderers, and rewrites each active line's endpoints from the live transforms.
6. `Cartographer.CycleView()` calls `ApplyLineVisibility()`, so the current view only toggles whether the existing line renderers are shown; it does not rebuild the candidate edge set.

## Subsystems

### Bridge and runtime state

- `ObsidianBridge`
  - Responsibility: owns bridge validation, payload normalization, the shutdown guard, and WebGL callbacks back into the parent plugin.
  - Code anchor: `Assets/Scripts/Bridge/ObsidianBridge.cs::OnGraphSet`, `OnNoteFocus`, `OnRuntimeShutdown`, `HandleOpenNoteRequested`, `HandleGraphReadyRequested`
  - Entry point: bridge messages from the parent runtime
  - Calls / sends to: `MapRuntimeContext`, `Cartographer`, `ReverySkyBridgePostNoteOpen`, `ReverySkyBridgePostGraphReady`
- `MapRuntimeContext`
  - Responsibility: owns the live runtime graph snapshot, current graph request id, and pending focus note id.
  - Code anchor: `Assets/Scripts/Bridge/MapRuntimeContext.cs`
  - Entry point: `SetNotes`, `SetLinks`, `SetTagNames`, `SetGraphRequestId`, `RequestOpenNote`, `RequestGraphReady`
  - Calls / sends to: `Cartographer`, `StarSO`, `FocusNode`, `ObsidianBridge`
- `NoteData`
  - Responsibility: represents the normalized runtime note model consumed by engines and visuals.
  - Code anchor: `Assets/Scripts/Models/NoteData.cs`
  - Entry point: created by `ObsidianBridge` and sample data generation
  - Calls / sends to: `StarSO` and the active `ICartographerEngine` implementation

### Graph engines and layout

- `Cartographer`
  - Responsibility: chooses the active engine, rebuilds the graph, applies the current view, restores focus from the last selected star, and applies pending focus when stars appear asynchronously.
  - Code anchor: `Assets/Scripts/StarScape/Cartographer.cs::Start`, `RebuildGraph`, `BuildGraph`, `FocusRuntimeNote`
  - Entry point: `MapRuntimeContext.OnNotesChanged`, UI events, scene start
  - Calls / sends to: `ICartographerEngine`, `FocusNode`, `Notification`, `ScapeCameraWarper`
- `ICartographerEngine`
  - Responsibility: defines the common contract for engine selection, graph building, and navigation lookup.
  - Code anchor: `Assets/Scripts/Interfaces/ICartographerEngine.cs`
  - Entry point: implemented by active layout engines
  - Calls / sends to: `Cartographer`, `CameraOrbitalController`, `FocusNode`
- `CartographerForcesEngine`
  - Responsibility: builds a force-directed layout with note-tag edges, note-note links, and per-frame ticks.
  - Code anchor: `Assets/Scripts/StarScape/CartographerForcesEngine.cs::BuildGraph`, `Tick`, `ClearGraph`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `TagNodeSO`, `MapRuntimeContext.Links`
- `Cartographer25DEngine`
  - Responsibility: builds the date-based 2.5D layout and publishes date-axis range for the camera slider.
  - Code anchor: `Assets/Scripts/StarScape/Cartographer25DEngine.cs::BuildGraph`, `ClearGraph`, `OnDateAxisRangeChanged`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `ScapeCameraWarper`, `CameraOrbitalController`
- `StaticLinks` slot engines
  - Responsibility: provide the serialized large-graph engine selected by `Cartographer` when the resolved mode is `StaticLinks`. The accepted medium-and-large-map direction is RecursiveHubs; older candidates under `EngineExperiments` remain useful eval references.
  - Code anchor: `Assets/Scripts/StarScape/CartographerEngineRecursiveHubsEngine.cs::BuildGraph`, `Tick`, `ClearGraph`; `Assets/Scripts/StarScape/EngineExperiments/Engine_EmptySpheres.cs::BuildGraph`, `CalculateBoundRadius`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `TagNodeSO`, `MapRuntimeContext.RuntimeNoteLink`
- `CartographerEngineRecursiveHubsEngine`
  - Responsibility: builds the current RecursiveHubs large-graph layout by selecting structural maxima, recursively placing hub systems, refining links after placement, and preserving node space through a hard node-spacing constraint.
  - Code anchor: `Assets/Scripts/StarScape/CartographerEngineRecursiveHubsEngine.cs::BuildGraph`, `RunRefinementPass`, `ApplyLinkContractionCorrections`, `ApplyHardNodeSpacingPass`
  - Entry point: `Cartographer.BuildGraph`
  - Calls / sends to: `StarSO`, `TagNodeSO`, `MapRuntimeContext.RuntimeNoteLink`, `MapRuntimeContext.RequestGraphReady`
  - Spacing strategy: link contraction still controls connected-pair geometry, but collision-style hard node spacing owns the minimum center spacing between nearby nodes, including unrelated nodes. The old broader separation pass was removed; `hardNodeSpacingPassesPerRefinement = 0` disables the constraint.
- `ScapeCameraWarper`
  - Responsibility: warps the 2.5D layout around the camera based on engine-specific depth profiles.
  - Code anchor: `Assets/Scripts/StarScape/ScapeCameraWarper.cs::Rebind`, `ApplyWarp`, `Clear`
  - Entry point: rebound by `Cartographer` after a `Static25D` build
  - Calls / sends to: active engine `Stars`, `Camera.main`, `layoutParent`
- `StarSO`
  - Responsibility: instantiates star prefabs and scales them from runtime note-length statistics.
  - Code anchor: `Assets/Scripts/ScriptableObjects/StarSO.cs::Instantiate`
  - Entry point: called by both engines while building stars
  - Calls / sends to: `MapRuntimeContext.NotesVersion`, `NoteData`, `Star`
- `TagNodeSO`
  - Responsibility: supplies the tag-node prefab used by the force-directed engine.
  - Code anchor: `Assets/Scripts/ScriptableObjects/TagNodeSO.cs`
  - Entry point: called by `TagNode.Create`
  - Calls / sends to: `CartographerForcesEngine`

### Line rendering and culling

- `LineBuilder`
  - Responsibility: owns pooled line renderers, candidate edge selection, focus-priority ordering, recent-visibility refresh, and per-frame endpoint updates for the active graph.
  - Code anchor: `Assets/Scripts/StarScape/LineBuilder.cs::Rebuild`, `SetDistanceVisible`, `LateUpdate`, `ShowLine`
  - Entry point: `Cartographer.HandleEngineNodesChanged`, `CullingManager`, `Cartographer.CycleView`
  - Calls / sends to: `CullingManager`, `MapRuntimeContext.Links`, `FocusNode`, `LineRenderer`
- `CullingManager`
  - Responsibility: shares one `CullingGroup` across graph-node consumers and dispatches visibility changes only when a threshold actually changes.
  - Code anchor: `Assets/Scripts/StarScape/CullingManager.cs::Rebuild`, `Register`, `ApplyTargetVisibility`
  - Entry point: `Cartographer.HandleEngineNodesChanged`, `LineBuilder.Rebuild`
  - Calls / sends to: `LineBuilder`, `LabelCullingTarget`, `BehaviourCullingTarget`
- `ICullingConsumer` and prefab culling targets
  - Responsibility: define the distance-visibility contract used by graph-level consumers such as `LineBuilder`, `LabelCullingTarget`, and `BehaviourCullingTarget`.
  - Code anchor: `Assets/Scripts/StarScape/CullingManager.cs::ICullingConsumer`, `Assets/Scripts/StarScape/LabelCullingTarget.cs`, `Assets/Scripts/StarScape/BehaviourCullingTarget.cs`
  - Entry point: `CullingManager.Rebuild`
  - Calls / sends to: `CullingManager`

### Interaction, focus, and camera

- `GameInput`
  - Responsibility: converts raw input into semantic gestures and blocks UI hits before they reach the map.
  - Code anchor: `Assets/Scripts/GameInput/GameInput.cs::Update`, `HandleMouseInput`
  - Entry point: Unity `Update()`
  - Calls / sends to: `FocusNode`, `CameraOrbitalController`, `EventSystem`
- `FocusNode`
  - Responsibility: resolves taps on stars and tags into focus changes and note-open requests.
  - Code anchor: `Assets/Scripts/StarScape/FocusNode.cs::HandleTouch`, `SetSelectedStar`, `ResetFocus`
  - Entry point: `GameInput` events
  - Calls / sends to: `CameraOrbitalController`, `MapRuntimeContext`, `Cartographer.I`
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

- `MapRuntimeContext` is the source of truth for live runtime notes, links, tag names, runtime mode, pending focus note id, layout preference, and the `NotesVersion` counter.
- `ObsidianBridge` owns bridge validation and all conversion from the JSON envelope into runtime models.
- `Cartographer` owns engine selection, rebuild timing, current view, rebuild focus restoration, and pending focus application.
- `CartographerForcesEngine`, `Cartographer25DEngine`, and the engine assigned to `Cartographer.staticLinksEngineBehaviour` own placement and cleanup of instantiated stars and tags for their respective layout strategies; line visuals are handed off to `LineBuilder` after the engine raises `OnNodesChanged`.
- `LineBuilder` owns pooled line renderers, candidate edge selection, focus-priority ordering, recent-visibility refresh, and the per-frame endpoint refresh for the active graph.
- The current scene wiring assigns the `StaticLinks` slot to the RecursiveHubs baseline under eval, which can continue construction or refinement through `Tick()` after `BuildGraph()`. `Engine_EmptySpheres` remains a static fallback/evaluation engine with EditMode coverage for its radius calculations and static contract.
- RecursiveHubs space preservation is owned by the engine, not by Unity physics. The engine applies a deterministic spatial-grid hard spacing projection during refinement, after link contraction, and caps per-node collision checks for dense maps.
- `ScapeCameraWarper` owns the 2.5D warp state and only participates when the active engine is `Static25D`.
- `StarSO` recomputes note-length scale buckets whenever `MapRuntimeContext.NotesVersion` changes.
- `CullingManager` owns the shared `CullingGroup` and threshold transitions for graph nodes. Runtime tracking is split into `NodeTarget` and `Interest`: a `NodeTarget` is one physical graph node and one culling sphere, while each `Interest` is one consumer-specific distance rule and last visibility state.
- `ICullingConsumer` is the prefab-side contract for distance-driven behavior. A consumer describes its own `Entry` request and receives `SetDistanceVisible(node, visible)` only for first application or real threshold changes. Current consumers are `LabelCullingTarget` for label roots and `BehaviourCullingTarget` for one serialized `Behaviour`.
- `GameInput` treats UI hits as blocked input and only forwards gestures that originate on the map.
- Bridge contract rules that matter locally:
  - `protocolVersion` must match `2.0.0`.
  - Accepted parent-to-Unity message types are `graph:set`, `note:focus`, and `runtime:shutdown`.
  - `graph:set` payloads are already filtered by the parent plugin; Unity does not own vault query logic.
  - `graph:set` carries only the filtered graph payload; focus is handled separately through `note:focus`.
  - `graph:set.requestId` is echoed in `graph:ready` after active engine readiness; empty ids suppress outbound `graph:ready`.
  - `runtime:shutdown` is a lifecycle guard that stops bridge input and output without calling Unity quit APIs.
  - `path` values are treated as vault-relative and normalized with `/` separators when path lookup is needed.
  - Empty titles fall back to `GameSettings.DefaultTitle`.
  - Negative note sizes clamp to `0`.
  - Non-positive link weights normalize to `1`.
  - Unknown bridge fields are ignored.
- `Cartographer.ResolveModeByNotesCount()` uses `defaultEngine` first, then preserves explicit `Static25D` and `StaticLinks`, then resolves `Auto` and `Forces` by the note-count threshold.
- Camera focus contract: `CameraOrbitalController.Focus()` always flattens the focus direction to the horizontal XZ plane before placing the camera. The resulting camera position keeps the focused pivot's `y`, the orbit stays equatorial, and the rule does not depend on the active engine. `Dates` uses the same universal camera placement rule.

## Build, Packaging, and Deployment

- Runtime code is grouped under `ReverySkyMap.Runtime` in `Assets/Scripts/ReverySkyMap.Runtime.asmdef`.
- Test assemblies are split by Unity test mode:
  - `Assets/Tests/EditMode/ReverySkyMap.EditModeTests.asmdef`
  - `Assets/Tests/PlayMode/ReverySkyMap.PlayModeTests.asmdef`
- The scene entry point is `Assets/Scenes/StarScapeScene.unity`.
- Prefabs and ScriptableObjects that define the visible runtime live under `Assets/Prefabs`, `Assets/_Visuals`, and `Assets/ScriptableObjects`.
- Package-level dependencies in `Packages/manifest.json` include URP, UGUI, TextMesh Pro, and `com.gamelovers.mcp-unity` for Unity MCP-based verification.
- The Unity side stops at the exported scene/runtime boundary; parent plugin hosting and WebGL import are handled outside this subproject.

## Verification

- Bridge parsing and runtime mapping:
  - Automated checks: `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs`
  - Manual checks when needed: load the scene and confirm `graph:set` populates notes, links, tags, request id, and focus state without errors; in the parent plugin, close and quickly reopen the map view and confirm there are no delayed `note:open`, stale `graph:ready`, or bridge errors
- Engine selection and layout:
  - Automated checks: `Assets/Tests/EditMode/CartographerForcesEngineRadiusEditModeTests.cs`, `Assets/Tests/EditMode/CartographerScalableLinksEngineEditModeTests.cs`, PlayMode engine-preference checks in `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs`
  - Manual checks when needed: inspect force layout, static-link slot output, RecursiveHubs hard node spacing on hub-heavy maps, date-range behavior, and the `Static25D` camera slider
- Line rendering and culling:
  - Automated checks: `Assets/Tests/EditMode/LineBuilderEditModeTests.cs`
  - Manual checks when needed: load a populated graph, switch between `Planets` and `Plain`, and confirm lines appear only in `Planets`, react to focus and visibility changes, and keep their endpoints attached to moving nodes
- PlayMode bootstrap and visual stability:
  - Automated checks: `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs` (`StarScapeRuntimePlayModeTests`)
  - Manual checks when needed: open `Assets/Scenes/StarScapeScene.unity`, enter Play mode, and confirm no missing scripts or critical console errors
- Interaction and camera:
  - Automated checks: `Assets/Tests/EditMode/ObsidianBridgeEditModeTests.cs` for universal equatorial focus direction, `Assets/Tests/PlayMode/StarScapeRuntimePlayModeTests.cs` for runtime bootstrap and visual stability
  - Manual checks when needed: focus stars and tags in `DynamicLinks`, `ScalableLinks`, and `Dates`, then rotate and zoom to confirm the camera stays on the selected pivot's equator and only the horizontal orbit and distance change

Use `docs/VERIFICATION.md` for the exact check order, MCP-first policy, and fallback rules.

## Known Risks and Open Questions

- The scene YAML still references `CartographerStatic25DEngine` for the 2.5D component, while the code defines `Cartographer25DEngine`. The runtime may still be fine if the serialized script reference is correct, but the naming drift is worth keeping visible.
- The scene YAML also contains legacy class identifiers such as `CartographerStaticLinksEngine` on components whose script GUIDs now resolve to experiment classes. Treat GUID/script references as authoritative when checking scene wiring.
- `CartographerForcesEngine` destroys and recreates graph objects on each rebuild, so large note sets will pay that cost on every `graph:set`.
- `Cartographer25DEngine` still contains TODOs for date labels, radial movement, LOD, and the preferred camera start position.
- Several `StaticLinks` candidates live under `Assets/Scripts/StarScape/EngineExperiments`; this is useful for evaluation but keeps active engine ownership dependent on scene serialization.
- `GameInput` still depends on legacy `Input` and `EventSystem` APIs rather than the newer Input System package.
- `ObsidianBridge` is auto-created at runtime, so its presence is implicit rather than scene-owned.
