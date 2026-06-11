# Cartographer Engine Eval Process

Status: active
Last updated: 2026-06-11

## Purpose

This document defines the repeatable evaluation loop for Cartographer layout
engine experiments.

It exists to make the experiment less dependent on ad hoc decisions while still
preserving owner taste as the final authority for visual quality.

Related state:
- Living journal: `docs/CARTOGRAPHER_ENGINE_EVAL_JOURNAL.md`
- Unity verification policy: `docs/VERIFICATION.md`
- Runtime architecture: `docs/ARCHITECTURE.md`
- Repo-local agent skill: `.codex/skills/cartographer-engine-eval/SKILL.md`

## Scope

In scope:
- choosing the next engine-eval step;
- comparing existing `ICartographerEngine` candidates;
- running one approved candidate or parameter iteration;
- collecting technical evidence;
- recording owner verdicts;
- updating the eval journal after each completed iteration.

Out of scope by default:
- broad refactors of `Cartographer` or engine ownership;
- production promotion of an experiment engine;
- changing bridge/data contracts;
- editing comments inside engine source files;
- accepting a subjective visual winner without owner review.

## Roles

Agent responsibilities:
- read the journal before proposing work;
- identify the smallest useful next eval step;
- keep one iteration isolated to one hypothesis or candidate;
- run technical gates when implementation changes are made;
- collect objective evidence from tests, logs, screenshots, and available metrics;
- produce a preliminary recommendation;
- update the journal with durable facts after the iteration.

Owner responsibilities:
- approve implementation iterations before the agent changes engine code or scene
  wiring;
- judge subjective visual qualities;
- decide whether a candidate is accepted, rejected, parked, or needs another
  iteration;
- define or refine visual taste when agent scoring is ambiguous.

## Evaluation Modes

### `propose-next`

Use when deciding what to do next.

The agent reads the journal and current repo state, then proposes one or more
candidate next steps. No implementation edits are made.

Output:
- recommended next step;
- why it is the smallest useful step;
- expected files if approved;
- expected technical gates;
- owner decision needed.

### `compare-existing`

Use when candidates already exist and the next task is evidence gathering.

The agent compares selected existing engines from the same baseline. This mode
should avoid changing engine code. Scene wiring may be changed only when the
owner explicitly approves it for the comparison.

Output:
- candidates compared;
- dataset/scenario used;
- technical gate results;
- collected metrics;
- owner-review checklist;
- preliminary recommendation.

### `run-one-approved`

Use after the owner approves a specific implementation hypothesis.

The agent makes one isolated change: one new engine, one wrapper, one parameter
profile, or one focused behavior tweak. Do not stack unrelated ideas in the same
iteration.

Output:
- hypothesis tested;
- files changed;
- technical gate results;
- metrics before/after when available;
- preliminary decision;
- journal update.

### `parameter-sweep-approved`

Use after the owner approves a bounded sweep.

Change one parameter family at a time. Do not mix layout algorithm changes with
visual budget, animation timing, or camera behavior in the same sweep.

Output:
- parameter and values tested;
- baseline used;
- per-value evidence;
- best candidate, if any;
- owner-review checkpoint.

### `record-owner-verdict`

Use after the owner reviews visuals or interaction feel.

The agent records the verdict in the journal without changing code.

Output:
- verdict recorded;
- affected candidate;
- decision status after verdict;
- next recommended action.

## Candidate Status Values

Use these terms consistently in the journal:
- `accepted`: owner-approved current best-known state for a defined graph range.
- `active`: under current investigation.
- `pending`: implemented or present but not evaluated enough.
- `fallback`: useful when better candidates fail or for very large/error cases.
- `rejected`: failed gates or owner verdict; do not continue unless reframed.
- `reference only`: kept for ideas or historical comparison, not a candidate.

## Baselines

Track these separately:
- original baseline: the first reference state for the experiment;
- current best-known state: the latest accepted candidate for a defined graph
  range;
- iteration baseline: the exact state used for one candidate or sweep.

Independent candidate engines should be compared from the same baseline. Do not
stack candidate A on candidate B unless the owner explicitly turns B into the
new best-known state first.

## Eval Set

Fast iteration set:
- one primary dataset approved by the owner;
- default candidate until confirmed: `Normal` around 2K notes.

Full validation set:
- `Normal`;
- `Hub`;
- `Clusters`;
- `Tagless`;
- at several graph sizes, likely 500, 2K, 5K, and 10K.

The exact dataset matrix is not finalized. The journal must record the dataset
used for each iteration.

## Technical Gates

A candidate fails immediately if any required gate fails.

Required gates for implementation changes:
- Unity scripts compile.
- Relevant EditMode tests pass.
- PlayMode bootstrap/smoke passes or has a documented MCP transport caveat with
  fallback evidence.
- No new critical console errors.
- The selected engine creates expected stars for the eval dataset.
- Camera/focus does not hit missing-object or unfinished-construction failures.
- No unexpected scene, asset, or contract scope expansion.

Additional gates when scene wiring changes:
- the selected engine script and `.meta` are tracked or intentionally recorded as
  experiment-only;
- `StaticLinks` scene slot points to the intended candidate;
- generated PlayMode artifacts are absent before final report.

## Objective Evidence

Collect what is available now:
- `BuildGraph()` time from logs;
- note count and selected engine from `Cartographer` logs;
- visible-edge count and engine-specific counters when logged;
- PlayMode test result;
- console error/warning snapshot;
- screenshot or visual guard output when available;
- manual FPS observations, clearly marked as manual.

Useful future instrumentation:
- structured metric output per engine run;
- screenshot capture per candidate/scenario;
- automated FPS and moving-camera FPS sampling;
- graph shape metrics such as bounds ratio, occupied volume, and edge-density
  proxy.

Do not block early evals on missing instrumentation. Record missing evidence
explicitly.

## Subjective Owner Verdict

The owner verdict is required for:
- star-map feel;
- beauty and mood;
- cluster readability;
- local link usefulness;
- spatial air;
- tagless-map acceptability;
- whether a macro atlas is acceptable as a different mode;
- whether performance trade-offs feel worth it.

Suggested owner verdict terms:
- `accept`;
- `reject`;
- `promising`;
- `needs one more iteration`;
- `park for later`;
- `split by graph size`.

Agent can provide a preliminary visual read, but it must not mark subjective
quality as accepted without owner review.

## Decision Order

Use this order:
1. Technical gates.
2. Objective metrics.
3. Agent qualitative read.
4. Owner verdict.

Examples:
- A beautiful candidate that fails compile or focus safety is rejected or repaired
  before visual acceptance.
- A fast candidate that looks structurally useless can be parked as fallback, not
  promoted.
- A candidate with worse metrics may still continue if the owner says its visual
  direction is clearly better and the technical gates pass.

## Stop Criteria

Stop the current iteration when:
- a technical gate fails;
- the diff expands beyond the approved hypothesis;
- the selected candidate needs owner visual review;
- the iteration budget is exhausted;
- objective metrics regress enough that a repair/reframe is needed;
- the same idea has produced two consecutive non-improving variants.

Start a new process checkpoint when:
- accepting a new best-known state;
- retiring a candidate family;
- changing the target graph-size range;
- adding instrumentation;
- promoting an experiment engine into production runtime ownership.

## Journal Update Rules

After every completed eval iteration, update
`docs/CARTOGRAPHER_ENGINE_EVAL_JOURNAL.md`.

Record:
- date;
- mode;
- baseline;
- hypothesis or candidate;
- isolated change;
- dataset;
- technical gates;
- objective evidence;
- owner verdict, if available;
- decision;
- best-known state after the iteration;
- commit or discarded diff status;
- next action.

Do not rewrite engine source comments as part of journal maintenance unless the
owner explicitly asks for comment cleanup.

## Recommended First Automation Slice

Before letting the agent autonomously implement new engines, use the skill in
this order:
1. `propose-next`
2. owner approval
3. `compare-existing` for `Engine_RecursiveHubs_v3`,
   `Engine_RecursiveHubs_v6`, and `Engine_Barnes_v7_VolumeGuard`
4. owner visual verdict
5. one approved `run-one-approved` iteration

This keeps the process controlled while the evidence format stabilizes.
