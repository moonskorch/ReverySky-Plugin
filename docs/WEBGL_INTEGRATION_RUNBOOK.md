# WebGL Integration Runbook

## Purpose
This runbook defines a reproducible workflow to generate runtime artifacts from committed source files and install the plugin into an Obsidian vault.

## Scope
- Source repository contains plugin source code, Unity project source, and runtime template.
- Generated outputs are local build artifacts.

## Source and Generated Outputs
Tracked source files:
- `src/*`
- `unity/ReverySkyMap/*` (Unity project source)
- `unity-webgl/index.template.html`
- `scripts/import-unity-webgl.ps1`

Generated local artifacts:
- `unity-webgl/index.html`
- `unity-webgl/Build/*`
- `unity-webgl/TemplateData/*`

## Prerequisites
- Windows environment with PowerShell.
- Node.js and npm available on PATH.
- Unity Editor matching project version:
  - `6000.3.8f1` (from `unity/ReverySkyMap/ProjectSettings/ProjectVersion.txt`).
- Obsidian desktop.

## Full Workflow (Clean Clone -> Running Plugin)

### 1) Install JavaScript dependencies
From repository root:

```cmd
npm install
```

### 2) Build Unity WebGL export
In Unity Editor:
1. Open project folder: `unity/ReverySkyMap`.
2. Switch active platform to WebGL.
3. Disable WebGL build compression:
   - `Edit -> Project Settings -> Player -> WebGL -> Publishing Settings`
   - `Compression Format: Disabled`
4. Build to a separate export directory, for example:
   - `C:\Temp\ReverySkyWebGLExport`
5. Confirm export output contains:
   - `C:\Temp\ReverySkyWebGLExport\Build\*`
   - `C:\Temp\ReverySkyWebGLExport\TemplateData\*` (optional)

### 3) Import Unity export into local runtime folder
From repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-unity-webgl.ps1 -ExportRoot "C:\Temp\ReverySkyWebGLExport"
```

Script output behavior:
1. Copies `Build/*` into `unity-webgl/Build/`.
2. Copies `TemplateData/*` when present.
3. Detects runtime files (`loader`, `framework`, `data`, `wasm`).
4. Regenerates `unity-webgl/Build/build-config.json` and `build-config.js`.
5. Generates `unity-webgl/index.html` from `unity-webgl/index.template.html`.

### 4) Build Obsidian plugin bundle
From repository root:

```cmd
npm run build
```

Output:
- `main.js` (generated plugin bundle).
- `styles.css` (plugin UI styles; must be present in installed plugin folder).

If PowerShell blocks npm wrapper:

```cmd
npm.cmd run build
```

### 5) Install plugin into Obsidian vault
Plugin ID from `manifest.json` is `reverysky-map`.
Copy files to:

`<Vault>\.obsidian\plugins\reverysky-map\`

Copy these artifacts:
- `manifest.json`
- `main.js`
- `styles.css`
- `unity-webgl\` (generated `index.html`, `Build`, optional `TemplateData`)

### 6) Verify runtime in Obsidian
1. Reload community plugins.
2. Run command: `Open ReverySky Map`.
3. Confirm the view opens and runtime initializes.

## Packaging Modes

The detailed mode reference lives in `docs/PACKAGING_MODES.md`.

Build the local folder-runtime install shape from repository root:

```powershell
npm.cmd run package:folder-runtime
```

Output:
- `main.js`
- `manifest.json`
- `styles.css`
- `unity-webgl/`

Build an embedded HTML release-shaped package:

```powershell
npm.cmd run package:embedded-html
```

Release assets:
- `main.js`
- `manifest.json`
- `styles.css`

Build an embedded archive release-shaped package:

```powershell
npm.cmd run package:embedded-archive
```

Release assets:
- `main.js`
- `manifest.json`
- `styles.css`

The embedded modes do not require `unity-webgl/` in release assets. Before uploading release assets, open root `main.js` and confirm the first-line package mode marker.

## Release Candidate Preparation

Use this checklist when preparing GitHub release assets for Obsidian dashboard testing.

Current release candidate mode:
- `embedded-archive`

Before packaging:
1. Confirm root `manifest.json` version matches the GitHub release tag you plan to upload.
2. Confirm `versions.json` maps the same manifest version to `manifest.json.minAppVersion`.
3. Re-run the Unity export/import flow above if Unity runtime content changed.

Build the current release candidate:

```powershell
npm.cmd run package:release-candidate
```

Run release-candidate checks:

```powershell
npm.cmd run check:package:release-candidate
npm.cmd run test
```

Optional archive size check:

```powershell
npm.cmd run measure:embedded-archive
```

Before upload, verify root `main.js` starts with:

```js
/* ReverySky package mode: embedded-archive */
```

Upload these root files as release assets:
- `main.js`
- `manifest.json`
- `styles.css`

Do not upload `unity-webgl/` for the `embedded-archive` release candidate. The runtime archive is embedded into `main.js` and extracted into a versioned local cache on first map open.

## Regeneration Rules
- Re-run Unity export + import script whenever Unity content changes.
- Re-run `npm run build` whenever TypeScript/plugin code changes.
- Do not commit generated outputs.

## External Visual Assets Note
- Some third-party visual source files are intentionally excluded from Git.
- Canonical list and restore instructions:
  - `unity/ReverySkyMap/Assets/README.txt`
- If local visual parity is required, restore those files locally before Unity verification/build.

## Troubleshooting
- If runtime fails to start, verify `unity-webgl/Build/` contains valid loader/framework/data/wasm files.
- If import fails, verify `-ExportRoot` points to a folder that contains `Build/`.
- If plugin view loads but Unity is missing, re-run Step 3 and ensure generated `unity-webgl/index.html` exists.
