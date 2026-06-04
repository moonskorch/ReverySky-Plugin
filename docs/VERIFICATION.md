# Verification Guide

Use this guide to choose relevant checks for each task.

## General rule

Final report format is canonical in `AGENTS.md`.
This file defines only verification policy and check selection.

Verification order:
1. Run relevant automated checks first.
2. Run manual checks for behavior and integration confirmation.

Policy:
- For every non-documentation task, automated verification is required.
- Manual checks complement automated checks and do not replace them.
- If no suitable automated check exists for changed behavior, add a minimal targeted check when feasible; if not feasible in-task, report the gap and required follow-up.

## Current automated checks in this repository

Core commands:
- `npm run build` - TypeScript compile check + production bundle build (`esbuild`).
- `npm run test` - Vitest single-run suite for TS baseline tests.
- `npm run test:watch` - Vitest watch mode for local iteration.
- `npm run test:ui-visual` - Playwright visual regression run for `tests/visual`.
- `npm run test:ui-visual:update` - refresh screenshot baselines when the UI change is intentional.
- `npm run test:ui-visual:report` - open the latest Playwright report.

Current TS baseline test suites:
- `tests/bridge/MessageValidator.test.ts`
  - validates valid payload path;
  - validates invalid payload path (date, noteCount mismatch, invalid weight, empty required fields);
  - validates protocol mismatch rejection for incoming `bridge:ready`.
- `tests/graph/GraphNormalizer.test.ts`
  - validates path normalization (`\` -> `/`);
  - validates tag normalization (trim + `#` removal);
  - validates empty tag removal and deduplication.
- `tests/bridge/UnityIframeBridge.test.ts`
  - validates outgoing `graph:set` dispatch for valid payload;
  - validates error path for invalid payload without dispatch;
  - validates `bridge:ready` handling for attached iframe source only;
  - validates ignoring foreign source messages and listener cleanup on `detach()`.
- `tests/view/ReverySkyMapView.test.ts`
  - validates iframe creation and bridge attach on `onOpen`;
  - validates handshake flow `bridge:ready` -> graph build -> `graph:set`;
  - validates `detach()` and container cleanup on `onClose`.

Current visual regression suites:
- `tests/visual/engine-dropdown.spec.ts`
  - validates the engine dropdown focused state in the preview harness.
- `tests/visual/tags-toggle-off.spec.ts`
  - validates the tags toggle off state in the preview harness.

## Documentation-only changes

Automated checks are usually not required.

Manual checks:
- Review changed docs.
- Confirm links and step order.
- Confirm no project-specific facts were removed.

## TypeScript plugin changes

Required automated checks:
- `npm run build`
- `npm run test`

Additional automated checks when available:
- targeted Vitest runs (by file or name filter) for touched modules
- Playwright visual regression runs (`npm run test:ui-visual`) for touched rendered UI, styles, or screenshot baselines.

Manual checks:
- Load plugin in Obsidian dev vault.
- Open ReverySky Map view.
- Check developer console.

## Graph/data changes

Required automated checks:
- `npm run build`

Strongly expected automated tests (add or run when available):
- VaultGraphBuilder
- GraphNormalizer
- MessageValidator
- bridge transport and handshake flow (`UnityIframeBridge`, `ReverySkyMapView`)

Manual checks:
- Use small vault with known notes and links.
- Confirm node/link counts and ids.

## Unity runtime changes

Required automated checks (at least one relevant Unity check):
- Unity EditMode tests for affected runtime code, when available
- Unity PlayMode smoke tests for target scene/runtime path, when available

Manual checks:
- Open Unity project.
- Open target scene.
- Enter Play mode.
- Confirm no missing scripts or runtime errors.

## Obsidian <-> Unity integration

Required checks when relevant:
- plugin build;
- targeted or full automated tests for touched TS/Unity areas, when available;
- Unity/WebGL build if runtime changed;
- Playwright visual regression runs if the plugin-facing UI or rendered bridge state changed;
- manual end-to-end smoke check in Obsidian.

Manual smoke check:
1. Open test vault.
2. Open ReverySky Map view.
3. Confirm Unity/WebGL runtime loads.
4. Confirm bridge:ready.
5. Confirm graph:set reaches runtime.
6. Confirm graph appears.
7. Check console for errors.

## Bridge and cross-layer contract changes

When a task changes data or behavior across a subsystem boundary, verify the complete path rather than only the edited side.

For plugin <-> Unity bridge changes, review as applicable:

* producer sends the expected payload;
* types and validation match the payload;
* canonical and mirrored contract docs are updated;
* consumer reads and applies the new value;
* the requested behavior works end-to-end, or the remaining stage is explicitly reported as deferred.

A build or passing plugin-side tests do not prove completion of a cross-layer feature.

If the consumer is intentionally left unchanged, classify the result as a preparatory patch and state that the feature is not yet functional end-to-end.

## Cleanup / deletion

For execution mode, batching, and repair loop, follow `docs/AGENT_WORKFLOW.md`.
Use this verification loop:
1. Remove only approved batch.
2. Run automated checks (build, compile, tests) after each batch.
3. Run manual smoke-check.
4. Stop if any check fails.
