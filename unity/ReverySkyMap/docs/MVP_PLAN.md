# ReverySkyMap Unity MVP Plan

This plan is implementation-focused for Unity runtime work from `unity/ReverySkyMap` as project root.
It is extracted from the parent roadmap and keeps only Unity-related steps, renumbered locally in sequential order.

Plan usage rules:
- This file is Unity execution memory and operational source of truth for Unity-only tasks.
- Parent `../../docs/MVP_PLAN.md` remains the historical mixed TS+Unity timeline.
- When a step touches parent plugin code (`src/*`, packaging, Obsidian lifecycle), coordinate with parent plan/docs before implementation.
- Drift sync rule: when cross-scope work changes order/status/risks, update this Unity plan and parent `../../docs/MVP_PLAN.md` in the same task.
- For execution protocol and risk handling, use `docs/WORKFLOW.md` and `docs/RISKS.md`.

Freeze rule:
- Steps marked `DONE` are locked and are not rewritten.
- Plan edits are allowed only after the last `DONE` step.

Current checkpoint:
- Last completed step: `Step 8 (DONE)`.
- Current runtime state: Unity WebGL runtime is integrated with the parent plugin flow (`bridge:ready` -> `graph:set`) and runs in Editor Play mode.
- Current implementation step: `MVP complete (Unity scope)`.
- Execution priority: use Unity MCP as default interface for Unity project access, verification, and Unity-state manipulations.

## Step 1 (DONE) - Create Unity runtime shell from legacy source

Goal:
- Initialize this Unity project and copy minimal scene/assets/scripts needed to open Play mode.
- Keep source-aligned structure for controlled incremental pruning.

Likely affected areas:
- `ProjectSettings/*`
- `Packages/*`
- `Assets/Scenes/*`
- `Assets/Scripts/*`
- `Assets/Prefabs/*`

Acceptance criteria:
- Project opens in Unity Editor.
- Target scene loads and enters Play mode (temporary missing behavior allowed).

Manual test steps:
1. Open this project in Unity.
2. Open mapped scene and enter Play mode.
3. Capture first compile/runtime errors list for pruning.

Likely risks:
- GUID/reference breaks and package version drift.

## Step 2 (DONE) - Decouple standalone app systems from map runtime

Goal:
- Remove/replace dependencies on legacy app singletons, `SaveManager`, `GameSceneLoader`, and unrelated UI flows.
- Keep only map render/navigation runtime path.

Likely affected areas:
- `Assets/Scripts/*`
- `Assets/Scripts/Camera/*`
- `Assets/Scripts/Models/*`
- `Assets/Scripts/Bridge/*`

Acceptance criteria:
- Scene compiles and runs without standalone app bootstrap.
- Map runtime can exist with injected graph data only.

Manual test steps:
1. Enter Play mode with no app data layer present.
2. Confirm no references to removed singleton systems at runtime.
3. Confirm stars/links can be created from a test data provider.

Likely risks:
- Refactor cascade from tightly coupled singletons.

## Step 3 (DONE NO VALIDATION) - Implement Unity bridge receiver and JSON graph ingestion

Goal:
- Add `ObsidianBridge.OnGraphSet(string json)` and mapper from payload to Unity node model.
- Rebuild map from incoming payload.

Likely affected areas:
- `Assets/Scripts/Bridge/*`
- `Assets/Scripts/Map/*`
- `Assets/Scripts/Models/*`

Acceptance criteria:
- Calling `OnGraphSet` with sample payload creates expected node/link counts.
- Repeated payload updates rebuild cleanly.

Manual test steps:
1. Invoke `OnGraphSet` in Play mode with example payload.
2. Validate node/edge counts.
3. Invoke again with changed payload and verify clean rebuild.

Likely risks:
- JSON/model mismatch with TS contract.

## Step 4 (DONE) - Port ReverySky 3D visuals and camera/navigation quality

Goal:
- Port/adapt visual style and navigation from reference (`Star*`, materials, orbital camera behavior).
- Reach a clearly 3D ReverySky-like look.

Likely affected areas:
- `Assets/Scripts/*`
- `Assets/Scripts/Camera/*`
- `Assets/Materials/*`
- `Assets/Prefabs/*`

Acceptance criteria:
- Scene has depth/lighting/material style close to target direction.
- Orbit/pan/zoom behavior is stable and smooth in Play mode.

Manual test steps:
1. Compare visual output to runtime direction.
2. Verify navigation controls under different zoom ranges.
3. Validate readability for small/medium graph sizes.

Likely risks:
- WebGL-incompatible shaders or expensive visual settings.

## Step 5 (DONE) - Build WebGL and replace fallback runtime in plugin

Goal:
- Build WebGL from this Unity project.
- Replace HTML fallback runtime with Unity WebGL artifacts in parent `unity-webgl/`.

Likely affected areas:
- Unity build/export output for WebGL.
- Parent runtime folder: `../../unity-webgl/*` (handoff/integration scope).

Acceptance criteria:
- Obsidian map view loads Unity runtime locally.
- `bridge:ready` and `graph:set` flow works end to end.

Manual test steps:
1. Build WebGL and copy output into parent `unity-webgl/`.
2. Open map view in Obsidian.
3. Verify Unity initializes and renders graph payload.

Likely risks:
- Plugin runtime asset path resolution for loader/data/wasm files.

## Step 6 (DONE) - Unity baseline tests for stable verification

Goal:
- Add Unity-side baseline checks (EditMode + PlayMode smoke + hybrid visual guard) as cleanup guardrails.
- Complete the verification gate before risky Unity cleanup batches.
- Keep scope intentionally small and deterministic.

Why now:
- Cleanup/deletion in Unity without dedicated automated checks is high risk.
- This step completes the verification gate required by Step 7.

Likely affected areas:
- `Packages/manifest.json` (Unity Test Framework, if missing)
- `Assets/Scripts/*.asmdef` (runtime assembly boundary for test references)
- `Assets/Tests/EditMode/*`
- `Assets/Tests/PlayMode/*` (single smoke + visual guard)
- `docs/VERIFICATION.md` (if check mapping needs sync)

Baseline test set to implement:
1. Unity EditMode baseline:
   - `OnGraphSet` minimal payload mapping test (runtime mode enabled, notes/links populated, link weight normalization, stable tag mapping);
   - `OnGraphSet` repeat-apply test (second payload rebuild leaves no stale state);
   - graceful invalid/empty payload handling test (no crash, predictable retained state).
2. Unity PlayMode baseline:
   - open target map scene runtime path and assert no critical bootstrap failure;
   - apply deterministic payload and assert runtime ingestion state.
3. Unity PlayMode hybrid visual guard:
   - capture deterministic camera snapshot signature;
   - compare against baseline metrics using tolerant thresholds (non pixel-perfect);
   - assert structural visual invariants (camera active + expected star count).
4. Test stability policy:
   - visual guard must pass in 3 consecutive reruns with no source changes.
5. Test execution path:
   - run baseline checks via Unity MCP (`run_tests`) by default;
   - use Editor UI/CLI only as fallback when MCP is unavailable.

Acceptance criteria:
- A documented and runnable Unity automated baseline exists.
- Unity verification no longer relies on manual-only checks for core bootstrap path.
- Baseline checks can be rerun before/after cleanup batches with clear pass/fail signal.
- Hybrid visual guard baseline is green for 3/3 consecutive runs.

Manual test steps:
1. Confirm Unity MCP is connected.
2. Run EditMode baseline checks.
3. Run PlayMode runtime bootstrap + visual guard checks.
4. Re-run the visual guard 2 additional times (total 3/3).
5. Confirm this file and `docs/VERIFICATION.md` stay aligned.

Likely risks:
- PlayMode flakiness without strict scope control.
- Hidden defects surfaced during first test harness setup.

Completion notes:
- Unity baseline tests added for EditMode and PlayMode, including hybrid visual guard.
- Manual verification in Unity Editor and runbook-based integration smoke were completed without observed runtime regressions.

## Step 7 (DONE) - Runtime-only cleanup of standalone tail (safe staged execution)

Goal:
- Remove deferred standalone/reference-only systems not required for plugin runtime.
- Finalize Step 2 intent by deleting (not masking) non-map app flows.
- Execute cleanup only through dependency-aware, reversible micro-batches.

Important note:
- A previous one-pass cleanup attempt was too broad and unsafe.
- This step is explicitly staged and verification-first.

Execution (mandatory):
- Open Unity project from this folder root and connect Unity MCP before Step 7 cleanup work.
- For every cleanup batch, run skill `cleanup-batch`.
- Staged execution model is defined in `docs/WORKFLOW.md#staged-execution`; detailed cleanup gate/protocol is defined in skill `cleanup-batch`.
- Use `docs/VERIFICATION.md` for test order, fallback rules, and transport caveats.
- Batch state is tracked in `docs/CLEANUP_BATCH_LEDGER.md`.
- Explicit git permission for this step: `git status`, `git diff`, `git add`, and `git commit` are allowed for batch evidence and commit workflow after successful verification.

Likely affected areas:
- `Assets/Scripts/Bridge/*`
- `Assets/Scripts/*`
- `Assets/Scripts/Storage/*` (standalone-only parts)
- `Assets/Scripts/UI/*` (non-map forms/navigation)
- `Assets/Scripts/Planet/*` (if unused by map runtime)
- `Assets/Scenes/*` (service leftovers such as `.refcopy`)
- `Assets/Tests/EditMode/*`
- `Assets/Tests/PlayMode/*` (optional smoke if stable)

Acceptance criteria:
- Runtime map path compiles/runs without removed standalone systems.
- No map-path runtime references remain to removed legacy singletons (`SaveManager`, `GameSceneLoader`, DB/migration layer).
- Automated Unity checks pass before and after each cleanup batch.
- Cleanup decisions are evidence-based and recorded.

Manual test steps:
1. Confirm Unity MCP is connected.
2. Enter Play mode in target scene and verify no missing script/runtime errors in map path.
3. Run automated guardrail checks.
4. Rebuild WebGL and validate integration baseline in plugin view.
5. Re-scan scripts for forbidden standalone dependencies.

Likely risks:
- Hidden transitive dependencies from visuals/components to old standalone classes.
- MCP data incompleteness or stale editor state.
- Flaky PlayMode checks blocking cleanup cadence.

Step-specific policy (keep):
- Keep cleanup substep names short and practical.
- Prefer grouped batches by logical subsystem/location only when dependency evidence supports safe grouped removal.
- Do not create commits for audit-only/analysis-only steps unless explicitly requested by the user.
- Do not create docs-only cleanup commits; documentation bookkeeping must be bundled into the next code/asset cleanup batch commit.
- Keep known pre-existing unrelated deletions (`Assets/AddressableAssetsData/link.xml` and `.meta`) out of Step 7 cleanup batches.
- Do not rename completed historical batch IDs in docs; keep them aligned with original commit IDs.
- For new batches after `batch-11`, use one batch = one next integer (`12`, `13`, ...) with no letter suffixes.

Batch ledger (append-only):
- Authoritative file: `docs/CLEANUP_BATCH_LEDGER.md`.

Completion notes:
- Staged cleanup completed through `Batch 42` with documented evidence in `docs/CLEANUP_BATCH_LEDGER.md`.
- Runtime-only scope preserved; deferred keep set retained for future work (`st_*` tag texture set).
- Verification baseline remains usable with known MCP PlayMode transport caveat handled via log-based fallback evidence.

## Step 8 (DONE) - Rename domain entities to neutral note-graph terminology

Goal:
- Rename legacy entity names to neutral note-graph terminology.
- Keep behavior and data flow unchanged.

Likely affected areas:
- `Assets/Scripts/**/*`, `Assets/ScriptableObjects/*`, `Assets/Prefabs/*`, tests, Unity docs.
- Parent scope (`../../docs/*`, `../../src/*`) only when bridge-visible names are affected.

Execution (mandatory):
- Run staged micro-batches: `map -> approve -> rename -> verify`.
- Use safe symbol rename/refactor (no blind mass replace).
- Do not break Unity serialization; high-risk serialized renames only with explicit compatibility plan.
- Keep bridge/data-contract renames synchronized with parent docs/code.

Acceptance criteria:
- Active runtime path has neutral terminology (except explicitly deferred names).
- No rename-induced regressions; `recompile` + EditMode pass per batch.
- Terms are consistent across Unity code/tests/docs.

Main risks:
- Serialized rename breakage.
- Bridge contract drift with parent scope.
