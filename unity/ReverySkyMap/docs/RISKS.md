# Unity Runtime Risks

This register tracks Unity-specific risks for deterministic execution of active and near-term steps.

## R1. Hidden Dependency Breakage During Cleanup
Risk:
- Removing scripts/assets that still have inbound references from runtime map path.

Trigger:
- Any staged deletion or pruning in map runtime subsystems.

Mitigation:
- Use staged cleanup from `docs/WORKFLOW.md` and the `cleanup-batch` skill.
- Require dependency evidence before deletion (scene/prefab/SO/serialized/GUID).
- Re-verify with the gate in `docs/VERIFICATION.md`.

Verification signal:
- Relevant EditMode/PlayMode checks pass after each batch.
- No missing-script/runtime-reference errors in map scene smoke.

## R2. Flaky PlayMode Smoke Gate
Risk:
- Non-deterministic PlayMode smoke causes false failures and blocks safe progress.

Trigger:
- Intermittent pass/fail without source changes.

Mitigation:
- Keep smoke scope minimal and deterministic.
- Avoid long chains of scene-side assertions.
- Separate smoke failure diagnostics from cleanup edits.
- Use the transport-caveat handling in `docs/VERIFICATION.md`.

Verification signal:
- Stable repeated smoke pass over several reruns.
- Failures become reproducible with clear root cause.

## R3. Incomplete Baseline Coverage
Risk:
- Cleanup changes regress runtime behavior outside currently tested paths.

Trigger:
- New runtime branch touched with no matching EditMode/PlayMode assertion.

Mitigation:
- Expand baseline only for touched risk area (minimal targeted tests).
- Do not start risky batch if baseline does not cover changed runtime path.

Verification signal:
- Relevant tests exist for changed area.
- Regression is caught in automated gate before manual integration checks.

## R4. Unity Graph Ingestion Contract Drift
Risk:
- Runtime ingestion logic diverges from expected `graph:set` envelope/payload shape.

Trigger:
- Refactor in bridge/mapper models or payload assumptions.

Mitigation:
- Keep Unity contract subset documented in `docs/DATA_CONTRACT.md`.
- Add/update ingestion tests using canonical sample payloads.

Verification signal:
- `OnGraphSet` baseline tests pass with documented payload examples.
- Unknown-field tolerance and core invariants still hold.

## R5. WebGL Regression After Unity-Side Cleanup
Risk:
- Editor runtime is green, but exported WebGL runtime breaks in integration path.

Trigger:
- Any cleanup that affects runtime initialization, assets, or bridge path.

Mitigation:
- Add integration handoff checkpoint after risky batches.
- Rebuild WebGL and run parent integration smoke when boundary is touched.

Verification signal:
- Parent integration smoke confirms `bridge:ready` and `graph:set` flow.
- No runtime startup errors in plugin map view.

## R6. Accidental Sample Graph in Release Build
Risk:
- Debug sample data is left enabled and masks an empty or filtered real note set in a production build.

Trigger:
- Scene-side sample injection remains active outside the Unity Editor.

Mitigation:
- Keep `SampleDataGenerator` injection guarded by `UNITY_EDITOR`.
- Treat empty `graph:set` payloads as valid runtime input and surface the empty-state UI instead of synthesizing notes.

Verification signal:
- Player/WebGL builds never execute sample injection.
- Empty runtime payloads still rebuild to an empty graph state without fallback data.

## R7. Nebula skybox compression

`Nebula_03_Cubemap.exr` is excluded from Git, so its import settings must be restored manually.

Release baseline for WebGL / Obsidian desktop:

Nebula_03_Cubemap:
Texture Shape: Cube
Max Size: 2048
Generate Mipmap: Off
Filter Mode: Bilinear
Compression: High Quality
Use Crunch Compression: Off
Web Override: Off

Player Settings / Web:
Texture compression format: DXT
HDR Cubemap Encoding: Normal Quality

Expected result:

2048x2048 RGBA Compressed DXT5|BC3 sRGB
RGBM encoded
approximately 24 MB