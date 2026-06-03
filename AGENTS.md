# AGENTS.md

## Project Overview
- This repository contains an Obsidian desktop plugin (`reverysky-map`) that renders vault relationships in a Unity WebGL runtime inside a custom Obsidian view.
- Architecture and scope source of truth: `docs/ARCHITECTURE.md`.
- Current delivery plan and step status source of truth: `docs/MVP_PLAN.md`.

## Tech Stack
- TypeScript plugin code in `src/` bundled with `esbuild`.
- Obsidian plugin manifest in `manifest.json`, entry output `main.js`.
- Unity source project in `unity/ReverySkyMap` (Unity `6000.3.8f1`).
- Local runtime artifacts and template in `unity-webgl/`.
- PowerShell automation for WebGL import in `scripts/import-unity-webgl.ps1`.

## Repository Structure
- `src/main.ts`: plugin lifecycle, command registration, runtime server bootstrap.
- `src/view/`: custom Obsidian map view and iframe integration.
- `src/bridge/`: bridge envelope types, validation, iframe transport.
- `src/graph/`: vault graph extraction and normalization.
- `src/runtime/`: local HTTP server for Unity WebGL assets.
- `unity/ReverySkyMap/`: Unity project source used to build WebGL export.
- `unity-webgl/index.template.html`: tracked runtime host template.
- `unity-webgl/index.html`, `unity-webgl/Build/*`, `unity-webgl/TemplateData/*`: generated local artifacts, not source.
- `docs/`: architecture, data contract, risks, MVP plan, and operational runbooks.
- `.local-notes/`: local private notes; may be checked during task execution for relevant documentation.
- `reference/ReverySky`: reference-only workspace, never a restore baseline.

## Development Commands
- Install deps: `npm install`
- Plugin dev build/watch path: `npm run dev`
- Plugin production build: `npm run build`
- TS automated tests (single run): `npm run test`
- TS automated tests (watch mode): `npm run test:watch`
- Unity export import:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\import-unity-webgl.ps1 -ExportRoot "<UnityWebGLExportRoot>"`
- Full workflow for clean setup and manual validation: `docs/WEBGL_INTEGRATION_RUNBOOK.md`.

## Architecture Rules
- Bridge protocol version and payload contract are defined in `docs/DATA_CONTRACT.md`.
- Runtime message flow:
  - runtime emits `bridge:ready`
  - plugin validates and sends `graph:set`
- Keep path normalization stable (`/` separators, vault-relative paths) across bridge layers.
- Unity runtime is served from a local loopback HTTP server (`127.0.0.1`), not external hosting.

## Coding and Documentation Conventions
- Keep code comments, documentation, and runbooks in English.
- Keep wording concise, professional, and implementation-focused.
- Prefer established project patterns in existing `src/*` modules before introducing new abstractions.

## Canonical Process Docs
- `docs/AGENT_WORKFLOW.md`: canonical workflow, task modes, task contract, and repair loop.
- `docs/VERIFICATION.md`: canonical verification policy, command matrix, and scope-based check selection.
- `docs/MVP_PLAN.md`: canonical roadmap, active-step scope, freeze rule, and step-specific execution exceptions.
- Keep this file compact: include mandatory guardrails and pointers, not full repeated procedures.

## Agent Workflow
- Provide short, actionable progress updates focused on outcomes and next actions.
- Do not paste large logs or generated blobs unless explicitly requested.
- Do not modify application code when only documentation maintenance is requested.
- Never create temporary test files in the repository.
- If repository evidence and docs conflict, report the contradiction explicitly.
- Before edits, define a compact task contract with: `Mode`, `Goal`, `Scope`, `Out of scope`, `Verification`, `Stop condition` (see `docs/AGENT_WORKFLOW.md`).
- When working on a task, optionally check `.local-notes/` for relevant local documentation before making implementation decisions.

## Project Plan Workflow
For substantial MVP work, treat `docs/MVP_PLAN.md` as canonical roadmap and follow the process in `docs/AGENT_WORKFLOW.md`.
Keep step-specific scope in the plan; do not invent tasks outside the active step unless the plan is updated first.

## Final Response Format
Every completed task response must include:
1. **Task:** what was requested.
2. **Changes made:** files changed and what changed.
3. **Verification:** checks run and their results.
4. **Manual checks:** what the user should verify manually, if anything.
5. **Risks / follow-ups:** known limitations or suggested next steps.
For detailed workflow and reporting rules, see `docs/AGENT_WORKFLOW.md`.

## Planning Rules
- Treat `docs/MVP_PLAN.md` as the planning source of truth.
- Respect the freeze rule exactly as written in `docs/MVP_PLAN.md`.
- Do not silently reshape milestone intent during unrelated tasks.

## Verification
- Use `docs/VERIFICATION.md` as canonical verification policy (order, command matrix, and scope-specific requirements).
- For every non-documentation task, run relevant automated checks first; manual checks are additional, not a replacement.
- For bridge/runtime changes, verify end-to-end `bridge:ready` -> `graph:set` flow.
- Every final report must state checks run, results, skipped checks with reasons, and manual checks.
- For cross-layer or contract changes, follow the self-contained implementation rule in `docs/AGENT_WORKFLOW.md` and the bridge verification gate in `docs/VERIFICATION.md`. Do not report a feature as complete while a required producer or consumer step is still deferred.


## Context and Token Discipline
- Never load or paste large generated artifacts into chat context when metadata is sufficient.
- For generated runtime pages (for example `unity-webgl/index.html`), inspect only targeted fragments or metadata (`size`, `path`, generation source) unless full content is explicitly required.
- Avoid `Get-Content -Raw` on very large files and avoid commands that inline base64-heavy content.
- Prefer lightweight checks:
  - file size and timestamps
  - marker search (`Select-String`, `rg`)
  - generator/source-of-truth script inspection
- Treat large generated binaries and embedded payload files as noise by default.

## Known Giant Blob Denylist
- Never read these files fully and never paste full content unless explicitly requested:
  - `unity-webgl/index.html`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_01_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_02_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_03_Cubemap.exr`
  - `unity/ReverySkyMap/Assets/_Visuals/Nebula Skyboxes/Nebula_04_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_01_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_02_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_03_Cubemap.exr`
  - `reference/ReverySky/Assets/_Visuals/Nebula Skyboxes/Nebula_04_Cubemap.exr`
  - `unity/ReverySkyMap/Library/Bee/artifacts/WebGL/il2cppOutput/build/GameAssembly.a`
  - `unity/ReverySkyMap/Library/Bee/artifacts/WebGL/GameAssembly/release_WebGL_wasm/GameAssembly.a`
  - `unity/ReverySkyMap/Library/PackageCache/com.unity.burst@973857688024/.Runtime/libburst-llvm-19.dylib`
- For these files, use metadata-only inspection by default (`Get-Item`, hashes, targeted marker search).
- If new files larger than 100 MB are discovered, add them to this denylist.

## Safety and Approvals
- Treat generated artifacts as build outputs unless explicitly marked as source.
- Keep references, caches, and environment-specific files out of commits.
- `reference/ReverySky` is reference/inspiration only:
  - never use it for rollback, reset, or bulk-copy into `unity/ReverySkyMap`
  - allow only targeted comparison or selective fragment adaptation
- Every source or documentation edit must produce a visible patch card.
- Use `apply_patch` for source/doc edits and prefer in-place updates.
- Do not delete and re-add an existing file when a normal update patch is possible.
- If an edit cannot be represented as a visible patch, stop and ask before editing.
- For risky or multi-file edits, confirm a fresh rollback point exists in VS Code Timeline/Checkpoints before editing.
- After edits, report only actually changed files.
- Git read-only commands are allowed by default for inspection only (for example: `git status`, `git diff`, `git log`, `git show`, `git ls-files`).
- Any git command that changes working tree, index, commits, refs, or remotes requires explicit user approval in this chat before execution.
- Commits and history-rewrite operations are strictly forbidden by default and must never be executed without a direct user request in the current task (`git commit`, `git push`, `git rebase`, `git reset`, `git revert`, `git filter-repo`).
- Verification should be concise and practical: use git output summaries only when they add value or are requested.
- Rejected or reverted attempts must be reported as `no persistent file change`.
- Do not edit files through shell rewrite commands (`Set-Content`, `Out-File`, `>`, `>>`, bulk rewrite scripts).
- Keep edits small and targeted; prefer one file per patch when practical.
- If a path is blocked or uncertain, stop and report instead of trying alternatives.

## Unity Safety
- Do not modify `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the task explicitly requires it.
- If such files must change, state which files and why before editing.

## Documentation Routing
- Architecture and boundaries: `docs/ARCHITECTURE.md`
- Bridge schema and validation expectations: `docs/DATA_CONTRACT.md`
- Delivery sequence and manual acceptance checks: `docs/MVP_PLAN.md`
- Risk register and mitigations: `docs/RISKS.md`
- Build/import/install operations: `docs/WEBGL_INTEGRATION_RUNBOOK.md`

## Known Unknowns
- CI is currently not defined in repository configuration.
- TS automated baseline exists, but comprehensive coverage is not yet established; add/extend targeted automated checks as part of risky or behavior-changing tasks.
- Runtime integration quality depends on local Unity WebGL export freshness and correct import via `scripts/import-unity-webgl.ps1`.

## UI Changes
- For plugin-side visual changes, styling fixes, layout issues, and UI regressions, use the `ui-polish` skill.
