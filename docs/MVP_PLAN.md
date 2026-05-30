# ReverySky Map MVP Plan

This plan is implementation-focused and split into minimal, testable steps.
All steps are desktop-first and keep `reference/` untouched.

When executing a numbered MVP step, use the step text as the source of scope.
Do not expand the task beyond that step unless the plan is updated first.
For detailed plan workflow, see `docs/AGENT_WORKFLOW.md`.

Plan steps are roadmap items, not full task tickets.
Use `docs/AGENT_WORKFLOW.md` as the canonical protocol to refine the active step into a concrete task contract (`Mode`, `Goal`, `Scope`, `Out of scope`, `Verification`, `Stop condition`) before edits.

Freeze rule:
- Steps marked `DONE` are locked and are not rewritten.
- Plan edits are allowed only after the last `DONE` step.

Current checkpoint:
- Last completed step: `Step 17 (DONE)`.
- Current renderer in Obsidian view: Unity WebGL runtime loaded from `unity-webgl/`.
- Unity runtime project shell is created and scene starts in Unity Editor.
- Current implementation step: `Step 18 (didn't start)`.

## Step 1 (DONE) - Plugin skeleton with custom map view

Goal:
- Create minimal Obsidian plugin scaffold and register a dedicated map view.

Files likely affected:
- `manifest.json`
- `package.json`
- `tsconfig.json`
- `src/main.ts`
- `src/view/ReverySkyMapView.ts`

Acceptance criteria:
- Plugin loads in Obsidian desktop without errors.
- Command `Open ReverySky Map` opens an empty custom view pane.

Manual test steps:
1. Load plugin in a dev vault.
2. Run command `Open ReverySky Map`.
3. Confirm custom view opens and survives app reload.

Likely risks:
- Incorrect view lifecycle handling (`onOpen/onClose`).

## Step 2 (DONE) - Embedded placeholder map page in plugin assets

Goal:
- Place a local map placeholder page in plugin assets and serve it in view.

Files likely affected:
- `unity-webgl/index.html`
- `src/view/ReverySkyMapView.ts`

Acceptance criteria:
- Map view shows embedded placeholder page inside Obsidian.
- No external web server required in runtime.

Manual test steps:
1. Open map view.
2. Confirm placeholder page appears.
3. Reload plugin and verify page still loads.

Likely risks:
- Resource path resolution inside plugin folder.

## Step 3 (DONE) - TS-to-iframe bridge handshake

Goal:
- Establish reliable message handshake (`bridge:ready`) between iframe JS and plugin TS.

Files likely affected:
- `src/bridge/BridgeTypes.ts`
- `src/bridge/UnityIframeBridge.ts`
- `src/view/ReverySkyMapView.ts`
- `unity-webgl/index.html`

Acceptance criteria:
- Plugin receives `bridge:ready` within timeout after view load.
- Plugin can send `graph:set` envelope without runtime error.

Manual test steps:
1. Open map view with dev console visible.
2. Verify ready message is logged.
3. Trigger reload and confirm no duplicate listeners.

Likely risks:
- Duplicate event handlers after view re-open.

## Step 4 (DONE) - Vault note inventory extraction

Goal:
- Build base note list from markdown files: id/path/title/date/tags.

Files likely affected:
- `src/graph/VaultGraphBuilder.ts`
- `src/graph/GraphNormalizer.ts`
- `src/bridge/BridgeTypes.ts`

Acceptance criteria:
- JSON contains all markdown notes with stable IDs and paths.
- Empty vault and single-note vault both handled.

Manual test steps:
1. Prepare vault with 3-5 notes.
2. Open map view and inspect generated payload in debug log.
3. Confirm each note has path/title/date fields.

Likely risks:
- Missing/ambiguous ID policy when frontmatter `id` is absent.

## Step 5 (DONE) - Link graph extraction

Goal:
- Add note-to-note links and optional link weights to payload.

Files likely affected:
- `src/graph/VaultGraphBuilder.ts`
- `src/bridge/BridgeTypes.ts`

Acceptance criteria:
- Outgoing links from notes appear as graph edges.
- Broken links are either excluded or flagged consistently.

Manual test steps:
1. Create notes with wiki-links and markdown links.
2. Reopen map and inspect edge list.
3. Verify links resolve to existing note IDs when possible.

Likely risks:
- Path normalization differences (`\` vs `/`, case sensitivity).

## Step 6 (DONE) - Data contract validation and versioning

Goal:
- Enforce runtime schema checks before sending payload to map runtime.

Files likely affected:
- `src/bridge/MessageValidator.ts`
- `src/bridge/BridgeTypes.ts`
- `docs/DATA_CONTRACT.md`

Acceptance criteria:
- Invalid payload is rejected with explicit error.
- Contract version is included in every message.

Manual test steps:
1. Force invalid field in dev mode.
2. Confirm validation error and no renderer crash.
3. Restore valid payload and confirm normal operation.

Likely risks:
- Contract drift between TS and Unity models.

## Step 7 (DONE) - HTML fallback graph render in map view

Goal:
- Render first working graph (nodes/edges) in embedded map page via existing bridge and payload.

Files likely affected:
- `unity-webgl/index.html`
- `src/view/ReverySkyMapView.ts`
- `src/bridge/UnityIframeBridge.ts`

Acceptance criteria:
- Node/edge counts match payload.
- Graph updates after bridge refresh.

Manual test steps:
1. Open map view.
2. Confirm nodes and links are visible.
3. Edit links in vault and confirm counts update after refresh cycle.

Likely risks:
- Visual fallback diverges from final Unity runtime behavior.

## Step 8 (DONE) - Legacy scene dependency map and extraction boundary

Goal:
- Audit `reference/ReverySky/Assets/Scenes/ScarScapeScene.unity` and define the exact MVP include/exclude list.
- Lock extraction source to `ScarScapeScene` and map-critical scripts only.

Files likely affected:
- `docs/ARCHITECTURE.md`
- `docs/RISKS.md`
- `docs/MVP_PLAN.md`

Acceptance criteria:
- Include list and exclude list are explicitly documented.
- It is clear which scene/scripts/prefabs are copied first and which are deferred.

Manual test steps:
1. Verify documented source scene is `ScarScapeScene`.
2. Verify excluded systems include note editing, non-map gameplay flows, DB/save flows.
3. Verify next step has a concrete file-copy target.

Likely risks:
- Hidden dependencies not visible until Unity import/compile.

## Step 9 (DONE) - Create Unity runtime shell from legacy source

Goal:
- Initialize `unity/ReverySkyMap` and copy minimal scene/assets/scripts needed to open Play mode.
- Keep source-aligned structure for easier incremental pruning.

Files likely affected:
- `unity/ReverySkyMap/ProjectSettings/*`
- `unity/ReverySkyMap/Packages/*`
- `unity/ReverySkyMap/Assets/Scenes/*`
- `unity/ReverySkyMap/Assets/Scripts/*`
- `unity/ReverySkyMap/Assets/Prefabs/*`

Acceptance criteria:
- Project opens in Unity Editor.
- Target scene loads and enters Play mode (even if with temporary missing behavior).

Manual test steps:
1. Open `unity/ReverySkyMap` in Unity.
2. Open mapped scene and enter Play mode.
3. Capture first compile/runtime errors list for pruning.

Likely risks:
- GUID/reference breaks and package version drift.

## Step 10 (DONE) - Decouple standalone app systems from map runtime

Goal:
- Remove/replace dependencies on legacy app singletons, `SaveManager`, `GameSceneLoader`, and unrelated UI flows.
- Leave only map render/navigation runtime.

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/*`
- `unity/ReverySkyMap/Assets/Scripts/Camera/*`
- `unity/ReverySkyMap/Assets/Scripts/Models/*`
- `unity/ReverySkyMap/Assets/Scripts/Bridge/*`

Acceptance criteria:
- Scene compiles and runs without standalone app bootstrap.
- Map runtime can exist with injected graph data only.

Manual test steps:
1. Enter Play mode with no app data layer present.
2. Confirm no references to removed singleton systems at runtime.
3. Confirm stars/links can be created from test data provider.

Likely risks:
- Refactor cascade from tightly coupled singletons.

## Step 11 (DONE NO VALIDATION) - Implement Unity bridge receiver and JSON graph ingestion

Goal:
- Add `ObsidianBridge.OnGraphSet(string json)` and runtime mapper from plugin payload to Unity node model.
- Rebuild map from incoming payload.

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/Bridge/*`
- `unity/ReverySkyMap/Assets/Scripts/Map/*`
- `unity/ReverySkyMap/Assets/Scripts/Models/*`

Acceptance criteria:
- Calling `OnGraphSet` with sample payload creates expected node/link counts.
- Repeated payload updates rebuild cleanly.

Manual test steps:
1. Invoke `OnGraphSet` in Play mode with example payload.
2. Validate node/edge counts.
3. Invoke again with changed payload and verify clean rebuild.

Likely risks:
- JSON/model mismatch with TS contract.

## Step 12 (DONE) - Port ReverySky 3D visuals and camera/navigation quality

Goal:
- Port/adapt visual style and navigation from reference (`Star*`, materials, orbital camera behavior).
- Reach clearly 3D ReverySky-like look.

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/*`
- `unity/ReverySkyMap/Assets/Scripts/Camera/*`
- `unity/ReverySkyMap/Assets/Materials/*`
- `unity/ReverySkyMap/Assets/Prefabs/*`

Acceptance criteria:
- Scene has depth/lighting/material style close to reference direction.
- Orbit/pan/zoom feels stable and smooth in Play mode.

Manual test steps:
1. Compare visual output to reference runtime direction.
2. Verify navigation controls under different zoom ranges.
3. Validate readability for small/medium graph sizes.

Likely risks:
- WebGL-incompatible shaders or expensive visual settings.

## Step 13 (DONE) - Build WebGL and replace fallback runtime in plugin

Goal:
- Build WebGL from `unity/ReverySkyMap`.
- Replace HTML fallback runtime with Unity WebGL artifacts in `unity-webgl/`.

Files likely affected:
- `unity-webgl/index.html`
- `unity-webgl/Build/*`
- `unity-webgl/TemplateData/*`
- `src/view/ReverySkyMapView.ts`

Acceptance criteria:
- Obsidian map view loads Unity runtime locally.
- `bridge:ready` + `graph:set` work end-to-end.

Manual test steps:
1. Build WebGL and copy output into `unity-webgl/`.
2. Open map view in Obsidian.
3. Verify Unity initializes and renders graph payload.

Likely risks:
- Plugin asset path resolution for WebGL loader/data/wasm.

## Step 14 (DONE) - Non-Unity baseline test harness for stable verification

Goal:
- Add a minimal, high-signal automated verification baseline before risky cleanup work.
- Cover core TS and plugin-side bridge/runtime integration paths so verification requirements in `docs/VERIFICATION.md` are satisfied beyond manual smoke checks.
- Keep scope intentionally small: only tests that protect current behavior and can run repeatedly during cleanup batches.

Why now:
- Cleanup/deletion in Unity without stable automated checks is high risk.
- This step establishes the non-Unity part of the verification gate before Unity-side cleanup.

Files likely affected:
- `package.json` (test scripts)
- `src/bridge/*` (testable contract/validation helpers if needed)
- `src/graph/*` (testable normalization/helpers if needed)
- `tests/*` or `src/**/__tests__/*` (TS baseline tests)
- `docs/VERIFICATION.md` (only if command list or mapping needs explicit sync)

Baseline test set implemented in this step:
1. TypeScript baseline:
   - contract validation test (`MessageValidator` valid/invalid payload paths);
   - graph normalization/path stability test (`GraphNormalizer` or equivalent core path logic);
   - bridge envelope sanity test (ready/set message handling on TS side where unit-testable);
   - bridge/view handshake integration test on TS side (`bridge:ready` -> `graph:set`) with runtime mocked at iframe boundary.
2. Plugin-side verification baseline:
   - `npm run test` and `npm run build` are included as repeatable pre-cleanup checks.
   - manual Obsidian smoke from runbook Step 4+ remains as integration confirmation.

Acceptance criteria:
- A documented and runnable automated baseline exists for TS/plugin-side checks.
- Non-documentation verification for non-Unity scope no longer relies on manual-only checks.
- Baseline checks can be executed before and after risky cleanup batches and give clear pass/fail signal.
- Test scope remains minimal (no broad refactor into full coverage campaign).

Manual test steps:
1. Run TS automated baseline checks and confirm pass.
2. Run `npm run build` and confirm pass.
3. Perform Obsidian smoke checks from runbook Step 4+.
4. Confirm `docs/VERIFICATION.md` expectations are met for non-Unity automated checks.

Likely risks:
- Unity runtime still lacks dedicated automated baseline checks (covered by next step).
- Some runtime paths may be hard to unit-test directly and require seam extraction.
- Initial test harness setup may expose latent defects unrelated to this step.

## Step 15 - Unity baseline tests for stable verification

Goal:
- Add Unity-side baseline checks (EditMode + one PlayMode smoke) as cleanup guardrails.
- Complete the full verification gate started in Step 14 before risky Unity cleanup batches.
- Keep scope intentionally small and deterministic to avoid flaky CI/local gates.

Why now:
- Cleanup/deletion in Unity without dedicated Unity automated checks is high risk.
- This step completes the verification gate that will be used in the next cleanup step.

Files likely affected:
- `unity/ReverySkyMap/Packages/manifest.json` (Unity Test Framework, if missing)
- `unity/ReverySkyMap/Assets/Tests/EditMode/*`
- `unity/ReverySkyMap/Assets/Tests/PlayMode/*` (single stable smoke test only)
- `docs/VERIFICATION.md` (only if Unity check commands/mapping need explicit sync)

Baseline test set to implement:
1. Unity EditMode baseline:
   - payload ingestion/mapping test for `OnGraphSet`-related runtime path with small sample JSON;
   - repeat-apply test (second payload rebuild does not leave stale graph state).
2. Unity PlayMode baseline (one smoke test):
   - open target map scene runtime path and assert no critical bootstrap failure for the map flow;
   - keep this test deterministic and lightweight to avoid flaky gate behavior.

Acceptance criteria:
- A documented and runnable automated Unity baseline exists (EditMode + one PlayMode smoke).
- Unity-side verification no longer relies on manual-only checks for core runtime bootstrap path.
- Baseline checks can be executed before and after risky cleanup batches and give clear pass/fail signal.
- Test scope remains minimal (no broad refactor into full coverage campaign).

Manual test steps:
1. Open Unity project from repo root (`unity/ReverySkyMap`) and run EditMode baseline checks.
2. Run the single PlayMode smoke check and confirm stable pass.
3. Confirm `docs/VERIFICATION.md` expectations are met by available Unity automated checks.

Likely risks:
- Unity PlayMode tests may become flaky without strict scope control.
- Some runtime paths may be hard to unit-test directly and require seam extraction.
- Initial Unity test harness setup may expose latent defects unrelated to this step.

## Step 16 (DONE) - Runtime-only cleanup of standalone tail (safe staged execution)

Goal:
- Remove deferred standalone/reference-only systems from `unity/ReverySkyMap` that are not required for plugin runtime.
- Finalize Step 10 intent by deleting (not masking) non-map app flows and keeping only runtime-required map paths.
- Execute cleanup only through dependency-aware, reversible micro-batches.

Important note:
- Fast one-pass cleanup did not converge safely: Unity dependencies were not mapped deeply enough, and deletions were too broad.
- This step is now explicitly staged and verification-first.

Execution mode (mandatory):
- Open Unity project from repository root path: `unity/ReverySkyMap`.
- Connect Unity MCP before deletions and use MCP-reported project data as primary evidence for dependency checks.
- Use `docs/AGENT_WORKFLOW.md` for staged execution protocol (task mode, approval cadence, repair loop).
- Use `docs/VERIFICATION.md` for required checks and verification order.
- Do not delete candidates without confirmed inbound-reference analysis (scene/prefab/ScriptableObject/serialized fields/GUID links).
- Explicit git permission for this step: `git status`, `git diff`, `git add`, and `git commit` are allowed for batch evidence and commit workflow after successful verification.

Safe substeps (for refinement into concrete tasks):
1. Baseline snapshot and rollback point:
   - Capture current compile/play status and known errors.
   - Capture candidate list for standalone-tail files.
2. Dependency mapping with Unity MCP (per staged execution rules in `docs/AGENT_WORKFLOW.md`):
   - For each candidate, collect inbound references and runtime usage evidence.
   - Mark each candidate as `remove`, `keep`, or `defer` with reason.
3. Guardrails before deletion (per `docs/VERIFICATION.md`):
   - Add/enable minimal automated Unity checks that fail on broken runtime path.
   - Start with EditMode compile/bootstrap checks; add PlayMode smoke check for target scene if feasible.
4. Micro-batch cleanup:
   - Delete only a small approved batch.
   - Re-run Unity checks after each batch; stop on first regression.
5. Integration validation:
   - Rebuild WebGL and verify plugin handshake/data flow baseline (`bridge:ready`, `graph:set`).
   - Continue next batch only after checks are green.

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/Bridge/*`
- `unity/ReverySkyMap/Assets/Scripts/*`
- `unity/ReverySkyMap/Assets/Scripts/Storage/*` (standalone-only parts)
- `unity/ReverySkyMap/Assets/Scripts/UI/*` (non-map forms/navigation)
- `unity/ReverySkyMap/Assets/Scripts/Planet/*` (if not required for map runtime path)
- `unity/ReverySkyMap/Assets/Scenes/*` (service leftovers such as `.refcopy`)
- `unity/ReverySkyMap/Assets/Tests/EditMode/*` (new/updated safety checks)
- `unity/ReverySkyMap/Assets/Tests/PlayMode/*` (optional smoke checks if stable)

Acceptance criteria:
- Scene and scripts compile/run for plugin runtime path without deleted standalone systems.
- No runtime references from map path to removed legacy singletons (`SaveManager`, `GameSceneLoader`, DB/migration layer).
- Automated Unity checks for this step exist and pass before and after each cleanup batch.
- Cleanup decisions are evidence-based (MCP dependency data recorded for each removed candidate).
- Repository tree no longer contains deferred reference-only tail files that were explicitly approved for removal.

Manual test steps:
1. Open `unity/ReverySkyMap` from repo root and confirm Unity MCP is connected.
2. Enter Play mode in target map scene and verify no missing script/runtime errors in map path.
3. Run/confirm automated Unity checks for cleanup guardrails (EditMode and, if available, PlayMode smoke).
4. Build WebGL and run it inside plugin view; validate `bridge:ready`, `graph:set`, and map interaction baseline.
5. Re-scan scripts for forbidden standalone dependencies in map runtime path.

Likely risks:
- Hidden transitive dependencies from map visuals/components to old standalone classes.
- MCP data incompleteness or stale editor state may produce false-safe delete candidates.
- Unstable PlayMode tests may block progress until deterministic smoke scope is defined.

## Step 16A (DONE) - Naming cleanup for neutral note-map terminology

Goal:
- Remove legacy thematic terminology from active runtime and plugin-facing code paths.
- Standardize wording to neutral terms for Obsidian map domain (`note`, `link`, `star`).

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/**/*`
- `unity/ReverySkyMap/Assets/Tests/**/*`
- `unity/ReverySkyMap/Assets/Prefabs/**/*` (text fields and serialized labels only when needed)
- `docs/*` and `unity/ReverySkyMap/docs/*` where terminology must stay aligned with runtime names

Acceptance criteria:
- Active code/comments/logs use neutral terminology consistently.
- Star entity naming is normalized (no legacy star prefixes in runtime-facing code).
- Renames are applied coherently across call chains and tests without behavior changes.
- Any intentionally deferred legacy names are explicitly documented.

Manual test steps:
1. Run automated verification baseline for touched TS/Unity scopes.
2. Open Unity scene and validate map initialization, filtering, and star selection/open-note flow.
3. Confirm no visible user-facing thematic labels remain in active runtime UI.

Likely risks:
- Unity serialized field rename drift if refactors are not compatibility-safe.
- Cross-repo naming drift between parent plugin code/docs and Unity runtime code.

## Step 17 (DONE) - Unity star click -> Obsidian note open

Goal:
- Implement Unity click event emission and TS-side open-note handling.

Files likely affected:
- `unity/ReverySkyMap/Assets/Scripts/Bridge/*`
- `unity/ReverySkyMap/Assets/Scripts/*`
- `src/bridge/UnityIframeBridge.ts`
- `src/view/ReverySkyMapView.ts`
- `src/main.ts`

Acceptance criteria:
- Single click on a star in Unity focuses the star and opens the corresponding note in Obsidian.
- Resolution works by `id`, fallback by `path`.

Manual test steps:
1. Single-click several stars in map (without second click).
2. Verify correct notes open.
3. Rename/move note and validate fallback behavior.

Likely risks:
- Mapping drift between runtime IDs and vault paths.

## Step 18 - Live refresh and release hardening

Goal:
- Finalize automatic graph refresh and package reliability.

Files likely affected:
- `src/graph/VaultGraphBuilder.ts`
- `src/view/ReverySkyMapView.ts`
- `src/bridge/UnityIframeBridge.ts`
- `manifest.json`
- build/release scripts

Acceptance criteria:
- Graph refreshes after vault changes without plugin toggle.
- Clean install package includes all required Unity artifacts.

Manual test steps:
1. Add/edit/remove links and verify map refresh.
2. Run clean-vault install smoke test.
3. Verify startup and interaction performance baseline.

Likely risks:
- Event storms, rebuild churn, and missing release assets.
