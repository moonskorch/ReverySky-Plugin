# Bugs and Features (Temporary Backlog)

Purpose:
- Keep newly discovered issues and ideas from getting lost before formal planning and decomposition.
- This is a fast-capture document and may be reorganized later.

## Bugs

1. Metadata-only updates for size/date do not auto-refresh graph.
   - Expected: changes that affect `size` or `date` should be reflected in runtime graph without requiring unrelated graph-significant edits.
   - Current state: refresh triggers are graph-significant (`tags`, `links`, `create/rename/delete`), so size/date-only updates can remain stale until next trigger.
   - Follow-up direction: add a controlled refresh/recalculation path for size/date-affecting updates without returning to full rebuild on every text edit.

2. Input system technical debt warning (`Input Manager` deprecation).
   - Current state: Unity warns that legacy Input Manager is deprecated.
   - Impact: no immediate runtime break, but migration debt and potential future compatibility risk.
   - Follow-up direction: plan a dedicated migration task to `Input System` (or `Both`) with input regression checks.

3. Repository baseline docs are incomplete (`README` is still only a starter).
    - Expected: public repository has minimal onboarding docs that explain install, run, and build.
    - Current state: `LICENSE.md` is present, but `README.md` still needs proper project-oriented content instead of a thin placeholder.

## Features

1. Add tag icons.
    - Note: old implementation via `SymbolRepository` was removed.
    - Follow-up direction: review reference project logic and selectively port only the relevant parts.

2. Determine crystal type and sphere material from user-selected properties (instead of static/random mapping). Or it could be some general properties: for example, number of links (direct + reversal) to color (from 0 as black to max limit as eternal).
    - Expected: visual mapping is configured by user-defined property bindings.
    - Current state: temporary behavior uses static/random fallback and needs replacement.

3. Optimize engine-only switching across the bridge.
    - Expected: changing only the preferred engine should not require resending the full `graph:set` payload with all notes and links.
    - Current state: plugin-side engine filter updates reuse cached source graph, but still redispatch the entire effective graph payload when only `enginePreference` changes.
    - Follow-up direction: consider a lightweight bridge message such as `engine:set` (or similar) so engine-only changes can trigger runtime rebuild without retransmitting the full graph payload.

4. Expand filter parameters to better match native Obsidian Graph behavior.
    - Expected: the filter UI can grow beyond `path:`, `date:`, and `tag:` with additional operator-style parameters similar to native Graph affordances.
    - Current state: the plugin-side filter pipeline already owns filtering, so new parameters can be added without moving ownership into Unity.
    - Follow-up direction: add operators incrementally, starting with the highest-value native-style parameters such as `file:`, `line:`, `section:`, and `[property]`.

5. Release zip packaging should include `LICENSE.md` and the relevant third-party notices.
    - Follow-up direction: define the minimal public release bundle so the downloadable zip carries the root MIT license and the Unity-side notices needed for redistributed assets.
