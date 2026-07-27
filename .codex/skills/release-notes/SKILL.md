---
name: release-notes
description: Create concise release notes and changelog entries for repository releases by comparing master against the latest release tag or version bump. Use when asked to draft patch notes, changelog text, or a user-friendly summary of what changed in a release.
---

# Release notes

Generate short, user-facing release notes from the changes on `master` since the last release.

## Workflow

1. Find the latest release baseline.
   - Prefer the newest semver git tag that matches the release line.
   - If tags are missing or unclear, use the last commit that bumped `manifest.json`, `package.json`, or `versions.json`.
2. Compare `master` to that baseline.
   - Read commit titles, merge titles, and diff summaries.
   - Use the diff only as evidence for what a user would notice.
3. Keep only user-visible changes.
   - Merge technical commits into plain-language bullets.
   - Drop internal refactors, build plumbing, and dependency noise unless they change the user experience.
4. Write the notes in the repo's release style.

## Output format

Match this pattern:

```md
# ReverySky 3D Graph 1.3.5

## Changed

- Updated dependencies.
```

## Writing rules

- Use the real product name and the actual release version.
- Keep the list short and readable for non-technical users.
- Avoid marketing language, hype, praise, or exaggerated claims.
- Prefer `## Changed` as the default section.
- Use `## Added`, `## Fixed`, or `## Removed` only when they make the user impact clearer.
- Write bullets in plain language.
- Avoid file names, commit hashes, internal subsystem names, and implementation details.
- Do not invent changes that are not supported by git history or release metadata.
- If the release has no user-visible changes, say that plainly in one short bullet.
