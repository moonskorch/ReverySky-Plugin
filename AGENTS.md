# AGENTS.md

## Project Overview
- This repository contains an Obsidian desktop plugin (`reverysky-map`).
- It renders vault relationships in a Unity WebGL runtime inside a custom Obsidian view.

## Tech Stack
- TypeScript plugin code in `src/` bundled with `esbuild`.
- Obsidian plugin manifest in `manifest.json`, generated entry output `main.js`.
- Unity source project in `unity/ReverySkyMap` (Unity `6000.3.12f1`).
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
- `unity-webgl/index.template.html` and `unity-webgl/index.disk-runtime.template.html`: tracked runtime host templates.
- `unity-webgl/Build/build-config.json`, `runtime-entry.js`, `runtime-core.js`, `runtime-data.*`, `runtime-code.*`: tracked compact runtime input for `embedded-archive`.
- `unity-webgl/index.html`, other `unity-webgl/Build/*`, and `unity-webgl/TemplateData/*`: generated local artifacts.
- `docs/`: architecture, data contract, risks, plans, verification, and runbooks.
- `.local-notes/`: local private notes; may be checked for relevant task context.
- `reference/ReverySky`: reference-only workspace; never a restore baseline.

## Development Commands
- Install deps: `npm install`
- Common plugin commands: `npm run dev`, `npm run build`, `npm run check`, `npm run test`.
- Verification command matrix and UI visual regression commands live in `docs/VERIFICATION.md`.
- Unity export import: `powershell -ExecutionPolicy Bypass -File .\scripts\import-unity-webgl.ps1 -ExportRoot "<UnityWebGLExportRoot>"`
- Clean setup, WebGL import, packaging, and local smoke workflow live in `docs/WEBGL_INTEGRATION_RUNBOOK.md`.

## Core Rules
- Bridge protocol version and payload contract live in `docs/DATA_CONTRACT.md`.
- Runtime flow is `bridge:ready` first, then `graph:set`.
- Keep path normalization stable (`/` separators, vault-relative paths) across bridge layers.
- Unity runtime is served from a local loopback HTTP server (`127.0.0.1`), not external hosting.
- Do not modify `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the task explicitly requires it.
- If such files must change, say which ones and why before editing.
- `reference/ReverySky` may be used only for targeted comparison or selective fragment adaptation, not rollback, reset, or bulk-copy.

## Obsidian API Recommendations
- For Obsidian-facing UI, navigation, file, metadata, and platform interactions, prefer Obsidian APIs when they cover the required behavior. Use standard DOM/Web APIs for plugin-owned iframe/runtime code, test harnesses, or behavior outside Obsidian's API surface.
- For Obsidian-owned DOM creation, prefer Obsidian element helpers such as `createEl`, `createDiv`, and `createSpan` over `document.createElement`.
- For UI styling, do not set inline styles directly; use CSS classes, `setCssProps`, or `setCssStyles` instead.
- Avoid `globalThis` in Obsidian-facing code. Use `window` or `activeWindow` when a window object is needed.

## Workflow And Verification
- Before edits, define a compact task contract: `Mode`, `Goal`, `Scope`, `Out of scope`, `Verification`, and `Stop condition`.
- For substantial MVP work, use `docs/MVP_PLAN.md`; after MVP, use the owner request and current docs as the task source.
- Use `docs/AGENT_WORKFLOW.md` for task modes, scope control, repair loop, and final report shape.
- Use `docs/VERIFICATION.md` as the canonical verification policy and command matrix.
- For non-documentation tasks, run automated checks before manual checks.
- For bridge/runtime changes, verify the end-to-end `bridge:ready` -> `graph:set` flow.
- If docs and code conflict, report the contradiction explicitly.
- Final reports must include `Task`, `Changes made`, `Verification`, `Manual checks`, and `Risks / follow-ups`.

## Working Rules
- English only: write code, tests, comments, documentation, runbooks, and user-facing strings in English. No exceptions.
- Keep wording concise, professional, and implementation-focused.
- Keep analysis brief, code-grounded, and directly tied to the user's question; avoid long speculative narratives.
- When explaining code, include relevant file paths and line numbers.
- Avoid Markdown/text tables in documentation; prefer short bullet lists or explicit per-mode subsections.
- Prefer existing `src/*` patterns before introducing new abstractions.
- Do not modify application code when only documentation maintenance is requested.
- Never create temporary test files in the repository.
- Use `apply_patch` for source/doc edits.
- Avoid shell rewrite commands.
- Avoid destructive git history operations.
- Keep edits small and targeted.
- Optionally check `.local-notes/` for relevant local documentation before making implementation decisions.

## Method Responsibility And Naming
* Keep orchestration steps explicit. Helpers should perform one focused operation.
* Use handle... for event/request handling and its scenario-specific branches.
* Name methods by their responsibility, not by the sequence of internal calls.
* Do not hide major scenario steps such as acceptance, rebuilds, or sends behind vaguely named helpers.
* If a helper naturally requires a multi-action name such as `rebuildIfNeededAndSend`, prefer keeping those steps explicit in the parent orchestrator instead of inventing a shorter but less accurate name.
* Keep names concise. Add qualifiers only when they distinguish meaningful behavior.

## Context Discipline
- Avoid loading or pasting large generated artifacts, binaries, or embedded payload files unless necessary.
- For generated HTML or runtime outputs, inspect targeted fragments or metadata unless full content is explicitly required.
- Prefer:
  - file size and timestamps
  - marker search (`Select-String`, `rg`)
  - source-of-truth script inspection
- Never read fully unless explicitly requested:
  - `unity-webgl/index.html`
  - WebGL `GameAssembly.a` artifacts
  - Unity/`reference` nebula cubemap `.exr` files
  - `unity/ReverySkyMap/Library/PackageCache/com.unity.burst@973857688024/.Runtime/libburst-llvm-19.dylib`
- For these files, use metadata-only inspection by default.
- If new generated or binary files larger than 100 MB are discovered, add them here.

## Safety And Approvals
- Treat generated artifacts as build outputs unless explicitly marked as source or tracked compact runtime input.
- Keep references, caches, and environment-specific files out of commits.
- Use `reference/ReverySky` only for targeted comparison or selective fragment adaptation, never rollback, reset, or bulk-copy into `unity/ReverySkyMap`.
- Every source or documentation edit must produce a visible patch card.
- Do not delete and re-add an existing file when a normal update patch is possible.
- If an edit cannot be represented as a visible patch, stop and ask before editing.
- For risky or multi-file edits, confirm a fresh rollback point exists in VS Code Timeline/Checkpoints before editing.
- After edits, report only actually changed files.
- Git read-only commands are allowed for inspection only; any command that changes the working tree, index, commits, refs, or remotes requires explicit approval.
- Commits and history rewrite are forbidden by default.
- Rejected or reverted attempts must be reported as `no persistent file change`.

## Documentation Routing
- Architecture and boundaries: `docs/ARCHITECTURE.md`
- Bridge schema and validation expectations: `docs/DATA_CONTRACT.md`
- Task workflow, repair loop, and final report policy: `docs/AGENT_WORKFLOW.md`
- Delivery sequence and manual acceptance checks: `docs/MVP_PLAN.md`
- Verification policy and command matrix: `docs/VERIFICATION.md`
- Package modes and release shapes: `docs/PACKAGING_MODES.md`
- Risk register and mitigations: `docs/RISKS.md`
- Build/import/install operations: `docs/WEBGL_INTEGRATION_RUNBOOK.md`

## Known Unknowns
- Broader risk tracking lives in `docs/RISKS.md`.
- CI is not defined in repository configuration.
- TS automated baseline exists, but comprehensive coverage is not yet established; add or extend targeted automated checks as part of risky or behavior-changing tasks.
- Runtime integration quality depends on fresh Unity WebGL export and correct import via `scripts/import-unity-webgl.ps1`.

## UI Changes
- For plugin-side UI implementation, screenshot matching, visual polish, and visual regressions, use the `ui-polish` skill.

## Code Comments
- Add a short inline comment or JSDoc only for a non-obvious constraint, invariant, or trade-off that cannot be made clear through naming or structure.
- Do not add comments that restate the code.

