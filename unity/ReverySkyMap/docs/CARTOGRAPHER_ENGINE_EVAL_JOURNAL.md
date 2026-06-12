# Cartographer Engine Eval Journal

Status: active
Last updated: 2026-06-12

## Theme

Manual eval-driven exploration of `ICartographerEngine` implementations for the
Unity map runtime.

The current experiment compares several layout families for note graphs:
force-directed, date-based 2.5D, static spatial layouts, Barnes-Hut force
variants, recursive-hub structural layouts, landmark/stress layouts, and
macro/constellation atlases.

## Goal

Find a practical engine direction that preserves the ReverySky star-map feel
while staying usable for small, medium, and large vault graphs.

The journal is meant to keep experiment state outside the engine source files:
what each candidate is trying to prove, what has already been observed, which
trade-offs matter, and what should be evaluated next.

## External Behavior Baseline

This is not an external-product parity experiment. The useful baseline is the
current Unity runtime behavior:

- `Cartographer` selects an active `ICartographerEngine` from serialized scene
  slots.
- `Forces` handles small graph mode.
- `Static25D` handles the date-axis map.
- `StaticLinks` is the large-graph slot under active experimentation.
- In the current dirty workspace, `Assets/Scenes/StarScapeScene.unity` wires the
  `StaticLinks` slot to a RecursiveHubs candidate; the latest and most
  developed variant in the eval family is `Engine_RecursiveHubs_v6`.
- The same dirty workspace contains several untracked engine candidates; treat
  them as experiment state until explicitly accepted.

## Findings

### Evaluation dimensions currently in use

- Visual character: star-map feel, not just graph correctness.
- Structure readability: clusters, hubs, local neighborhoods, and direct links
  should remain legible.
- Spatial air: avoid glued clusters, congested centers, and flat plates.
- Tagless behavior: tagless maps should not collapse into random shells,
  vertical spindles, or structureless point clouds.
- Performance: `BuildGraph()` time, Play Mode FPS, and moving-camera FPS matter
  separately.
- Interaction safety: `BuildGraph()` must leave enough materialized objects for
  focus and camera navigation to work.
- Large graph behavior: 2K, 5K, and 10K maps may need different winners.

### Current engine inventory

| Engine | Family | Runtime mode | Current read |
| --- | --- | --- | --- |
| `CartographerForcesEngine` | live force-directed | `Forces`, ticks every frame | Small-graph baseline. Uses note-tag and note-note springs with runtime links. Not the main large-graph candidate. |
| `Cartographer25DEngine` | date-based chain/depth map | `Static25D`, no tick | Date-axis engine with known TODOs for labels, radial movement, LOD, and preferred camera start. Separate from static-link comparison. |
| `Engine_EmptySpheres` | static link placement | `StaticLinks`, no tick | Excellent performance and useful fallback. Structural value is low, especially for tagless and larger graphs. |
| `Engine_FullSimpleStatic_v1` | static link placement | `StaticLinks`, no tick | More compact and slightly more structural than `Engine_EmptySpheres`, but mostly superseded by it. Not worth more investment unless a specific idea is salvaged. |
| `Engine_Barnes_v1` | Barnes-Hut settled force | `StaticLinks`, no tick | Strong medium-graph shape and cluster separation. Too slow and had center-offset flattening. Promising but not viable without fixes. |
| `Engine_Barnes_v2_FixedCenterIntoPlate` | Barnes-Hut settled force | `StaticLinks`, no tick | Faster and tolerable at small scales, but developed a plate-shape/camera-orientation defect and lost some v1 visual strength. |
| `Engine_Barnes_v3_Recentered` | Barnes v1 derivative | `StaticLinks`, no tick | Targets v1 center drift while preserving v1 visual character. Current source note says it may load slightly slower. |
| `Engine_Barnes_v4_TaglessIsotropicSeed` | Barnes v3 derivative | `StaticLinks`, no tick | Targets the tagless vertical spindle by reseeding tagless components isotropically. |
| `Engine_Barnes_v5_FasterMidSize` | standalone Barnes variant | `StaticLinks`, no tick | Targets 501-2K physical nodes with fewer/rougher settle passes while preserving the airy Barnes look and tagless isotropy. |
| `Engine_Barnes_v6_ShapeBalanced` | Barnes v5 profile wrapper | `StaticLinks`, no tick | Retunes v5 for shape: more accuracy, stronger direct-link structure, and less plate behavior while trying to keep speed. Uses reflective profile writes. |
| `Engine_Barnes_v7_VolumeGuard` | standalone Barnes variant | `StaticLinks`, no tick | Current comments describe it as an improved v1 direction and the best force-style structure/readability candidate up to about 2K, but still visually glued at 2K and somewhat plate-shaped on tagged graphs. |
| `Engine_Grid_v1_1_Relaxed` | grid/spatial-hash settled force | `StaticLinks`, no tick | Rejected: poor visual quality, overcrowding, spherical blobs, center alignment defect, and weak performance. |
| `Engine_Grid_v2_FixedCenterIntoPlate` | grid/spatial-hash settled force | `StaticLinks`, no tick | Faster than v1 but still plate-shaped and congested. Needs major spacing/shape improvement before more evaluation. |
| `Engine_LandmarkStress_v1` | landmark/stress embedding | `StaticLinks`, no tick | Pending manual evaluation. Tests a middle path between simple static placement and all-node force simulation. |
| `Engine_MacroCosmos10K_v1` | macro-cluster atlas | `StaticLinks`, no tick | Pending manual evaluation. Designed for 10K maps where macro topics and spatial air matter more than local link readability. |
| `Engine_StarfieldConstellations10K_v1` | constellation atlas | `StaticLinks`, no tick | Pending manual evaluation against `Engine_MacroCosmos10K_v1` and recursive hubs. Hides local links and emphasizes macro theme constellations. |
| `Engine_RecursiveHubs_v1` | structural hub placement | `StaticLinks`, no tick | Superseded by v2. Owner notes describe artificial separation, long links, edge flattening, and hub/large-map congestion. |
| `Engine_RecursiveHubs_v2` | iterative hub-cluster layout | `StaticLinks`, ticks during refinement | Strong cosmos character and useful local links, but serious FPS issues at 5K and 10K. Worth improving as a distinct visual direction. |
| `Engine_RecursiveHubs_v3` | progressive structural hubs | `StaticLinks`, ticks during construction/refinement | Earlier RecursiveHubs baseline. Owner notes preferred this direction over Barnes up to about 2K, but it is now superseded by v6 as the active family baseline. |
| `Engine_RecursiveHubs_v4` | safety wrapper for v3 | `StaticLinks`, inherits v3 | Targets the camera/focus risk from progressive construction. Source comments conflict: one note says the bug was not fixed and the variant is rejected, while the structured block still says pending validation. |
| `Engine_RecursiveHubs_v5` | v3 animation-control wrapper | `StaticLinks`, inherits v3 | Pending FPS/feel evaluation. Separates construction timing from link refinement timing. |
| `Engine_RecursiveHubs_v6` | RecursiveHubs final-pass wrapper | `StaticLinks`, inherits v3 | Current active family baseline and latest worked-out variant. Adds animation timing, adaptive line budgets, edge pruning, and optional large-graph visual throttles. |

### Candidate families

- Static fallback family: `Engine_EmptySpheres`, `Engine_FullSimpleStatic_v1`.
- Settled force family: Barnes and Grid variants.
- Structural hub family: `Engine_RecursiveHubs_v1` through v6.
- Macro atlas family: `Engine_MacroCosmos10K_v1`,
  `Engine_StarfieldConstellations10K_v1`.
- Alternative embedding family: `Engine_LandmarkStress_v1`.

### Current best-known state

Owner verdict now settles the medium-and-large-graph direction on the
RecursiveHubs family.

- Accepted direction for medium and large maps: the RecursiveHubs family, with
  `Engine_RecursiveHubs_v6` as the current active baseline.
- This choice covers the 2K and 10K work focus the eval was steering toward.
- The decision is based on the owner's read that RecursiveHubs is the most
  beautiful, structural, and performant option across those sizes.
- Barnes and macro candidates remain useful references, but they are no longer
  the primary line of development for medium or large maps.

## Decisions Currently in Force

- Treat RecursiveHubs as the accepted medium-and-large-map direction until a
  later owner verdict changes it.
- Do not edit engine source comments while formalizing this journal.
- Treat comments before engine classes as primary raw experiment notes.
- Keep changing experiment state in this journal, not scattered across new
  prose comments in engine files.
- Keep original baseline and current best-known state separate.
- Compare independent candidate engines from a shared baseline where possible.
- Technical gates outrank objective metrics, and objective metrics outrank owner
  preference only when a gate is involved. Subjective visual quality requires
  owner verdict.
- A rejected or degraded variant must not become the next baseline.
- Final acceptance should use the full eval set, not only the fast iteration
  sample.

## Implemented Slices

- Runtime engine contract exists: `ICartographerEngine`.
- `Cartographer` can switch between `Forces`, `Static25D`, and `StaticLinks`.
- PlayMode coverage includes engine preference switching and runtime bootstrap.
- EditMode coverage includes bridge ingestion and selected layout helper checks.
- Multiple `StaticLinks` candidate engines exist as experiment implementations.

## Open Questions

- Should the active `StaticLinks` slot stay on `Engine_RecursiveHubs_v6` or move
  to another RecursiveHubs variant if tuning proves it is worth it?
- What is the primary fast iteration dataset: 501 notes, 2K notes, or another
  sample size?
- What is the final eval set: likely Normal, Hub, Clusters, and Tagless at
  500/1500/2K/5K/10K, but this still needs owner confirmation.
- Should 10K maps optimize for local links, macro topic readability, or a
  deliberately different "cosmos atlas" view?
- What minimum FPS/build-time thresholds are acceptable for 2K, 5K, and 10K?
- Which current candidates should be retired, kept as references, or promoted
  out of `EngineExperiments`?

## Candidate Follow-up Slices

- Confirm the eval set and owner scoring vocabulary before the next engine
  iteration.
- Reclassify the non-RecursiveHubs candidates as `reference only`, `fallback`,
  or `parked` where that matches the current owner verdict.
- Keep tuning `Engine_RecursiveHubs_v6` and its close RecursiveHubs derivatives
  for shape, FPS, and line readability on 2K and 10K.
- Decide whether future RecursiveHubs variants deserve a separate comparison
  round or can stay as local tuning work under the same accepted direction.
- If a future owner verdict changes the chosen family, promote that change into
  scene wiring deliberately.

## Risks and Acceptable Divergences

- Scene wiring currently depends on experiment classes and dirty workspace
  state. A selected engine must have its script and `.meta` tracked before it is
  treated as accepted.
- Some variants use reflection wrappers over earlier experiments. That is useful
  for fast evaluation but fragile as a production architecture.
- Progressive construction can conflict with camera/focus assumptions if selected
  stars are not materialized when `BuildGraph()` returns.
- Line density and visual effects can make an engine look strong when static but
  fail in moving-camera FPS.
- A 10K macro atlas may intentionally sacrifice local link readability; that is
  acceptable only if the owner accepts the view as a different mode, not as a
  failed force-map replacement.
- Source comments contain some unresolved contradictions, especially around
  `Engine_RecursiveHubs_v4`; journal entries should resolve those only after
  fresh evaluation.
- The accepted direction can still evolve within the RecursiveHubs family, but
  the medium-and-large-map choice itself is now settled.

## Verification Notes

Canonical Unity verification lives in `docs/VERIFICATION.md`.

For engine eval iterations, use this order:
1. Technical gate: project compiles.
2. Technical gate: relevant EditMode checks pass.
3. Technical gate: PlayMode bootstrap and engine preference checks pass when the
   scene or selected engine changes.
4. Objective evidence: record `BuildGraph()` time from logs, note count, graph
   scenario, visible edge budget, and whether the engine ticks after build.
5. Manual evidence: owner verdict on readability, star-map feel, camera motion,
   local links, cluster shape, tagless behavior, and large-map usefulness.

Metrics available now:
- Build time from existing `Debug.Log` output.
- Note count and selected engine from `Cartographer` log output.
- Some per-engine internal counters from existing logs.
- Manual FPS observations from Play Mode.

Missing or not yet standardized:
- Automated FPS capture.
- Automated camera-motion FPS capture.
- Automated screenshot side-by-side capture per candidate.
- A shared scenario runner that loads the same sample matrix for every engine.

## Recent Changes

- 2026-06-12: Recorded owner verdict that RecursiveHubs is the accepted
  medium-and-large-map direction. `Engine_RecursiveHubs_v6` is the current
  baseline in that family. Continue tuning within RecursiveHubs instead of
  comparing it against Barnes or macro candidates as the main line.
- 2026-06-11: Created the journal from current source comments and scene/docs
  inspection. No engine code or engine comments were changed.
