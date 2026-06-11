# Unity Verification Policy

This document defines verification expectations for Unity runtime changes when working from `unity/ReverySkyMap` as project root.

## Goals
- Keep runtime changes safe and repeatable.
- Detect regressions early during cleanup/refactor batches.
- Separate Unity-local verification from parent plugin-level integration checks.

## MCP-First Verification Priority
- Unity MCP is the default path for Unity verification actions in this subproject.
- Before running verification, confirm MCP connectivity and live editor access.
- Prefer MCP-native commands for:
  - test execution,
  - scene status inspection,
  - console log collection.
- Use Editor UI/CLI fallback only when MCP is unavailable or does not support the required check.

## MCP Command Source of Truth
- Official MCP Unity command/reference docs:
  - https://github.com/codergamester/mcp-unity
- Do not guess tool names or `execute_menu_item` paths.
- For menu execution, use only menu paths confirmed by Unity menu items listing/resource and current editor state.

## Required Automated Baseline (Unity Scope)

For non-documentation Unity runtime changes, run at least one relevant automated Unity check.
Expected baseline for this project:
- Unity EditMode tests for affected runtime code.
- Unity PlayMode smoke test for target scene/runtime path.
- Unity PlayMode hybrid visual guard (snapshot signature + structural invariants).

Preferred baseline gate for risky tasks:
1. EditMode baseline suite.
2. Deterministic PlayMode smoke + visual guard run.
3. Visual guard repeat run `x3` (same commit, no source changes) for stability.

## Command Matrix (MCP-First with Editor/CLI Fallback)

Use MCP commands first. If MCP is unavailable, use Editor UI or CLI fallback.

### Connectivity/State (run before risky batches)
- MCP:
  1. `get_scene_info` (active scene loaded/dirty status).
  2. `get_console_logs` (recent errors/warnings window).

### EditMode
- MCP:
  1. `run_tests` with `testMode=EditMode`.
  2. Optional scope filter example:
```powershell
testFilter: "ObsidianBridgeEditModeTests"
```
- Editor UI:
  1. Open `Window > General > Test Runner`.
  2. Select `EditMode`.
  3. Run `Run All` (or a scoped suite when task-specific).
- CLI:
```powershell
"<UnityEditorPath>\Unity.exe" -batchmode -nographics -projectPath "<ProjectRoot>\unity\ReverySkyMap" -runTests -testPlatform EditMode -testResults "<ProjectRoot>\unity\ReverySkyMap\artifacts\test-results\editmode.xml" -quit
```

### PlayMode
- MCP:
  1. `run_tests` with `testMode=PlayMode` (or agreed smoke filter).
  2. Baseline scope filter examples:
```powershell
testFilter: "MapRuntimePlayModeTests.RuntimeBootstrap_LoadsSceneAndAppliesPayloadWithoutCriticalErrors"
testFilter: "MapRuntimePlayModeTests.VisualGuard_SnapshotAndStructuralInvariants_AreStable"
```
- Editor UI:
  1. Open `Window > General > Test Runner`.
  2. Select `PlayMode`.
  3. Run `Run All` or the agreed smoke test filter for the current step.
- CLI:
```powershell
"<UnityEditorPath>\Unity.exe" -batchmode -nographics -projectPath "<ProjectRoot>\unity\ReverySkyMap" -runTests -testPlatform PlayMode -testResults "<ProjectRoot>\unity\ReverySkyMap\artifacts\test-results\playmode.xml" -quit
```

### Optional test filter (EditMode/PlayMode CLI)
```powershell
-testFilter "<Namespace.ClassName.MethodName>"
```

### Known MCP behavior for PlayMode test runs
- `run_tests` in `PlayMode` may return `Connection failed: Unknown error` because domain reload can drop the bridge during transition to Play Mode.
- Treat this as a transport-side condition first, then confirm execution via:
  1. MCP reconnection logs (`WebSocket server started successfully` / client reconnect),
  2. expected test-side console markers for the filtered test path (for this baseline: `"[ObsidianBridge] graph:set applied..."` from PlayMode setup),
  3. `get_console_logs(logType=error)` check with no new critical errors from the test run window,
  4. fallback rerun via Editor UI or CLI when MCP transport signal remains ambiguous.
- If this blocks stable automation, use the workaround documented by MCP Unity: disable Reload Domain in Unity Editor Enter Play Mode Settings.

If a required automated check cannot be run, report:
- which check was skipped,
- why it was skipped,
- what must be run later.

## Manual Baseline (Unity Scope)

Manual checks are required in addition to automation:
1. Open this Unity project.
2. Open `Assets/Scenes/StarScapeScene.unity`.
3. Enter Play mode.
4. Confirm no missing scripts and no critical runtime errors in Console.

## Cleanup / Deletion Verification Loop

For cleanup or deletion tasks:
- execution flow is owned by `docs/WORKFLOW.md`;
- detailed candidate and approval protocol is owned by skill `cleanup-batch`;
- this file owns only the verification gate for each approved micro-batch.

Verification gate:
1. Capture baseline test status before edits when risk warrants it.
2. After the approved micro-batch, re-run the relevant automated Unity checks.
3. Run the manual scene smoke check when serialized scene/prefab/asset behavior is touched.
4. Stop on first regression and use the repair loop in `docs/WORKFLOW.md`.
5. Record MCP evidence: scene status, scoped console logs, and test outcome or transport caveat.

### Workspace hygiene after PlayMode/MCP runs (Required)
- Test-run transient scenes named `Assets/InitTestScene*.unity` (and matching `.meta`) are artifacts, not source.
- They must be removed before final report and before commit.
- For verification reports, include an explicit note that these artifacts are absent.
- `Assets/_Visuals/Materials/Skybox_Nebula.mat` may change as editor-local drift during verification.
- Unless the task explicitly edits that material, treat it as out-of-scope noise and exclude it from cleanup commits.

## Integration Handoff to Parent Scope

If a Unity change affects WebGL artifacts, bridge behavior, or Obsidian integration:
1. Run parent WebGL import/build workflow.
2. Run parent Obsidian integration smoke checks.
3. Confirm `bridge:ready` and `graph:set` flow in plugin view.

Reference (parent scope):
- `../../docs/WEBGL_INTEGRATION_RUNBOOK.md`
- `../../docs/MVP_PLAN.md`

This Unity verification file does not replace parent plugin verification requirements.

## Related Unity Docs
- `docs/WORKFLOW.md`
- `docs/RISKS.md`
- `docs/DATA_CONTRACT.md`

## Task Report Requirements
Use the final report format from `AGENTS.md`.
