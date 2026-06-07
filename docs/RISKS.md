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
