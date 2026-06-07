# Agent Workflow

This document defines the required workflow for AI-assisted development tasks in this repository.

Goal: keep each task traceable, verifiable, and easy to review.

## 1. Define the task

Before editing, identify:

- Goal
- Scope
- Constraints
- Done criteria
- Files or areas likely to change
- Risks or unclear assumptions

For small tasks, this can be a short summary.
For broader or risky tasks, create a plan before editing.

Required task contract before edits:

- Mode: how to execute the task
- Goal: expected outcome
- Scope: what may change
- Out of scope: what must not change
- Verification: checks that prove the result
- Stop condition: exact condition for stopping and reporting

Keep the contract compact. A short paragraph is acceptable only if all six fields are still explicit.

## 2. Start from the right source

For MVP work, do not start from memory.

Before a substantial work block:

1. Read `MVP_PLAN.md` and the current task notes.
2. Compare the plan with the repository state.
3. Check whether the next planned step is still the right next step.
4. Update the plan first if reality changed.
5. Convert the selected plan item into a concrete task contract.
6. Execute only within that scope.

`MVP_PLAN.md` is the roadmap; tasks are execution units derived from it.
When working from a numbered step, use the step text as scope and do not expand it until the plan is updated.

## 3. Pick the safest mode

- Direct edit: small, low-risk changes with clear scope.
- Plan-first: broad, risky, architectural, integration, dependency, CI/CD, or multi-module work.
- Audit-only: inspect, classify, or understand only; do not edit.
- Staged execution: risky cleanup, deletion, migration, or work that previously caused breakage; start with audit-only and use small approved batches.
- Repair loop: when checks fail, find the root cause, fix it, and rerun the relevant checks.

If the mode is unclear, choose the safer one.
For cleanup or deletion, never start with broad edits.

## 4. Inspect context

Read the relevant context before changing files:

- `AGENTS.md`
- `README.md` when present
- relevant files in `docs/`
- implementation files
- tests
- config files
- scripts
- CI/CD configuration when relevant

Do not rely on assumptions when repository evidence is available.
If docs and code conflict, report the contradiction.

## 5. Plan when needed

Create a short plan before:

- architecture changes
- database or schema changes
- auth or security-sensitive changes
- dependency changes
- CI/CD changes
- deployment changes
- public API changes
- large refactors
- changes touching several modules at once

The plan should include:

- intended approach
- files likely to change
- verification steps
- risks

## 6. Implement a small focused diff

Change only what the task needs.

Do not:

- refactor unrelated code
- reformat unrelated files
- create temporary test files in the repository
- rewrite project-specific instructions with generic text
- modify application code during documentation-only tasks

If the request crosses a boundary between subsystems, such as plugin <-> Unity, runtime <-> serialized scene state, or code <-> documented contract, confirm the intended end-to-end behavior before editing.

Do not present a partial implementation as complete.

If a required change conflicts with an owner instruction or looks intentionally deferred, stop and ask for clarification instead of silently narrowing the scope.

A preparatory patch is allowed only when the owner explicitly approves it as a separate stage. In that case, report clearly that user-facing behavior is not yet implemented end to end.

## 7. Keep it simple

Before reporting completion, review the diff for unnecessary complexity.

Simplify where safe:

- keep one source of truth for each rule
- reuse existing project patterns
- remove speculative abstractions and unused extension points
- avoid fallback branches without a concrete failure mode
- avoid helpers and wrappers that do not improve clarity
- remove comments that merely restate the code
- keep the change localized to the smallest reasonable area

If non-obvious complexity remains, explain why it is necessary.
Do not expand scope while simplifying.

## 8. Verify

Use `docs/VERIFICATION.md` as the canonical policy and command/source of truth.

For non-documentation tasks:

- run automated checks before manual smoke checks
- if a check cannot be run, say which one, why, and what must be checked later

## 9. Repair loop

If verification fails:

1. Read the failure carefully.
2. Identify the root cause.
3. Fix the cause, not just the symptom.
4. Re-run the relevant checks.
5. Report remaining failures honestly.

Do not hide failed checks.

## 10. Preserve decisions

Record non-obvious decisions while the context is fresh.

Use the narrowest appropriate place:

- Inline comment or JSDoc: local intent, external constraint, invariant, or deliberate trade-off not obvious from code.
- `docs/ARCHITECTURE.md`: subsystem responsibility, state ownership, dependency direction, or cross-layer design decision.
- `docs/DATA_CONTRACT.md`: payload shape, event semantics, precedence rule, or integration contract.
- ADR: only for a durable architectural decision with meaningful alternatives that may need revisiting.

Do not add comments that paraphrase the implementation.
Prefer clearer naming or simpler structure when that solves the problem.

## 11. Final response

Use the canonical final report format from `AGENTS.md`.

Do not add a rollback section by default. Include rollback guidance only when explicitly requested.