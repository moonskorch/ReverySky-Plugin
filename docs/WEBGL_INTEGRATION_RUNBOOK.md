# WebGL Integration Runbook

## Purpose
This runbook defines a reproducible workflow to generate runtime artifacts from committed source files and install the plugin into an Obsidian vault.

## Scope
- Source repository contains plugin source code, Unity project source, and runtime template.
- Generated runtime artifacts are local build outputs and are intentionally excluded from Git.

## Source and Generated Assets
Tracked source files:
- `src/*`
- `unity/ReverySkyMap/*` (Unity project source)
- `unity-webgl/index.template.html`
- `scripts/import-unity-webgl.ps1`

Generated local artifacts (not tracked):
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
- `main.js` (distribution artifact for Obsidian plugin installation).

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
- `unity-webgl\` (generated `index.html`, `Build`, optional `TemplateData`)

### 6) Verify runtime in Obsidian
1. Reload community plugins.
2. Run command: `Open ReverySky Map`.
3. Confirm the view opens and runtime initializes.

## Regeneration Rules
- Re-run Unity export + import script whenever Unity content changes.
- Re-run `npm run build` whenever TypeScript/plugin code changes.
- Do not commit generated runtime artifacts.

## External Visual Assets Note
- Some third-party visual source files are intentionally excluded from Git.
- Canonical list and restore instructions:
  - `unity/ReverySkyMap/Assets/README.txt`
- If local visual parity is required, restore those files locally before Unity verification/build.

## Troubleshooting
- If runtime fails to start, verify `unity-webgl/Build/` contains valid loader/framework/data/wasm files.
- If import fails, verify `-ExportRoot` points to a folder that contains `Build/`.
- If plugin view loads but Unity is missing, re-run Step 3 and ensure generated `unity-webgl/index.html` exists.
