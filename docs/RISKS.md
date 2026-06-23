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
- runtime starts lazily when the map view opens;
- packaged `main.js` size and Obsidian startup behavior must be measured;
- dashboard submission and scan status are tracked separately from package-mode behavior;
- generated package output stays outside Git.

## Embedded archive cache extraction
- `embedded-archive` embeds a compressed Unity runtime archive in root `main.js`;
- the first map open extracts the runtime into `.reverysky-runtime/<version>/`;
- later opens and later Obsidian restarts reuse the cache without network download;
- archive validation and cache replacement must stay strict to avoid partial installs;
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
* Reconsider a ReverySky-specific workaround only if there are user reports that map popouts commonly trigger this issue in normal use.

## 8. Native Note Open Routing with Popout Windows

Risk:

* Note clicks from the Unity WebGL map are delivered through an iframe bridge, so Obsidian may not treat the map view as the active workspace leaf before `app.workspace.openLinkText(...)` runs.
* When popout windows are present, Obsidian may route the native open action to whichever workspace context it currently considers active.
* This can make map node clicks open notes in either the main workspace or a popout window, depending on Obsidian's active workspace state.

Mitigation:

* Keep note opening delegated to Obsidian with `app.workspace.openLinkText(...)`.
* Do not use `OpenViewState.group` for note opening; that field is tied to workspace grouping behavior and can create linked-pane side effects.
* Do not force `workspace.setActiveLeaf(...)` solely to steer main-window versus popout routing unless user reports show the native behavior is worse than the focus-state risk.
* Keep active-note tracking global so markdown navigation inside popout windows can still update map focus.

## Architecture Risks and Hardening Plan

The core architecture is intentional: ReverySky Map embeds a Unity WebGL runtime inside an Obsidian plugin and sends live graph data across several runtime boundaries.

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
