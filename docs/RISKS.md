# Technical Risks and Mitigations

This document tracks the main runtime, packaging, and lifecycle risks for the Obsidian plugin and its Unity WebGL runtime.

## 1. WebGL Runtime Compatibility in Obsidian

Risk:
- Unity may behave differently under Obsidian and Electron constraints.

Mitigation:
- Keep runtime hosting on the local loopback server.
- Validate startup after reloads and plugin lifecycle transitions.

## 2. Bridge Reliability

Risk:
- Message ordering or readiness timing can drop payloads.

Mitigation:
- Enforce `bridge:ready` before `graph:set`.
- Keep strict envelope validation and explicit error reporting.

## 3. Asset Path Integrity

Risk:
- Exported runtime assets can break when filenames change.

Mitigation:
- Regenerate build config from the exported files.
- Keep deterministic alias filenames in `unity-webgl/Build`.

## 4. Build Artifact Size and Packaging

Risk:
- Large runtime assets can hurt repository usability and distribution.

Mitigation:
- Keep generated outputs out of Git.
- Keep `unity-webgl/index.html`, most `unity-webgl/Build/*`, and `unity-webgl/TemplateData/*` local.
- Treat the compact `embedded-archive` runtime input listed in `docs/PACKAGING_MODES.md` as the tracked exception for release-candidate builds.
- Exclude optional large skybox source textures as documented in `unity/ReverySkyMap/Assets/README.txt`.
- Keep runtime generation script-driven and reproducible.

## 5. Embedded HTML Package Size

Risk:
- `embedded-html` embeds the self-contained WebGL HTML into root `main.js`, which can raise startup cost.

Mitigation:
- Measure packaged `main.js` size and Obsidian startup behavior.
- Keep runtime startup lazy when the graph view opens.
- Keep generated package output outside Git.

## 6. Embedded Archive Cache Extraction

Risk:
- `embedded-archive` embeds a compressed runtime archive in root `main.js`.
- The first graph open extracts it into `.reverysky-runtime/<version>/`.
- Later opens and restarts reuse the cache.
- Validation and replacement must stay strict to avoid partial installs.
- A plugin lifecycle interruption during the first extraction could leave a transient missing or invalid cache if a second plugin instance starts preparing the same version before the first one finishes.

Mitigation:
- Keep archive validation and cache replacement strict.
- Keep normal graph-view startup serialized by the plugin runtime URL owner so multiple graph leaves do not independently extract the same cache.
- Limit the impact to that version's runtime startup.
- Avoid file-locking or claim-file complexity unless real reports show the recovery path fails in normal use.
- Keep `embedded-archive` as the current release-shaped candidate; dashboard submission and scan status are tracked separately.

## 7. Vault Graph Scale

Risk:
- Large vaults can increase graph build latency.

Mitigation:
- Keep extraction deterministic and lightweight.
- Add throttled refresh behavior for metadata events.

## 8. Unity-to-Note Resolution

Risk:
- Node references can drift after file moves or renames.

Mitigation:
- Resolve by stable ID first, then path fallback.
- Keep normalized path conventions consistent across bridge layers.

## 9. External Obsidian Popout ResizeObserver Flood

Risk:
- Obsidian desktop can repeatedly emit `ResizeObserver loop completed with undelivered notifications` after closing a popout window with multiple leaves, tabs, or split panes.
- The issue reproduces without ReverySky enabled, so it appears to be an Obsidian or Electron popout lifecycle issue rather than a plugin bug.
- The practical impact is not fully confirmed, but repeated console flooding may slow the renderer until Obsidian is reloaded.

Mitigation:
- Do not treat this as a WebGL shutdown or iframe cleanup bug.
- Do not change Unity shutdown, iframe teardown, or note-opening layout behavior solely to work around this external issue.
- If users report sluggishness after closing complex popout layouts, recommend reloading Obsidian.
- Revisit a ReverySky-specific workaround only if reports show this issue is common in normal use.

## 10. Native Note Open Routing with Popout Windows

Risk:
- Note clicks from the Unity graph travel through an iframe bridge, so Obsidian may not treat the graph view as the active workspace leaf before `app.workspace.openLinkText(...)` runs.
- With popouts present, Obsidian may route the open action to whichever workspace context it currently considers active.
- Clicks can therefore open notes in the main workspace or a popout.

Mitigation:
- Keep note opening delegated to Obsidian with `app.workspace.openLinkText(...)`.
- Do not use `OpenViewState.group` for note opening because it is tied to workspace grouping and can create linked-pane side effects.
- Do not force `workspace.setActiveLeaf(...)` solely to steer main-window versus popout routing unless user reports show the native behavior is worse than the focus-state risk.
- Keep active-note tracking global so markdown navigation inside popouts can still update graph focus.

## 11. Unexpected Multiple Graph Leaves

Risk:
- The plugin command intentionally opens and owns a single 3D graph leaf.
- Workspace state, saved layouts, plugin reload timing, or manual workspace changes can still create more than one leaf.
- Multiple leaves are tolerated as a recovery case, but they are not the primary workflow.
- Runtime server startup and shutdown are owned by the plugin and shared across open graph leaves.
- Each leaf owns its own `MapSession`, graph snapshot, filter state, bridge lifecycle, focus gate, refresh timer, and Obsidian event listeners.
- If several graph leaves are open, graph or metadata events can trigger one refresh path per leaf.
- Persistence restores only the most recently reported state on later opens.

Mitigation:
- Keep `src/commands/MapCommands.ts` -> `activateMapView()` single-leaf behavior intact.
- Keep plugin-level runtime server ownership serialized and lease-based so one graph leaf cannot stop the server while another is active.
- Keep cleanup and focus-broadcast paths defensive where Obsidian exposes array-based leaf APIs.
- Keep independent per-leaf sessions unless real performance reports justify a shared source-graph cache.
- Before making multi-graph behavior a first-class feature, define per-view persisted state ownership and decide whether refresh should remain per leaf or move to a plugin-level cache.

## 12. Iframe Navigation Failure During Obsidian Window Migration

Risk:
- Moving the graph view between the main window and an Obsidian popout can put iframe navigation into an Electron-owned transition state.
- The iframe may stay on `about:blank`.
- DevTools may report `index.html:1 Uncaught illegal access`.
- The failure happens before the Unity wrapper builds its normal runtime DOM.

Mitigation:
- Treat Obsidian window migration as a runtime iframe restart point.
- Defer the fresh iframe navigation until after the migration callback returns.
- Keep the parent-side `Loading graph runtime...` fallback visible behind the iframe so a failed or delayed runtime page is not a silent black screen.
- Treat remaining reports as Electron or Obsidian iframe lifecycle edge cases first.
- Do not change graph emission, Unity layout, or bridge payload contracts solely for this symptom.

## 13. WebGL Context Loss During Resize or Window Movement

Risk:
- Obsidian resize, popout movement, or GPU pressure can cause the Unity canvas to lose its WebGL context.
- A lost context is terminal for the current iframe runtime.
- The plugin should not assume Unity can continue rendering after it happens.

Mitigation:
- Keep the iframe wrapper's `webglcontextlost` handling explicit.
- Show `WebGL context lost. Reload the graph view.` when context loss is detected.
- Prefer user-visible reload guidance over complex automatic recovery unless repeated reports show that a controlled restart is necessary.

## 14. Explicit Unity WebGL Quit During View Teardown

Risk:
- Unity WebGL exposes `unityInstance.Quit()` as the canonical shutdown API, but the parent plugin cannot call it directly because the Unity instance lives inside the iframe wrapper.
- A reliable explicit quit path would require an asynchronous shutdown handshake across `MapView`, the iframe bridge, the iframe HTML wrapper, Unity boot timing, Obsidian tab close, plugin unload, and window migration.
- That quickly adds lifecycle state, timeouts, late-boot handling, duplicate template logic, and stale async continuation risks.
- Repeated graph open and close behavior already works through browser-level iframe teardown, where Electron and Chromium eventually release the iframe JavaScript, WebGL, and GPU resources.
- No reproducible retention bug has confirmed that missing `unityInstance.Quit()` is the root cause.

Mitigation:
- Do not add explicit `unityInstance.Quit()` to production shutdown paths without a reproducible memory, GPU resource, WebGL runtime, or plugin deletion failure that points to live Unity runtime retention.
- Treat `unityInstance.Quit()` as a deferred architecture option, not a missing cleanup step.
- Keep current parent-owned cleanup simple: stop view and session work, detach bridge listeners, remove iframe content, and stop the local runtime server when no graph leaves remain.
- Investigate plugin uninstall or delete hangs as a separate file-handle and unload-order problem before attributing them to Unity runtime quit behavior.
- If this direction is reopened, first capture a baseline without explicit quit, define the exact failure being fixed, and keep any proposed quit path bounded and measurable.

## 15. High WebGL Render Resolution

Risk:
- Canvas backing size depends on panel size, `devicePixelRatio`, and the user-controlled plugin Render Scale.
- The iframe wrapper keeps a high-end hard ceiling of `8192` pixels per canvas side, which can still allow a very large backing buffer on large or high-DPI displays.
- The Unity URP asset intentionally uses Render Scale `1.2` as the visual baseline, so the internal game render target can be larger than the WebGL canvas backing resolution.
- HDR, MSAA, Opaque Texture, Bloom, and URP intermediate render targets can multiply peak GPU memory pressure beyond a single color buffer.
- On systems with limited GPU memory, integrated graphics, or fragile Electron or ANGLE WebGL behavior, aggressive Render Scale values can increase the chance of slow rendering or context loss.

Mitigation:
- Keep the current high-quality baseline: use Unity URP Render Scale `1.2` unless real reports show that the default is broadly unstable.
- Keep the `8192` canvas-side ceiling as a guardrail rather than reducing quality for capable systems.
- Leave plugin Render Scale under user control so users can choose the quality/performance trade-off that fits their hardware.
- Document that higher Render Scale values sharpen the graph but use more GPU power.
- If users report instability, advise lowering plugin Render Scale first, then investigate whether a targeted safe mode or clearer in-UI warning is needed.

## 16. WebGL Memory High-Water Mark

Risk:
- Unity WebGL uses a contiguous WebAssembly memory heap.
- The heap can grow while the runtime is active, but it cannot shrink until the current Unity instance is destroyed.
- A large graph, rebuild spike, or temporary duplicate representation can expand the heap and keep the embedded runtime at that high-water allocation for the rest of the Obsidian session.
- Long-running sessions can therefore retain a high memory footprint after the graph returns to normal size.

Mitigation:
- Prevent excessive temporary allocation peaks, because each one can permanently raise the active runtime instance's memory high-water mark.
- Reduce the time window where old and new map data coexist during graph rebuilds.
- Reduce temporary arrays, dictionaries, parsed JSON objects, and duplicate graph representations in the bridge and Unity ingest path.
- Audit collection behavior after processing a 10,000-node graph and identify containers that retain large internal capacities after `Clear()`.
- Avoid unnecessary geometric over-allocation when graph visuals are rebuilt.
- Set Unity WebGL Maximum Memory Size only after measuring worst-case usage and adding a deliberate reserve.
- Treat an out-of-memory failure at that ceiling as an expected hard stop, not graceful recovery.

## 17. Host Frame Cadence Limits

Risk:
- Obsidian desktop runs the Unity WebGL map inside an Electron or Chromium iframe, so the browser host controls the `requestAnimationFrame` cadence seen by WebGL.
- Local diagnostics observed iframe `requestAnimationFrame` near 60 FPS on a 120 Hz display.
- `Auto` frame-rate mode uses Unity vSync, but the effective cadence may still be capped by Obsidian or Electron before Unity reaches the physical monitor refresh rate.
- Lower fixed caps can reduce Unity frame work in some cases, but GPU readings and perceived device load may not drop proportionally.

Mitigation:
- Present the setting as `Frame rate`, not as a guaranteed power-saving mode.
- Keep `Auto` as the default because it follows the host cadence and avoids forcing a lower software cap.
- Treat fixed modes as user-controlled caps for systems where lower Unity frame frequency helps stability or comfort.

## 18. Runtime Startup May Never Reach `bridge:ready`

Risk:
- The iframe may load partially, or the Unity runtime may fail before sending `bridge:ready`.
- When `bridge:ready` never arrives, the plugin must not send `graph:set`.
- The latest graph payload can remain pending while the runtime is not ready.
- The visible result depends on how far startup progressed: the parent-side loading fallback, the iframe wrapper's startup status, or the iframe wrapper's runtime failure status.

Mitigation:
- Keep `bridge:ready` as the gate before sending `graph:set`.
- Keep startup and failure statuses visible in the iframe wrapper when the wrapper starts successfully.
- Keep the parent-side loading fallback visible for cases where the runtime page does not build its own status UI.
- If users report persistent startup stalls, diagnose runtime startup separately from window migration and bridge payload handling.

## 19. Best-Effort Screenshot Copy

Risk:
- The screenshot action is intentionally on-demand and low-priority; it does not add a background capture loop or continuous polling.
- PNG encoding and clipboard writes can create a short CPU and memory spike when the user clicks the screenshot button.
- The runtime may return an empty or black frame if the canvas has not finished presenting a stable image, if the WebGL buffer is unavailable, or if the host is under GPU pressure.
- Rapid repeat clicks or overlapping requests can produce duplicate work or stale replies if the UI does not keep the action single-flight.

Mitigation:
- Keep the feature best-effort and user-initiated only.
- Keep the screenshot flow single-flight so only one capture is processed at a time.
- Prefer clear error reporting over silent retries when the canvas is not ready or returns no blob.
- Treat a black or empty screenshot as an expected edge case for this feature, not as a full runtime failure.
- Avoid background capture or automatic retry logic unless real usage data shows the one-shot approach is too fragile.

## Architecture Risks and Hardening Plan

The core architecture is intentional: ReverySky 3D Graph embeds a Unity WebGL runtime inside an Obsidian plugin and sends live graph data across several runtime boundaries.

The documentation now explicitly separates local WebGL hosting from bridge messaging. The remaining risks are not about understanding the architecture, but about keeping the cross-runtime bridge stable as the project evolves.

### 1. Cross-runtime bridge failures can be hard to localize

The live graph path crosses several handoff points:

- Obsidian plugin TypeScript
- iframe window via `postMessage`
- iframe JavaScript wrapper
- Unity via `unityInstance.SendMessage(...)`
- Unity C# `ObsidianBridge`
- `MapRuntimeContext`

Risk:

* A broken update may look like “Unity did not refresh”, while the actual failure can be in graph emission, message validation, iframe delivery, wrapper code, JavaScript-to-Unity dispatch, or Unity C# ingest.

Hardening:

* Keep the bridge path documented as a sequence, not as one generic “bridge”.
* Keep boundary-level diagnostics clear enough to identify where the message stopped:

  * plugin emitted `graph:set`;
  * iframe wrapper received it;
  * iframe wrapper dispatched it to Unity;
  * Unity C# accepted or rejected it;
  * `MapRuntimeContext` updated.

### 2. Iframe wrapper logic can drift between templates

The iframe JavaScript wrapper is part of the bridge. It receives `postMessage` events, calls `unityInstance.SendMessage(...)`, and posts runtime events back to the parent plugin window.

Risk:

* If similar wrapper logic exists in more than one HTML template, package modes can diverge.
* One template may handle `graph:set`, `note:focus`, `bridge:ready`, `note:open`, or shutdown differently from another.

Hardening:

* Prefer one maintained source for shared iframe bridge behavior when practical.
* Until then, every wrapper change must review all HTML templates that contain bridge logic.
* Keep wrapper responsibilities narrow:

  * receive parent messages;
  * forward supported messages to Unity;
  * send runtime events back to the parent.

### 3. JavaScript-to-Unity calls depend on string contract names

The iframe wrapper calls Unity through string-based `SendMessage` calls, for example:

`unityInstance.SendMessage("ObsidianBridge", "OnGraphSet", json)`

Risk:

* Renaming the Unity GameObject or public C# bridge methods can break runtime communication.
* TypeScript tests and TypeScript compilation will not catch these Unity string-contract breaks.

Hardening:

* Treat these names as part of the runtime bridge contract:

  * `ObsidianBridge`;
  * `OnGraphSet`;
  * `OnNoteFocus`;
  * `OnRuntimeShutdown`.
* Change them only together with:

  * iframe wrapper updates;
  * Unity C# updates;
  * architecture/data-contract docs;
  * manual bridge verification.

### 4. Runtime-created `ObsidianBridge` can be accidentally duplicated or moved into scene ownership

`ObsidianBridge` is intentionally created as a runtime service object before scene load. It is not a scene-authored visual object.

Risk:

* A future Unity refactor may add a scene-authored `ObsidianBridge` while auto-creation still exists.
* That can create duplicate bridge objects or make bridge availability depend on a specific scene.

Hardening:

* Keep `ObsidianBridge` as a runtime-created service object unless the architecture is deliberately changed.
* If it becomes scene-authored later, redesign the auto-creation path at the same time.
* Preserve early bridge availability before graph payloads can be dispatched.

### 5. Source/template/generated boundaries around WebGL runtime must stay explicit

The architecture depends on several different file roles:

- Unity source project
- WebGL export
- `unity-webgl` templates
- generated runtime files
- tracked compact runtime input for `embedded-archive`
- packaged plugin output

Risk:

* Future changes can accidentally edit generated runtime output instead of source or templates.
* Bridge wrapper fixes can be made in the wrong file and lost on the next import/build.
* Unity-side changes can be present in source but missing from the packaged WebGL runtime.
* The tracked compact runtime input can be mistaken for disposable local output, breaking release-candidate builds that rebuild `main.js` from repository contents.

Hardening:

* Keep source, template, generated runtime, and packaged output roles explicit in reviews.
* Preserve the tracked compact runtime input required by `embedded-archive` unless the Unity WebGL export/import workflow intentionally refreshes it.
* Prefer source/template changes plus regeneration over direct edits to generated runtime files.
* After Unity-side bridge changes, verify that the WebGL export/import path was run and the packaged runtime contains the expected bridge behavior.

### Hardening priorities

1. Keep the bridge path easy to diagnose at runtime.
2. Reduce or carefully synchronize duplicated iframe wrapper logic.
3. Treat JavaScript-to-Unity names as stable contract names.
4. Preserve the intended lifetime of the runtime-created `ObsidianBridge`.
5. Keep WebGL source, templates, generated files, and package output clearly separated.
