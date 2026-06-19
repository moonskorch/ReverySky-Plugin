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
- Keep `unity-webgl/index.html`, `unity-webgl/Build/*`, and `unity-webgl/TemplateData/*` as local generated artifacts.
- Exclude optional large skybox source textures from commits as documented in `unity/ReverySkyMap/Assets/README.txt`.
- Keep runtime generation script-driven and reproducible.

## Embedded HTML main.js size
- `embedded-html` embeds the self-contained Unity WebGL HTML into root `main.js`;
- runtime starts lazily when the map view opens;
- packaged `main.js` size and Obsidian startup behavior must be measured;
- dashboard preview scan is a separate next stage;
- generated package output stays outside Git.

## Embedded archive cache extraction
- `embedded-archive` embeds a compressed Unity runtime archive in root `main.js`;
- the first map open extracts the runtime into `.reverysky-runtime/<version>/`;
- later opens and later Obsidian restarts reuse the cache without network download;
- archive validation and cache replacement must stay strict to avoid partial installs;
- dashboard scan is a separate later stage.

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

