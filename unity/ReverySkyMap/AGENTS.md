# AGENTS.md

## Project Overview
- This folder is the ReverySky Map Unity runtime subproject for the ReverySky 3D Graph Obsidian plugin.
- Unity version: `6000.3.8f1`.
- Primary scene: `Assets/Scenes/StarScapeScene.unity`.
- Main runtime areas:
  - `Assets/Scripts/*`
  - `Assets/Prefabs/*`
  - `Assets/ScriptableObjects/*`
  - `Assets/Settings/*`
  - `Packages/*`
  - `ProjectSettings/*`

## Local Docs
- `docs/ARCHITECTURE.md`: code-grounded runtime architecture guide
- `docs/MVP_PLAN.md`: Unity execution plan and step-specific exceptions
- `docs/VERIFICATION.md`: Unity verification policy and check order
- `docs/WORKFLOW.md`: Unity execution workflow and staged cleanup protocol
- `docs/RISKS.md`: Unity risk register
- `docs/DATA_CONTRACT.md`: Unity runtime contract subset
- `docs/CLEANUP_BATCH_LEDGER.md`: append-only cleanup history and evidence ledger

## Scope Boundary
- Owned here:
  - Unity runtime behavior
  - scene/prefab/material/script dependency safety
  - Unity tests
  - staged cleanup/deletion
- Owned by the parent repo:
  - Obsidian plugin TypeScript lifecycle
  - release packaging
  - parent WebGL import orchestration
- Cross-scope work that affects Obsidian integration must also respect:
  - `../../docs/ARCHITECTURE.md`
  - `../../docs/MVP_PLAN.md`
  - `../../docs/WEBGL_INTEGRATION_RUNBOOK.md`

## Workflow
- English only: write code, tests, comments, documentation, and user-facing strings in English. No exceptions.
- Inspect repository and Unity/MCP state before editing.
- Keep responses brief and answer the user's exact question before adding extra context.
- Keep edits small and targeted; avoid broad multi-area changes in one pass.
- Use `docs/WORKFLOW.md` for execution modes, staged cleanup, and repair flow.
- Preserve locked `DONE` steps in `docs/MVP_PLAN.md`.
- Report docs/code contradictions explicitly.
- Before edits, define a compact task contract with:
  - `Mode`
  - `Goal`
  - `Scope`
  - `Out of scope`
  - `Verification`
  - `Stop condition`
- Unity MCP is the default interface for Unity project access and asset manipulation; detailed command and fallback rules live in `docs/VERIFICATION.md`.

## Verification
- Use `docs/VERIFICATION.md` as the only detailed Unity verification procedure.
- For non-documentation Unity behavior changes, run relevant automated checks before manual checks.
- For bridge/runtime changes, verify end-to-end `bridge:ready` -> `graph:set`.

## Safety
- Git read-only commands are allowed by default.
- Any command that changes working tree, index, commits, refs, or remotes requires explicit approval.
- Never broad-delete, move, or restructure in one batch.
- Do not modify `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the task explicitly requires it.
- If serialized Unity files must change, say which files and why before editing.
- Do not add or keep unrealistic defensive guards or guards that can never fire; if you can prove a guard cannot trigger, remove it instead of preserving filler logic.
- Do not add null or missing-wiring checks for project-owned invariants that are already guaranteed by scene setup, constructors, field initializers, or private call paths; rely on the contract and let real violations fail visibly.
- Prefer short, precise names for methods, variables, and tests; avoid long compound names when the owning type or local context already supplies the missing meaning.
- Do not introduce one-to-one local aliases that are assigned once and only read; use the original name unless the source expression or name is long enough that a local improves readability.
- Treat these folders as generated state:
  - `Library/`
  - `Temp/`
  - `Logs/`
  - `obj/`
  - `UserSettings/`
- Use repo-relative docs paths only in docs; avoid machine-local absolute paths.

## Final Report
- Use the root repo report format: `Task`, `Changes made`, `Verification`, `Manual checks`, `Risks / follow-ups`.
