---
name: cartographer-engine-eval
description: Run the repo-specific eval loop for ReverySkyMap Cartographer engine experiments. Use when proposing, comparing, implementing, or recording verdicts for ICartographerEngine candidates.
---

# Cartographer Engine Eval

Use this skill for repeated evaluation of Cartographer layout engine candidates.

This skill is process-first. It may propose work, compare existing candidates,
run one approved implementation iteration, or record owner verdicts. It must not
turn subjective visual quality into an accepted decision without owner review.

## Canonical files

Read these first:
- `AGENTS.md`
- `docs/CARTOGRAPHER_ENGINE_EVAL_PROCESS.md`
- `docs/CARTOGRAPHER_ENGINE_EVAL_JOURNAL.md`
- `docs/VERIFICATION.md`
- `docs/ARCHITECTURE.md` when scene/runtime ownership matters

Keep changing experiment state in:
- `docs/CARTOGRAPHER_ENGINE_EVAL_JOURNAL.md`

Do not edit engine source comments unless the owner explicitly asks.

## Supported modes

Infer the mode from the owner request. If unclear, use `propose-next`.

### `propose-next`

Audit-only. Do not edit implementation files.

Steps:
1. Read the journal and current Git status.
2. Identify the smallest useful next eval step.
3. Prefer unresolved journal questions and active candidates.
4. Return a proposal with expected scope, files, gates, metrics, and owner
   decision needed.

### `compare-existing`

Usually audit-only unless the owner explicitly approves temporary scene or
runner changes.

Steps:
1. Confirm candidates and shared baseline.
2. Confirm dataset/scenario.
3. Run available technical gates and collect logs/metrics when feasible.
4. Record objective evidence.
5. Ask for owner visual verdict when screenshots or Play Mode review are needed.
6. Update the journal only with durable facts.

### `run-one-approved`

Implementation mode. Use only after explicit owner approval for the hypothesis.

Rules:
- one iteration tests one hypothesis or one isolated candidate;
- do not combine algorithm changes, visual-budget changes, animation timing, and
  camera behavior unless the owner explicitly approves that combined scope;
- do not promote a candidate to production ownership in the same step unless the
  owner asks for promotion;
- preserve rejected variants as discarded or parked, not as new baseline.

Steps:
1. Define the task contract before edits.
2. Capture baseline status and expected gates.
3. Make the smallest implementation diff.
4. Run relevant verification from `docs/VERIFICATION.md`.
5. Collect objective evidence.
6. Produce a preliminary recommendation.
7. Update the journal with iteration results.

### `parameter-sweep-approved`

Implementation mode. Use only after explicit owner approval.

Rules:
- sweep one parameter family at a time;
- state the allowed values before editing;
- compare each value from the same baseline where feasible;
- stop early on gate failure or clear non-improvement.

### `record-owner-verdict`

Docs-only mode.

Steps:
1. Read the journal.
2. Record the owner verdict under the relevant candidate/iteration.
3. Update current best-known state only when the verdict clearly accepts a
   candidate for a graph-size range.
4. Add the next recommended action.

## Gates

For implementation changes, required gates are:
- compile succeeds;
- relevant EditMode checks pass;
- PlayMode smoke or documented MCP transport-caveat fallback;
- no new critical console errors;
- selected engine creates expected stars;
- focus/camera path does not fail;
- scope remains inside the approved hypothesis.

For scene wiring changes, also verify:
- intended `StaticLinks` candidate is wired;
- selected engine script and `.meta` are tracked or explicitly marked
  experiment-only;
- transient `Assets/InitTestScene*.unity*` artifacts are absent before final
  report.

## Evidence to collect

Use available evidence first:
- `BuildGraph()` time from logs;
- note count and engine name from `Cartographer` logs;
- visible edge count and engine-specific counters when logged;
- test results;
- console logs;
- screenshot or visual guard evidence when available;
- owner FPS observations, marked as manual.

Do not invent unavailable metrics. If a metric is missing, report it as missing
instrumentation.

## Decision rules

Use this order:
1. Technical gates.
2. Objective metrics.
3. Agent qualitative read.
4. Owner verdict.

Agent may recommend:
- `reject`;
- `keep evaluating`;
- `owner review required`;
- `promising`;
- `candidate for graph-size split`;
- `ready for promotion proposal`.

Agent must not mark subjective beauty as accepted without owner verdict.

## Journal entry template

When updating the journal, use this compact shape under `Recent Changes` or an
iteration section if one exists:

```text
- YYYY-MM-DD: [mode] [candidate/hypothesis].
  Baseline: ...
  Dataset: ...
  Technical gates: ...
  Objective evidence: ...
  Owner verdict: ...
  Decision: ...
  Next action: ...
```

## Output format

Return:

```text
Mode
Baseline used
Hypothesis or candidates
Files changed
Technical gates
Objective evidence
Agent qualitative read
Owner checkpoint
Recommended decision
Journal update status
Risks / follow-ups
```

For `propose-next`, replace `Files changed` with `Expected files`.

## Safety

- Do not edit `*.unity`, `*.prefab`, `*.asset`, or `*.meta` unless the owner
  explicitly approves that mode and scope.
- Do not change engine comments unless explicitly requested.
- Do not delete or rename experiment candidates in eval mode.
- Do not continue after a technical gate fails; switch to repair or report.
- Do not treat a dirty scene reference to an untracked script as an accepted
  production state.
