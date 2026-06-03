---
name: ui-polish
description: Use for plugin-side UI styling, layout fixes, screenshot matching, and visual regressions in Obsidian.
---

# UI polish

Fix one visible UI defect per run.

## Goal

Reach the approved visual target with the smallest local patch and a bounded verification loop.

## Workflow

1. Identify the target element, current control type, relevant CSS, and closest existing project UI pattern.
2. Apply one smallest local patch.
3. Run relevant technical checks.
4. Run the visual check for the target state if a harness exists.
5. If the visual check fails, inspect the screenshot diff and apply the next smallest local repair.
6. Stop after at most three visual repair iterations.
7. Report the result and request one final owner smoke in Obsidian.

## Visual verification

Use the existing UI harness and visual test when available.

Run the narrowest relevant command, for example:

`npm run test:ui-visual -- engine-dropdown`

Do not update approved screenshot baselines merely to make the test pass.

If no visual harness exists for the target state:

* make at most one local patch;
* request one targeted owner screenshot or confirmation;
* do not stack speculative patches.

## Scope limits

UI polish may adjust:

* local CSS;
* existing style tokens;
* small local markup details required for styling.

Stop before editing if the solution would require:

* replacing the control type;
* creating a custom dropdown, popup, or listbox;
* adding persistent UI state;
* adding document-level event handlers;
* implementing keyboard navigation;
* broad markup restructuring;
* a substantial TypeScript expansion.

Report that the issue requires a separate UI-component task.

## Regression handling

If the owner says the UI previously looked correct:

1. inspect the current diff and recent relevant changes;
2. compare with the last-known-good implementation;
3. prefer the smallest restoration over redesign;
4. do not discard owner changes without explicit approval.

## Existing pattern rule

Reuse the existing DOM pattern or existing component where possible.

Copying only a CSS selector is insufficient when the source element and target element have different browser or Obsidian defaults.

## Output

Keep the report short:

### Changed

* files and brief summary

### Checks

* technical checks
* visual check result

### Owner smoke

* one concise confirmation request

### Escalation

* only when the issue requires a separate component task

