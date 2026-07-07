# Space Preservation Experiments

Status: solution found
Last updated: 2026-07-07

## Theme

RecursiveHubs space-preservation experiments test ways to keep the spatial air
created by initial placement while preventing later link refinement from pulling
hub systems into unreadable knots.

Primary engine context: `Engine_RecursiveHubs_v6` remains the accepted
medium-and-large-map engine family baseline. The engine-level journal lives in
`docs/experiments/ENGINE_EXPERIMENTS.md`.

## Goal

Preserve physical node space around each visible center without turning the
layout into a rigid plate, long-stick graph, or continuously expensive force
simulation.

## Trials

- Complex orbital rewrite:
  - Concept: turn RecursiveHubs into an orbital layout where hubs reserve shells
    and link refinement cannot collapse those shells.
  - Technique: changed initial placement through `CalculatePreferredChildPosition`,
    changed rest-length behavior through `ResolveRestLength`, adjusted contraction
    strength, added radial shell clamping, and demoted separation to emergency
    fallback in one combined pass.
  - Result: rejected and reverted. Some very large hub cases improved, but
    smaller/live maps regressed with long sticks, crescent-like hub shells, dense
    unreadable local piles, and loss of the wider starfield feel.
- Degree-aware link weighting and contraction multipliers:
  - Concept: make high-degree or hub-like links pull less aggressively so link
    refinement does not drag a hub system into a knot.
  - Technique: experimented around `ResolveRestLength` and
    `ApplyLinkContractionCorrections`, including endpoint-degree/link-category
    scaling and exposed contraction multipliers.
  - Result: rejected as the main answer. The changes mostly affected convergence
    speed or target length, not true spacing. Low pull left unresolved long links;
    high pull returned toward collapse; the parameter surface became too noisy.
- First hard space control:
  - Concept: protect node space directly, regardless of graph links, so unrelated
    nodes cannot occupy the same visual area.
  - Technique: used a spatial-grid projection after refinement passes, with
    editor-facing controls for pass count, distance factor, and projection
    strength.
  - Result: rejected in that form. One pass could spread the outer mass while
    dense center overlaps remained, and more passes looked likely to raise the
    same cost concerns as continuous separation.
- Clean node spacing:
  - Concept: isolate the spacing idea from all hub/orbital/link changes and only
    enforce physical node space around each center.
  - Technique: added a spatial-grid projection after link contraction, with
    editor-facing controls for pass count, hard radius, air radius, one shared
    projection strength, close-neighbor budget, and per-node check cap. A pass
    count of 0 disables the constraint. It does not change initial placement,
    rest lengths, link weights, or hub role rules.
  - Result: current successful owner verdict. With the old separation pass
    removed, node spacing set to one pass, and hard/air radii tuned separately,
    live maps no longer show glued node piles, including link-saturated maps and
    single-hub cases.

## Recent Changes

- 2026-07-06: Added visual-only smoothing for RecursiveHubs timed link
  refinement. Baseline: accepted RecursiveHubs direction after the hard node
  spacing work. Hypothesis: move visual transforms toward existing calculated
  positions without changing layout math, then continue visual-only smoothing to
  exact sync after the final pass. Technical gates:
  `CartographerScalableLinksEngineEditModeTests` passed 18/18 through Unity MCP.
  Decision: keep evaluating manually for feel and FPS on large maps.
- 2026-07-06: Recorded owner verdict that the isolated hard node spacing
  constraint is a successful RecursiveHubs space-preservation step so far. The
  old separation pass was removed after the useful comparison showed hard node
  spacing should stand on its own.
