# Technical Risks and Mitigations

## 1. WebGL Runtime Compatibility in Obsidian
Risk:
- Unity runtime may fail under Obsidian/Electron constraints.

Mitigation:
- Keep runtime hosting on local loopback server.
- Validate startup after reload and plugin lifecycle transitions.

## 2. Bridge Reliability
Risk:
- Message ordering or readiness timing can cause dropped payloads.

Mitigation:
- Enforce `bridge:ready` handshake before sending `graph:set`.
- Maintain strict envelope validation and explicit error reporting.

## 3. Asset Path Integrity
Risk:
- Runtime assets may break after export due to filename changes.

Mitigation:
- Regenerate build config from actual exported files.
- Use deterministic alias filenames in `unity-webgl/Build`.

## 4. Build Artifact Size
Risk:
- Large runtime assets can degrade repository usability and distribution.

Mitigation:
- Keep generated outputs out of Git.
- Keep `unity-webgl/index.html`, most `unity-webgl/Build/*`, and `unity-webgl/TemplateData/*` as local generated artifacts.
- Treat the compact `embedded-archive` runtime input listed in `docs/PACKAGING_MODES.md` as the exception: it is generated/imported, but tracked intentionally for release-candidate builds.
- Exclude optional large skybox source textures from commits as documented in `unity/ReverySkyMap/Assets/README.txt`.
- Keep runtime generation script-driven and reproducible.

## Embedded HTML main.js size
- `embedded-html` embeds the self-contained Unity WebGL HTML into root `main.js`;
- runtime starts lazily when the graph view opens;
- packaged `main.js` size and Obsidian startup behavior must be measured;
- dashboard submission and scan status are tracked separately from package-mode behavior;
- generated package output stays outside Git.

## Embedded archive cache extraction
- `embedded-archive` embeds a compressed Unity runtime archive in root `main.js`;
- the first graph open extracts the runtime into `.reverysky-runtime/<version>/`;
- later opens and later Obsidian restarts reuse the cache without network download;
- archive validation and cache replacement must stay strict to avoid partial installs;
- normal graph-view startup is serialized by the plugin runtime URL owner, so multiple graph leaves do not independently extract the same cache;
- accepted residual risk: plugin lifecycle interruption during the first extraction could leave a transient missing or invalid cache if a second plugin instance starts preparing the same version before the first one finishes;
- impact is limited to Unity runtime startup for that version; vault data and user notes are not affected, and a later startup can rebuild the cache;
- do not add file-locking or claim-file complexity unless user reports show this recovery path fails in normal use;
- `embedded-archive` is the current release-shaped candidate, while dashboard submission and scan status are tracked separately.

## 5. Vault Graph Scale
Risk:
- Large vaults can increase graph build latency.

Mitigation:
- Keep extraction deterministic and lightweight.
- Add throttled refresh behavior for metadata events.

## 6. Unity-to-Note Resolution
Risk:
- Node references may drift after file moves/renames.

Mitigation:
- Resolve by stable ID first, then path fallback.
- Keep normalized path conventions consistent across bridge layers.

## 7. External Obsidian Popout ResizeObserver Flood

Risk:

* Obsidian desktop can repeatedly emit `ResizeObserver loop completed with undelivered notifications` after closing a popout window that contains multiple leaves, tabs, or split panes.
* The issue reproduces without ReverySky enabled, so it appears to be an Obsidian/Electron popout lifecycle issue rather than a ReverySky runtime or bridge issue.
* The practical impact is not fully confirmed, but a repeated console flood may degrade renderer responsiveness until Obsidian is reloaded.

Observed reproduction:

1. Disable the ReverySky plugin.
2. Restart Obsidian.
3. Open a regular Markdown note in a popout window.
4. Create multiple tabs or split panes inside that popout.
5. Close the popout.
6. The main renderer console may repeatedly log:
   `Uncaught ResizeObserver loop completed with undelivered notifications`

Mitigation:

* Do not treat this as a ReverySky WebGL shutdown or iframe cleanup bug.
* Do not change Unity runtime shutdown, iframe teardown, or note-opening layout behavior solely to work around this external issue.
* If users report Obsidian becoming sluggish after closing complex popout layouts, recommend reloading Obsidian.
* Reconsider a ReverySky-specific workaround only if there are user reports that graph popouts commonly trigger this issue in normal use.

## 8. Native Note Open Routing with Popout Windows

Risk:

* Note clicks from the Unity WebGL graph are delivered through an iframe bridge, so Obsidian may not treat the graph view as the active workspace leaf before `app.workspace.openLinkText(...)` runs.
* When popout windows are present, Obsidian may route the native open action to whichever workspace context it currently considers active.
* This can make graph node clicks open notes in either the main workspace or a popout window, depending on Obsidian's active workspace state.

Mitigation:

* Keep note opening delegated to Obsidian with `app.workspace.openLinkText(...)`.
* Do not use `OpenViewState.group` for note opening; that field is tied to workspace grouping behavior and can create linked-pane side effects.
* Do not force `workspace.setActiveLeaf(...)` solely to steer main-window versus popout routing unless user reports show the native behavior is worse than the focus-state risk.
* Keep active-note tracking global so markdown navigation inside popout windows can still update graph focus.

## 9. Unexpected Multiple Graph Leaves

Risk:

* The plugin command intentionally opens and owns a single ReverySky 3D Graph leaf: repeated open actions reveal the existing leaf instead of creating another one.
* Obsidian workspace state, saved layouts, plugin reload timing, or manual workspace manipulation may still create more than one ReverySky 3D Graph leaf.
* Multiple graph leaves are tolerated as a recovery case, but they are not the primary workflow.
* Runtime server startup and shutdown are owned by the plugin and shared across open graph leaves.
* Each open graph leaf owns an independent `MapSession`, graph snapshot, filter state, bridge lifecycle, focus gate, refresh timer, and Obsidian event listeners.
* Accepted cost: if several graph leaves are open, graph-relevant vault or metadata events can trigger one refresh path per leaf.
* Open graph leaves keep their own in-memory filter/session state, but persistence restores only the most recently reported state on later opens.

Mitigation:

* Keep `activateMapView()` single-leaf behavior intact.
* Keep plugin-level runtime server ownership serialized and lease-based so one graph leaf cannot stop the server while another leaf is active.
* Keep cleanup and focus broadcast paths defensive where Obsidian exposes array-based leaf APIs.
* Keep independent per-leaf sessions unless real performance reports justify a shared source-graph cache.
* Before making multi-graph behavior a first-class feature, define per-view persisted state ownership and whether graph refresh should remain per-leaf or move to a plugin-level cache.

## 10. Iframe Navigation Failure During Obsidian Window Migration

Risk:

* Moving the graph view between the main window and an Obsidian popout can put iframe navigation into an Electron-owned transition state.
* The iframe may stay on an empty `about:blank` document, and DevTools may report `index.html:1 Uncaught illegal access`.
* The failure happens before the Unity wrapper has built its normal runtime DOM.

Mitigation:

* Handle Obsidian window migration as a runtime iframe restart point.
* Defer the fresh iframe navigation until after the migration callback returns.
* Keep the parent-side `Loading graph runtime...` fallback visible behind the iframe so a failed or delayed runtime page is not a silent black screen.
* Treat remaining reports as Electron/Obsidian iframe lifecycle edge cases first.
* Do not change graph emission, Unity layout, or bridge payload contracts solely for this symptom.

## 11. WebGL Context Loss During Resize or Window Movement

Risk:

* Obsidian resize, popout movement, or GPU pressure can cause the Unity canvas to lose its WebGL context.
* A lost WebGL context is terminal for the current iframe runtime; the plugin should not assume Unity can continue rendering after this event.

Mitigation:

* Keep the iframe wrapper's `webglcontextlost` handling explicit.
* Show the runtime status `WebGL context lost. Reload the graph view.` when context loss is detected.
* Prefer user-visible reload guidance over complex automatic recovery unless repeated user reports show that a controlled restart is necessary.

## 12. Explicit Unity WebGL Quit During View Teardown

Risk:

* Unity WebGL exposes `unityInstance.Quit()` as the canonical runtime shutdown API, but the plugin parent cannot call it directly because the Unity instance lives inside the iframe wrapper.
* A reliable explicit quit path would require an asynchronous shutdown handshake across `MapView`, the iframe bridge, the iframe HTML wrapper, Unity boot timing, Obsidian tab close, plugin unload, and window migration.
* Local implementation analysis showed that this handshake quickly adds lifecycle state, timeouts, late-boot handling, duplicate template logic, and stale async continuation risks.
* Existing repeated graph open and close behavior works through browser-level iframe teardown, where Electron/Chromium eventually releases the iframe JavaScript, WebGL, and GPU resources.
* No reproducible resource-retention bug has confirmed that missing `unityInstance.Quit()` is the root cause.

Mitigation:

* Do not add explicit `unityInstance.Quit()` to production shutdown paths without a reproducible memory, GPU resource, WebGL runtime, or plugin deletion failure that points to live Unity runtime retention.
* Treat `unityInstance.Quit()` as a deferred architecture option, not a missing required cleanup step.
* Keep the current parent-owned cleanup simple: stop view/session work, detach bridge listeners, remove iframe content, and stop the local runtime server when no graph leaves remain.
* Investigate plugin uninstall or delete hangs as a separate file-handle and unload-order problem before attributing them to Unity runtime quit behavior.
* If this direction is reopened, first capture a baseline without explicit quit, define the exact failure being fixed, and keep any proposed quit path bounded and measurable.

## 13. High WebGL Render Resolution

Risk:

* The WebGL canvas backing size is derived from the graph view panel size, the browser `devicePixelRatio`, and the user-controlled plugin Render Scale.
* The iframe wrapper keeps a high-end hard ceiling of `8192` pixels per canvas side, which can allow a very large backing buffer on large or high-DPI displays.
* The Unity URP asset intentionally uses Render Scale `1.2` as the ReverySky visual baseline, so the internal game render target can be larger than the WebGL canvas backing resolution.
* HDR, MSAA, Opaque Texture, Bloom, and URP intermediate render targets can multiply peak GPU memory pressure beyond a single color buffer.
* On systems with limited GPU memory, integrated graphics, or fragile Electron/ANGLE WebGL behavior, aggressive user Render Scale values can increase the chance of slow rendering or WebGL context loss.

Mitigation:

* Treat the current high-quality visual baseline as intentional: keep Unity URP Render Scale `1.2` unless real user reports show that the default is broadly unstable.
* Keep the `8192` canvas-side ceiling as a high-end guardrail rather than reducing image quality for capable systems.
* Leave the plugin Render Scale under user control so users can choose the quality/performance trade-off that fits their hardware and visual preference.
* Document that higher Render Scale values sharpen the graph but use more GPU power.
* If users report instability, advise lowering plugin Render Scale first, then investigate whether a targeted safe mode or clearer in-UI warning is needed.

## Host Frame Cadence Limits

Risk:

* Obsidian desktop runs the Unity WebGL map inside an Electron/Chromium iframe, so the browser host controls the `requestAnimationFrame` cadence seen by WebGL.
* Local diagnostics observed iframe `requestAnimationFrame` near 60 FPS on a 120 Hz display.
* `Auto` frame-rate mode uses Unity vSync (`QualitySettings.vSyncCount = 1`, `Application.targetFrameRate = -1`), but the effective cadence may still be capped by Obsidian/Electron before Unity reaches the physical monitor refresh rate.
* Lower fixed caps (`60 FPS`, `30 FPS`, `24 FPS`) can reduce Unity frame work in some cases, but Task Manager GPU readings and perceived device load may not drop proportionally.

Mitigation:

* Present the setting as `Frame rate`, not as a guaranteed power-saving mode.
* Keep `Auto` as the default because it follows the host cadence and avoids forcing a lower software cap.
* Treat fixed modes as user-controlled caps for systems where lower Unity frame frequency helps stability or comfort.

## 13. Runtime Startup May Never Reach `bridge:ready`

Risk:

* The iframe may load partially, or the Unity runtime may fail before sending `bridge:ready`.
* When `bridge:ready` never arrives, the plugin must not send `graph:set`; the latest graph payload can remain pending while the runtime is not ready.
* The visible result depends on how far startup progressed: the parent-side loading fallback, the iframe wrapper's startup status, or the iframe wrapper's runtime failure status.

Mitigation:

* Keep `bridge:ready` as the gate before sending `graph:set`.
* Keep startup and failure statuses visible in the iframe wrapper when the wrapper starts successfully.
* Keep the parent-side loading fallback visible for cases where the runtime page does not build its own status UI.
* If users report persistent startup stalls, diagnose runtime startup separately from window migration and bridge payload handling.

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
