# WebGL Integration Runbook

## Purpose
This runbook defines a reproducible workflow to generate runtime artifacts from committed source files, build package candidates, and install the plugin into an Obsidian vault.

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

## Build Algorithm

Use these steps for every package mode. Steps 1-3 prepare the shared Unity runtime staging folder. Step 4 chooses the final package shape.

Current default release candidate is the `embedded-archive` mode. Use `npm.cmd run build` and `npm.cmd run check` as its shortcuts.

### 1) Install JavaScript dependencies
From repository root, if dependencies are not already installed:

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

### 3) Import Unity export into `unity-webgl/`
From repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-unity-webgl.ps1 -ExportRoot "C:\Temp\ReverySkyWebGLExport"
```

This prepares the generated runtime staging folder used by every package mode.

### 4) Choose and build one package mode
Use exactly one build command:

- `folder-runtime`
  - Use for: local/manual Obsidian install.
  - Build command: `npm.cmd run package:folder-runtime`
  - Install files: `main.js`, `manifest.json`, `styles.css`, `unity-webgl\`

- `embedded-html`
  - Use for: release-shaped HTML embedding check.
  - Build command: `npm.cmd run package:embedded-html`
  - Release assets: `main.js`, `manifest.json`, `styles.css`

- `embedded-archive`
  - Use for: current default release candidate.
  - Build command: `npm.cmd run build`
  - Direct mode command: `npm.cmd run package:embedded-archive`
  - Release assets: `main.js`, `manifest.json`, `styles.css`

Notes:
- `npm.cmd run build` currently calls `package:release-candidate`, which currently calls `package:embedded-archive`.
- `folder-runtime` keeps `unity-webgl/` as a folder beside `main.js`.
- Embedded modes package the prepared `unity-webgl/` runtime into `main.js`; do not upload `unity-webgl/` for embedded releases.
- `manifest.json` and `styles.css` are static root release files. The generated output is `main.js`.

### 5) Verify the chosen package
Use the matching check command:

Default release-candidate shortcut: `npm.cmd run check` validates the current `embedded-archive` candidate and runs `npm.cmd run test`.

- `folder-runtime`
  - `npm.cmd run check:package:folder-runtime`
  - `npm.cmd run test`

- `embedded-html`
  - `npm.cmd run check:package:embedded-html`
  - `npm.cmd run check:release-metadata`
  - `npm.cmd run test`

- `embedded-archive`
  - Shortcut: `npm.cmd run check`
  - Direct checks: `npm.cmd run check:package:embedded-archive`, `npm.cmd run check:release-metadata`, and `npm.cmd run test`

Optional archive size check for embedded archive:

```powershell
npm.cmd run measure:embedded-archive
```

### 6) Install or upload the built package
For embedded release-shaped packages, verify root `main.js` starts with the expected package mode marker, for example:

```js
/* ReverySky package mode: embedded-archive */
```

Upload these root files as release assets:
- `main.js`
- `manifest.json`
- `styles.css`

For a local folder-runtime install, copy files to:

`<Vault>\.obsidian\plugins\reverysky-map\`

Folder-runtime install files:
- `manifest.json`
- `main.js`
- `styles.css`
- `unity-webgl\` (generated `index.html`, `Build`, optional `TemplateData`)

Local Obsidian smoke check:
1. Reload community plugins.
2. Run command: `Open map`.
3. Confirm the view opens and runtime initializes.

Detailed package mode reference lives in `docs/PACKAGING_MODES.md`.

## Regeneration Rules
- Re-run Unity export + import script before packaging whenever Unity content changes.
- Re-run the selected build command whenever TypeScript/plugin code changes.
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
