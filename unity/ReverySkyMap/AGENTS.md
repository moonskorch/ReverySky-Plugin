# AGENTS.md

## Project Overview
- This folder is an autonomous Unity subproject for ReverySky map runtime work.
- Unity editor version for this project: `6000.3.8f1`.
- Primary runtime scene path: `Assets/Scenes/ScarScapeScene.unity`.
- Main source areas for Unity runtime work:
  - `Assets/Scripts/*`
  - `Assets/Prefabs/*`
  - `Assets/ScriptableObjects/*`
  - `Assets/Settings/*`
  - `Packages/*`
  - `ProjectSettings/*`

## Local Documentation Routing (Source of Truth)
- Unity execution plan: `docs/MVP_PLAN.md`.
- Unity verification policy: `docs/VERIFICATION.md`.
- Unity execution workflow: `docs/WORKFLOW.md`.
- Unity risk register: `docs/RISKS.md`.
- Unity runtime contract subset: `docs/DATA_CONTRACT.md`.
- Use this file as the operating contract for Unity-only tasks opened from `unity/ReverySkyMap` as root.

## MCP Priority
- Unity MCP is the default interface for Unity project access and Unity object/asset manipulation.
- Execution flow is canonical in `docs/WORKFLOW.md`.
- Verification order and fallback rules are canonical in `docs/VERIFICATION.md`.
- Step-specific exceptions belong only to active steps in `docs/MVP_PLAN.md`.

## Scope Boundary
Owned in this Unity subproject:
- Unity runtime architecture and behavior.
- Unity scene/prefab/material/script dependency safety.
- Unity tests (EditMode/PlayMode) and runtime stability gates.
- Unity-side cleanup and staged deletion workflows.

Owned by parent repository docs (do not duplicate here as default workflow):
- Obsidian plugin TypeScript lifecycle and `src/*` implementation.
- Release packaging and plugin distribution workflow.
- Parent WebGL import workflow orchestration for plugin runtime folder.

For cross-scope work that affects Obsidian integration, hand off to parent docs:
- `../../docs/WEBGL_INTEGRATION_RUNBOOK.md`
- `../../docs/ARCHITECTURE.md`
- `../../docs/MVP_PLAN.md`

## Workflow Rules
- Prefer evidence-first decisions: inspect repository and Unity/MCP state before proposing edits.
- Keep edits small and targeted; avoid broad multi-area edits in one pass.
- Use staged execution for risky cleanup/deletion tasks per `docs/WORKFLOW.md`.
- If the user asks for the next Unity cleanup batch, run skill `cleanup-batch` and follow its protocol exactly; do not delete anything before explicit approval.
- In repository docs, use only repo-relative documentation paths (for example `docs/WORKFLOW.md`); do not write machine-local absolute paths.
- Preserve completed history in `docs/MVP_PLAN.md`; do not rewrite locked `DONE` steps.
- If code and docs conflict, report the contradiction explicitly before proceeding.
- For documentation updates, follow `documentation-dedup-auditor` principles: keep one canonical home per rule and replace repeated procedures with short references.
- Before edits, define a compact task contract: `Mode`, `Goal`, `Scope`, `Out of scope`, `Verification`, `Stop condition` (see `docs/WORKFLOW.md`).

## Git Permission Policy
- Git read-only commands are allowed by default for inspection only (for example: `git status`, `git diff`, `git log`, `git show`, `git ls-files`).
- Any git command that changes working tree, index, commits, refs, or remotes requires explicit user approval in this chat before execution.
- Commits and history-rewrite operations are strictly forbidden by default and must never be executed without a direct user request in the current task (`git commit`, `git push`, `git rebase`, `git reset`, `git revert`, `git filter-repo`).

## Unity Safety Rules
- Never perform broad delete/move/restructure in one batch.
- For deletion dependency evidence and batch protocol, follow `docs/WORKFLOW.md`.
- Do not modify `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the task explicitly requires it.
- `Library/`, `Temp/`, `Logs/`, `obj/`, and `UserSettings/` are generated state, not source-of-truth.

## Verification Expectations
- Use `docs/VERIFICATION.md` as the only detailed verification procedure.
- For non-documentation Unity behavior changes, run relevant automated checks first; manual checks are additional, not a replacement.

## Final Task Report Format
Every completed task report should include:
1. Task
2. Changes made
3. Verification
4. Manual checks
5. Risks / follow-ups
