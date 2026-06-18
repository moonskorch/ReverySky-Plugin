# Packaging Modes

ReverySky currently supports three first-class package modes. Each mode writes the active generated plugin bundle to root `main.js`.

Before uploading release assets, open root `main.js` and verify its first line:

```js
/* ReverySky package mode: folder-runtime */
```

```js
/* ReverySky package mode: embedded-html */
```

```js
/* ReverySky package mode: embedded-archive */
```

## Shared Rules

- `main.js` is generated and ignored by Git.
- `unity-webgl/` is generated/imported and ignored by Git.
- Root `manifest.json` and `styles.css` are the release/source files.
- Root `manifest.json` version must match the GitHub release tag used for Obsidian dashboard testing.
- `dist/` may contain temporary reports or intermediate artifacts, but it is not the primary release output location.

## folder-runtime

Purpose:
- Local/manual development install.

Build command:

```powershell
npm.cmd run package:folder-runtime
```

Required install files:
- `main.js`
- `manifest.json`
- `styles.css`
- `unity-webgl/`

Behavior:
- Builds root `main.js`.
- Requires local `unity-webgl/`.
- Does not embed Unity runtime payloads into `main.js`.
- Runtime resolves the local `unity-webgl/` folder and serves it through the loopback server.

Observed result:
- Works well for manual/local Obsidian plugin installs.

Verification:

```powershell
npm.cmd run check:package:folder-runtime
```

## embedded-html

Purpose:
- Obsidian release-shaped package candidate.

Build command:

```powershell
npm.cmd run package:embedded-html
```

Release assets:
- `main.js`
- `manifest.json`
- `styles.css`

Behavior:
- Builds root `main.js`.
- Embeds the generated Unity WebGL HTML/runtime payload into `main.js`.
- Does not require `unity-webgl/` in the release assets.
- Runtime serves embedded `index.html` from memory.

Observed result:
- Strongly increases Obsidian startup time, so it is not the preferred release candidate right now.

Verification:

```powershell
npm.cmd run check:package:embedded-html
```

## embedded-archive

Purpose:
- Obsidian release-shaped package candidate.
- Current preferred Obsidian dashboard scan candidate.

Build command:

```powershell
npm.cmd run package:embedded-archive
```

Release assets:
- `main.js`
- `manifest.json`
- `styles.css`

Behavior:
- Builds root `main.js`.
- Embeds a compressed Unity runtime archive into `main.js`.
- Does not require `unity-webgl/` in the release assets.
- On first map open, extracts runtime files into a versioned local cache.
- Later map opens reuse the validated cache when the plugin version and archive SHA match.
- Runtime extraction imports only `tar/list` and `tar/extract`; production bundling compiles out `tar` test-only env override reads so the release bundle does not read those `process.env` keys.

Observed result:
- Obsidian starts quickly; the startup-time difference is barely noticeable in manual smoke testing.
- This is the current release candidate for Obsidian dashboard testing.

Verification:

```powershell
npm.cmd run check:package:embedded-archive
```

Release candidate verification:

```powershell
npm.cmd run check:package:release-candidate
```

This currently runs the `embedded-archive` package check and `check:release-metadata`. The package check validates the root release assets, first-line marker, embedded archive payload, and archive SHA function. The metadata check validates `manifest.json`, `package.json`, and `versions.json` consistency.

Size measurement:

```powershell
npm.cmd run measure:embedded-archive
```

## Release Candidate Shortcut

Go-to commands:

```powershell
npm.cmd run build
npm.cmd run check
```

For now, `build` calls:

```powershell
npm.cmd run package:release-candidate
```

`package:release-candidate` calls:

```powershell
npm.cmd run package:embedded-archive
```
