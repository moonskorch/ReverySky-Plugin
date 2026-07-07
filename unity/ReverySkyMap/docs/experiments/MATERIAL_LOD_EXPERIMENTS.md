# Material LOD Experiments

Status: frozen
Last updated: 2026-07-07

## Theme

Star sphere material LOD experiments tested whether switching far Star spheres
to cheaper materials could improve FPS or large-map scaling without damaging the
ReverySky starfield look.

Related engine and layout experiments live in:
- `docs/experiments/ENGINE_EXPERIMENTS.md`
- `docs/experiments/SPACE_PRESERVATION_EXPERIMENTS.md`

## Goal

Check whether distance-based Star sphere material simplification is worth
continuing as a performance or large-map scaling direction.

## Trials

- Simple distant material with bloom:
  - Concept: switch far Star spheres from the rich near material to a simpler
    distant material while keeping a bright star-like look through emission and
    bloom.
  - Observation: the FPS became worse in large hub-heavy views. The simpler
    material moved cost into bloom/post-processing and, in early transparent
    versions, into transparent overdraw and sorting.
  - Result: rejected as a performance direction. A simpler-looking material is
    not useful if it shifts cost into a more expensive render path.
- Reduced rich shader complexity:
  - Concept: keep the rich material family but disable visually expensive-looking
    pieces such as distortion to see whether the existing shader is the frame
    bottleneck.
  - Observation: disabling distortion did not produce a visible FPS increase in
    manual Play Mode checks.
  - Result: no clear performance win. The Star sphere shader complexity is not
    currently proven to be the limiting cost.

## Owner Verdict

Freeze this material LOD line for now. Without an obvious FPS gain, the work
mostly adds tracking/switching complexity and makes distant stars look less
visually uniform.

Revisit only if profiler evidence later shows Star sphere shading or fill cost
as a real bottleneck. For now, prioritize simpler visuals and engine or
scene-level scaling work over material LOD tuning.
