# AGENTS.md

## Project Overview
- This repository contains an Obsidian desktop plugin (`reverysky-map`).
- It renders vault relationships in a Unity WebGL runtime inside a custom Obsidian view.
- Source docs:
  - `docs/ARCHITECTURE.md` for architecture
  - `docs/MVP_PLAN.md` for delivery
  - `docs/BUGS_AND_FEATURES.md` for the post-MVP backlog

## Tech Stack
- TypeScript plugin code in `src/` bundled with `esbuild`.
- Obsidian plugin manifest in `manifest.json`, generated entry output `main.js`.
- Unity source project in `unity/ReverySkyMap` (Unity `6000.3.8f1`).
- Local runtime artifacts and templates in `unity-webgl/`.
- Compact Unity WebGL runtime input for `embedded-archive` release builds is generated/imported, but tracked intentionally.
- PowerShell automation for WebGL import in `scripts/import-unity-webgl.ps1`.

## Repository Structure
- `src/main.ts`: plugin lifecycle, command registration, runtime server bootstrap.
- `src/view/`: custom Obsidian map view and iframe integration.
- `src/bridge/`: bridge envelope types, validation, iframe transport.
- `src/graph/`: vault graph extraction and normalization.
- `src/runtime/`: local HTTP server for Unity WebGL assets.
- `unity/ReverySkyMap/`: Unity project source used to build WebGL export.
- `unity-webgl/index.template.html`, `unity-webgl/index.disk-runtime.template.html`: tracked runtime host templates.
- `unity-webgl/Build/build-config.json`, `runtime-entry.js`, `runtime-core.js`, `runtime-data.*`, `runtime-code.*`: tracked compact runtime input for `embedded-archive`.
- `unity-webgl/index.html`, other `unity-webgl/Build/*`, `unity-webgl/TemplateData/*`: generated local artifacts.
- `docs/`: architecture, data contract, risks, MVP plan, verification, and runbooks.
- `docs/BUGS_AND_FEATURES.md`: post-MVP backlog for confirmed bugs and feature slices.
- `.local-notes/`: local private notes; may be checked during task execution.
- `reference/ReverySky`: reference-only workspace; never a restore baseline.

## Development Commands
- Install deps: `npm install`
- Common plugin commands: `npm run dev`, `npm run build`, `npm run check`, `npm run test`
- Full verification command matrix: `docs/VERIFICATION.md`
- UI visual regression commands: `docs/VERIFICATION.md`
- Unity export import: `powershell -ExecutionPolicy Bypass -File .\scripts\import-unity-webgl.ps1 -ExportRoot "<UnityWebGLExportRoot>"`
- Full workflow for clean setup and manual validation: `docs/WEBGL_INTEGRATION_RUNBOOK.md`

## Core Rules
- Bridge protocol version and payload contract live in `docs/DATA_CONTRACT.md`.
- Runtime flow is `bridge:ready` first, then `graph:set`.
- Keep path normalization stable (`/` separators, vault-relative paths) across bridge layers.
- Unity runtime is served from a local loopback HTTP server (`127.0.0.1`), not external hosting.
- Do not modify `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the task explicitly requires it.
- If such files must change, say which ones and why before editing.

## Workflow And Verification
- Before edits, define a compact task contract with `Mode`, `Goal`, `Scope`, `Out of scope`, `Verification`, and `Stop condition`.
- For substantial MVP work, use `docs/MVP_PLAN.md`; after MVP, use `docs/BUGS_AND_FEATURES.md`.
- Use `docs/AGENT_WORKFLOW.md` for task modes, repair loop, and final report shape.
- Use `docs/VERIFICATION.md` as the canonical verification policy and command matrix.
- For non-documentation tasks, run automated checks before manual checks.
- For bridge/runtime changes, verify the end-to-end `bridge:ready` -> `graph:set` flow.
- If docs and code conflict, report the contradiction explicitly.
- Final reports must include:
  - `Task`
  - `Changes made`
  - `Verification`
  - `Manual checks`
  - `Risks / follow-ups`

## Working Rules
- Keep code comments, documentation, and runbooks in English.
- Keep wording concise, professional, and implementation-focused.
- Keep analysis brief, code-grounded, and directly tied to the user's question; avoid long speculative narratives.
- Avoid Markdown/text tables in documentation; prefer short bullet lists or explicit per-mode subsections.
- Prefer existing `src/*` patterns before introducing new abstractions.
- Do not modify application code when only documentation maintenance is requested.
- Never create temporary test files in the repository.
- Use `apply_patch` for source/doc edits.
- Avoid shell rewrite commands.
- Avoid destructive git history operations.
- Keep edits small and targeted.
- Optionally check `.local-notes/` for relevant local documentation before making implementation decisions.

## Context Discipline
- Avoid loading or pasting large generated artifacts unless necessary.
- For `unity-webgl/index.html`, inspect only targeted fragments or metadata unless full content is explicitly required.
- Prefer:
  - file size and timestamps
  - marker search (`Select-String`, `rg`)
  - source-of-truth script inspection
- Treat large generated binaries and embedded payload files as noise by default.

## Known Giant Blob Denylist
- Never read fully unless explicitly requested:
  - `unity-webgl/index.html`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_01_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_02_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_03_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_04_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_01_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_02_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_03_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_04_Cubemap.exr`
  - WebGL `GameAssembly.a` artifacts
  - `unity/ReverySkyMap/Library/PackageCache/com.unity.burst@973857688024/.Runtime/libburst-llvm-19.dylib`
- For these files, use metadata-only inspection by default.
- If new files larger than 100 MB are discovered, add them to this denylist.

## Safety And Approvals
- Treat generated artifacts as build outputs unless explicitly marked as source or tracked compact runtime input.
- Keep references, caches, and environment-specific files out of commits.
- `reference/ReverySky` is for targeted comparison or selective fragment adaptation only.
- Do not use it for rollback, reset, or bulk-copy into `unity/ReverySkyMap`.
- Every source or documentation edit must produce a visible patch card.
- Do not delete and re-add an existing file when a normal update patch is possible.
- If an edit cannot be represented as a visible patch, stop and ask before editing.
- For risky or multi-file edits, confirm a fresh rollback point exists in VS Code Timeline/Checkpoints before editing.
- After edits, report only actually changed files.
- Git read-only commands are allowed by default for inspection only.
- Any git command that changes working tree, index, commits, refs, or remotes requires explicit user approval.
- Commits and history rewrite are forbidden by default.
- Rejected or reverted attempts must be reported as `no persistent file change`.

## Documentation Routing
- Architecture and boundaries: `docs/ARCHITECTURE.md`
- Bridge schema and validation expectations: `docs/DATA_CONTRACT.md`
- Task workflow, repair loop, and final report policy: `docs/AGENT_WORKFLOW.md`
- Delivery sequence and manual acceptance checks: `docs/MVP_PLAN.md`
- Verification policy and command matrix: `docs/VERIFICATION.md`
- Post-MVP bug and feature backlog: `docs/BUGS_AND_FEATURES.md`
- Risk register and mitigations: `docs/RISKS.md`
- Build/import/install operations: `docs/WEBGL_INTEGRATION_RUNBOOK.md`

## Known Unknowns
- Broader risk tracking lives in `docs/RISKS.md`.
- CI is not defined in repository configuration.
- TS automated baseline exists, but comprehensive coverage is not yet established; add or extend targeted automated checks as part of risky or behavior-changing tasks.
- Runtime integration quality depends on fresh Unity WebGL export and correct import via `scripts/import-unity-webgl.ps1`.

## UI Changes
- For plugin-side UI implementation, screenshot matching, visual polish, and visual regressions, use the `ui-polish` skill.

### Preserve non-obvious decisions
During implementation, add a short inline comment or JSDoc only when the code contains a non-obvious constraint, invariant, or deliberate trade-off that cannot be made clear through naming or structure.
Do not add comments that restate the code.

