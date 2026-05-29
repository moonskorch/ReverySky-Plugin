# Unity Agent Workflow

This workflow defines deterministic execution for Unity-only tasks in `unity/ReverySkyMap`.

## Goal
- Keep risky Unity work traceable, reversible, and verifiable.
- Prevent broad cleanup regressions that previously caused failures.

## Required Start Sequence
Before substantial work:
1. Read `AGENTS.md`, `docs/MVP_PLAN.md`, `docs/VERIFICATION.md`, and this file.
2. Confirm current active step in `docs/MVP_PLAN.md`.
3. Align scope with that step only.
4. Choose execution mode.
5. Connect Unity MCP and confirm live access (scene info + console logs).

## Staged Execution
Use staged execution for deletion, pruning, or dependency-sensitive cleanup work.

Canonical detailed batch protocol lives in skill `cleanup-batch`:
- use the skill by name without path.

When the user asks for the next cleanup batch, use that skill as the mandatory entrypoint and keep this high-level loop:
- `audit-only` -> `candidate list` -> `risk classification` -> `approval` -> `micro-batch` -> `verification` -> `report` -> `next batch`

General staged rules:
- Do not apply destructive edits before explicit approval.
- Keep one micro-batch per subsystem.
- Stop on first regression and enter repair flow.
- Treat batch completion as `verification + commit + ledger row`.

## MCP-First Operating Rule
- Use Unity MCP as the primary interface for Unity project state access and Unity-side manipulations.
- For Unity scene/object/component/asset/material/transform operations, prefer native MCP commands over direct serialized file edits.
- For Unity test execution, scene state checks, and editor log inspection, prefer MCP commands first.
- Do not directly edit `*.unity`, `*.prefab`, `*.asset`, or `*.meta` when an equivalent MCP operation exists.
- Fallback to direct file patching only when no suitable MCP operation exists (for example C# source/docs), and record the reason in the task report.
- Do not guess `execute_menu_item` paths; use only paths confirmed by MCP Unity command reference and current Unity menu-item listing.

## Execution Modes
- `Direct edit`: small, low-risk Unity change with clear scope.
- `Audit-only`: inspect references/dependencies/state without editing source.
- `Staged cleanup`: required for deletion, pruning, or dependency-sensitive refactor.
- `Repair loop`: required when verification fails.

If mode is unclear, use the safer one.

## Task Definition Checklist
Define before edits:
- goal,
- in-scope and out-of-scope,
- likely affected Unity areas,
- acceptance criteria,
- verification plan,
- rollback checkpoint source (for example editor local history/checkpoint).

## Repair Loop
If any check fails:
1. Stop further cleanup batches.
2. Identify root cause from changed batch.
3. Apply minimal corrective diff.
4. Re-run failed checks first, then full baseline for the step.
5. Resume staged cleanup only after green status.

## Cross-Scope Handoff Rule
If Unity changes affect WebGL runtime packaging or Obsidian integration behavior:
- hand off to parent runbook and parent integration checks,
- keep Unity task notes explicit about this boundary,
- do not silently extend Unity task into plugin scope.

Parent references:
- `../../docs/WEBGL_INTEGRATION_RUNBOOK.md`
- `../../docs/MVP_PLAN.md`

## Reporting Requirements
Use the canonical final report format from `AGENTS.md`.
