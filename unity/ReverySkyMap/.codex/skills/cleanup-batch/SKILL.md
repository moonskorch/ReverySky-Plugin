---
name: cleanup-batch
description: Run the Unity staged cleanup gate and micro-batch protocol for ReverySkyMap. Use when the user asks for the next cleanup batch, continuation of Step 7 cleanup, or candidate-first deletion flow without restating instructions.
---

# Cleanup Batch

Use this skill to execute Step 7 cleanup batches in `unity/ReverySkyMap` with the exact staged protocol.

Canonical project references:
- `docs/MVP_PLAN.md` (active step and batch scope)
- `docs/CLEANUP_BATCH_LEDGER.md` (append-only batch history)
- `docs/VERIFICATION.md` (verification order and fallback rules)

## Cleanup Batch Entrypoint

When the user asks for the next cleanup batch (for example: "next cleanup batch"), execute exactly this gate:
1. Read the active cleanup step in `docs/MVP_PLAN.md` and `docs/CLEANUP_BATCH_LEDGER.md`.
2. Identify the next batch number and next candidate group.
3. Present candidate cards only.
4. Stop and wait for explicit user approval.

Before approval, do not delete, move, rename, edit, commit, or update the ledger.

- Use one micro-batch per subsystem and one commit per micro-batch.
- Move to the next batch only after `pass + commit`.
- Mandatory batch loop after approval (no implicit/oral shortcuts):
  1. Deep analysis (`code refs + GUID inbound refs + runtime-path check + risk`).
  2. Present candidate card(s) to the user, in the format:
  candidate | evidence | risk | decision | proposed batch | verification
  3. Wait for explicit user approval.
  4. Delete only approved candidates.
  5. Run verification (`EditMode` required; `PlayMode` when transport allows) and capture MCP scene/log snapshot.
  6. Commit.
  7. Append ledger row.
- Before any deletion batch, deep candidate analysis is required (not heuristic-only):
  - scene/prefab/ScriptableObject serialized and GUID inbound references;
  - compile-time consumers for each C# candidate type/symbol;
  - runtime-mode vs legacy-mode call path check for mixed systems;
  - risk classification with explicit `remove/keep/defer` per candidate.
- For grouped cleanup, present a short mini-plan for the next 2-4 batches:
  - batch order;
  - candidate groups;
  - expected blockers/deferred items.
- Micro-batch constraints:
  - small set only (do not combine unrelated folders);
  - stop immediately on first regression.
  - Commit completeness rule for cleanup batches:
    - Do not leave expected batch-related file changes unstaged.
    - Allowed out-of-scope leftovers that may stay unstaged:
      - `Assets/AddressableAssetsData/link.xml`
      - `Assets/AddressableAssetsData/link.xml.meta`
      - `Assets/_Visuals/Materials/Skybox_Nebula.mat`
    - Any other unexpected unstaged change must stop execution until explicit user confirmation.
- Batch log template (required):
  - `candidate`: what changed in this batch (paths/assets/components).
  - `evidence`: inbound-reference evidence used before applying the batch.
  - `decision`: `remove`, `keep`, or `defer` with one-line reason.
  - `checks`: automated + manual checks executed after the batch.
  - `result`: pass/fail status and next action (`continue`, `repair`, `rollback candidate`).
- Failure handling protocol (mandatory):
  - Any compile/test/runtime failure stops batch progression.
  - Choose one explicit path and log it in ledger `next_action`:
    - `decouple` (break dependency safely, then re-verify),
    - `defer` (rollback/skip candidate for later),
    - `refine substep` (split into a smaller, safer micro-batch with deeper mapping).
  - Resume next deletion batch only after baseline is green again.
- After each approved batch:
  Report commit hash, checks, changed files, ledger row, and risks.
- Final report must include post-commit git status summary.
- If user confirms KEEP after audit-only and no files changed, reply with a short confirmation. Do not create ledger entry or commit.

A cleanup batch is not complete without `verification + commit + ledger row`.
