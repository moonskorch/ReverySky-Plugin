# Agent Workflow

This document defines the required workflow for AI-assisted development tasks in this repository.

Goal: keep every task traceable, verifiable, and easy to review.

## Project-level workflow

For ongoing MVP work, do not start meaningful implementation tasks directly from memory.

Before starting a new substantial work block:

1. Read `MVP_PLAN.md` and current task notes.
2. Compare the plan with the current repository state.
3. Check whether the next planned step is still the right next step.
4. If project reality changed, update the plan first.
5. Move blocking cleanup, stabilization, or risk-reduction work earlier when it affects future implementation.
6. Convert the selected plan item into a concrete task with scope, done criteria, verification, and manual checks.
7. Then follow the task workflow loop.

`MVP_PLAN.md` is the roadmap. Individual tasks are execution units derived from it.
When executing a numbered MVP step, use the step text as the source of scope.
Do not expand the task beyond that step unless the plan is updated first.

## Self-contained implementation and cross-layer changes

Do not present a partial implementation as a completed feature.

Before editing, identify whether the requested behavior crosses a boundary between subsystems, such as plugin ↔ Unity, runtime ↔ serialized scene state, or code ↔ documented contract.

If a required change conflicts with an owner instruction or appears to be intentionally deferred, stop before editing and ask for clarification. Do not silently choose a narrower interpretation that leaves the requested behavior incomplete.

A preparatory patch is allowed only when the owner explicitly approves it as a separate stage. In that case, report clearly that the user-facing behavior is not yet implemented end-to-end.

## Task modes

Before starting a task, choose the safest execution mode.

- **Direct edit:** use for small, low-risk changes with clear scope.
- **Plan-first:** use for broad, risky, architectural, integration, dependency, CI/CD, or multi-module changes.
- **Audit-only:** use when the task is to inspect, classify, understand, or assess. Do not modify code in this mode.
- **Staged execution:** use for risky cleanup, deletion, migration, or work that previously caused breakage. Start with audit-only, then execute small approved batches with verification after each batch.
- **Repair loop:** use when checks fail. Diagnose the root cause, fix it, and re-run the relevant checks.

If the mode is unclear, choose the safer mode.
For cleanup or deletion, never start with broad edits.

## Task contract (required before edits)

Before implementation, write a short task contract that answers six questions:

- Mode: how to execute (`audit-only`, `direct edit`, `staged cleanup`, or another explicit mode from this workflow)
- Goal: expected outcome
- Scope: what may be changed
- Out of scope: what must not be changed
- Verification: checks that prove the result
- Stop condition: exact condition when the agent must stop and report

Keep it compact (typically 6-10 lines).  
For tiny low-risk edits, a one-paragraph compact contract is acceptable if all six fields are still explicit.

### UI styling

For UI styling changes, reuse existing project patterns and native controls where practical.
Do not add custom icons, inline SVG data URIs, or decorative behavior unless required by the task or already established in the codebase.
Call out any non-obvious styling technique in the final report.

## 1. Define the task

Before editing, identify:

- Goal
- Scope
- Constraints
- Done criteria
- Files or areas likely to be affected
- Risks or unclear assumptions

For small tasks, this can be a short summary.
For broad or risky tasks, create a plan before editing.

## 2. Inspect context

Read the relevant project context before changing files:

- `AGENTS.md`
- `README.md` (if present)
- Relevant files in `docs/`
- Existing implementation files
- Tests
- Config files
- Scripts
- CI/CD configuration, if relevant

Do not rely on assumptions when repository evidence is available.

If docs and code conflict, report the contradiction.

## 3. Plan when needed

Create a short plan before:

- Architecture changes
- Database or schema changes
- Auth or security-sensitive changes
- Dependency changes
- CI/CD changes
- Deployment changes
- Public API changes
- Large refactors
- Changes touching several modules at once

The plan should include:

- Intended approach
- Files likely to change
- Verification steps
- Risks

## 4. Implement a small focused diff

Change only what is needed for the task.

Do not:

- Refactor unrelated code
- Reformat unrelated files
- Create temporary test files in the repository
- Rewrite working project-specific instructions with generic text
- Modify application code during documentation-only tasks

## 5. Verify

Run checks using `docs/VERIFICATION.md` as canonical policy and command/source-of-truth.
For non-documentation changes, automated checks are required and must be executed before manual smoke checks.

If a check cannot be run, state:

- Which check was not run
- Why it was not run
- What should be checked later

## 6. Repair loop

If verification fails:

1. Read the failure carefully.
2. Identify the root cause.
3. Fix the cause, not only the visible symptom.
4. Re-run the relevant checks.
5. Report remaining failures honestly.

Do not hide failed checks.

## 7. Final response

Use the canonical final report format from `AGENTS.md`.

Do not add a rollback section by default. Include rollback guidance only when explicitly requested.

## 8. Expected result

A completed task should make it clear:

- What changed
- Why it changed
- Where it changed
- How it was checked
- What still needs human review
