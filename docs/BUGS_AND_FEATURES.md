# Bugs and Features (Temporary Backlog)

Purpose:
- Keep newly discovered issues and ideas from getting lost before formal planning and decomposition.
- This is a fast-capture document and may be reorganized later.

## Bugs

1. Metadata-only updates for size/date do not auto-refresh graph.
   - Expected: changes that affect `size` or `date` should be reflected in runtime graph without requiring unrelated graph-significant edits.
   - Current state: refresh triggers are graph-significant (`tags`, `links`, `create/rename/delete`), so size/date-only updates can remain stale until next trigger.
   - Follow-up direction: add a controlled refresh/recalculation path for size/date-affecting updates without returning to full rebuild on every text edit.

2. Importance filter behavior is inconsistent and unclear.
   - Expected: deterministic and understandable filtering behavior.
   - Current state: results appear unreliable.

3. Input system technical debt warning (`Input Manager` deprecation).
   - Current state: Unity warns that legacy Input Manager is deprecated.
   - Impact: no immediate runtime break, but migration debt and potential future compatibility risk.
   - Follow-up direction: plan a dedicated migration task to `Input System` (or `Both`) with input regression checks.

4. Verify star model data source and mapping (especially `Id`). It shouldn't rely on frontmatter custom fields.
   - Expected: `Star` data fields are consistently populated from the intended runtime bridge source.
   - Current state: data origin/mapping path for `Star` fields (with focus on `Id`) must be validated.

5. Unity bridge contract drift: `graph:set` envelope version/type are not validated during ingestion.
   - Expected: runtime rejects envelope when `protocolVersion` mismatches or `type` is not `graph:set`, according to documented contract.
   - Current state: runtime maps payload without enforcing envelope-level `protocolVersion`/`type` checks, so mismatched envelope metadata can be accepted.
   - Follow-up direction: align Unity ingestion validation with `docs/DATA_CONTRACT.md` and `unity/ReverySkyMap/docs/DATA_CONTRACT.md`.

6. Repository baseline docs are incomplete (`README` and `LICENSE` are missing).
   - Expected: public repository has minimal onboarding and licensing files at root.
   - Current state: initial commit preparation still needs `README` and `LICENSE`.

## Features

1. Add folder-based filtering.
   - Note: do not remove existing folder-selection scaffolding from the project.

2. Add tag icons.
   - Note: old implementation via `SymbolRepository` was removed.
   - Follow-up direction: review reference project logic and selectively port only the relevant parts.

3. Determine crystal type and sphere material from user-selected properties (instead of static/random mapping). Or it could be some general properties: for example, number of links (direct + reversal) to color (from 0 as black to max limit as eternal).
   - Expected: visual mapping is configured by user-defined property bindings.
   - Current state: temporary behavior uses static/random fallback and needs replacement.
