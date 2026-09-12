# Manual Update Steps

## Purpose
This runbook defines manual checks for release-shaped Obsidian installs and updates.
Use it when validating `embedded-archive` packages in a real Obsidian desktop vault.

## Scope
- Release-shaped package files:
  - `main.js`
  - `manifest.json`
  - `styles.css`
- Current package mode: `embedded-archive`.
- Runtime cache path:
  - `<Vault>/.obsidian/plugins/reverysky-map/.reverysky-runtime/<plugin-version>/`

This runbook checks Obsidian plugin lifecycle behavior. It does not replace automated tests or GitHub Actions.

## Build Release-Shaped Files
From the repository root:

```powershell
npm.cmd run build
npm.cmd run check
```

Use the root `main.js`, `manifest.json`, and `styles.css` produced by the build.

## GitHub Installer Action
Use the separate installer workflow when you want the real-payload installer test to run on GitHub-hosted operating systems.

For manual validation after the workflow exists on `master`:

1. Push the commit you want to test.
2. Open GitHub -> Actions.
3. Select `Installer tests`.
4. Click `Run workflow`.
5. In `ref`, enter the branch, tag, or commit SHA to test.
6. Start the run.
7. Confirm all matrix jobs pass:
   - `ubuntu-latest`
   - `windows-latest`
   - `macos-latest`
   - `macos-15-intel`

The workflow runs:

```powershell
npm run build
npm run check
npm run test:installer
```

This checks a release-shaped build, the normal project checks, and the installer against the tracked real Unity WebGL payload on Linux, Windows, and macOS runners.

`test:installer` specifically verifies:
- the embedded archive input is present and passes the `embedded-archive` preflight;
- the real tracked Unity WebGL payload can be packed into a tar.gz archive;
- the installer extracts the real archive into the expected runtime cache;
- large WebGL binary payloads are written successfully;
- `.runtime-ready.json` contains the expected plugin version and archive hash;
- a second installer run reuses the valid cache without rewriting payload files;
- older runtime cache folders are removed after the current cache is valid;
- adapter paths stay vault-relative and use `/` separators on every OS.

This does not prove real Obsidian update behavior or Google Drive behavior; those still need the manual checks below.

## Clean Install Check
Use an empty or disposable vault.

1. Close any ReverySky graph views in the vault.
2. Create the plugin folder:
   - `<Vault>/.obsidian/plugins/reverysky-map/`
3. Copy only the release-shaped files into that folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. In Obsidian, open Settings -> Community plugins.
5. Reload or refresh the installed plugin list so Obsidian reads the copied `manifest.json`.
6. Confirm ReverySky is visible with the expected version.
7. Enable ReverySky.
8. Open the graph view.
9. Confirm the runtime cache exists:
   - `.reverysky-runtime/<plugin-version>/unity-webgl/`
10. Confirm the ready marker exists:
   - `.reverysky-runtime/<plugin-version>/.runtime-ready.json`
11. Confirm the marker contains the expected `pluginVersion` and `archiveSha256`.
12. Confirm the graph view loads without console errors.

## Update Check
Use a vault that already has an older ReverySky version installed and at least one extracted runtime cache folder.

1. Start Obsidian with the old plugin version installed.
2. Optionally open the graph view once to ensure the old runtime cache exists.
3. Disable ReverySky in Settings -> Community plugins.
4. Keep Obsidian open.
5. Replace only these files in `<Vault>/.obsidian/plugins/reverysky-map/`:
   - `main.js`
   - `manifest.json`
   - `styles.css`
6. Do not delete `.reverysky-runtime/`.
7. In Obsidian, reload or refresh the installed plugin list.
8. Confirm the plugin list now shows the new version from the copied `manifest.json`.
9. Enable ReverySky.
10. Open the graph view.
11. Confirm the new runtime cache exists:
    - `.reverysky-runtime/<new-plugin-version>/unity-webgl/`
12. Confirm the new ready marker exists and contains `<new-plugin-version>`.
13. Confirm the previous version cache folder is removed best-effort after the new cache is valid.
14. Confirm the graph view loads and the updated plugin behavior is visible.

## Important Update Notes
- Copying files over an enabled, running plugin is not a faithful Obsidian update simulation.
- Obsidian may keep old plugin metadata until the installed plugin list is refreshed.
- Refresh the installed plugin list before re-enabling the plugin; otherwise the new `main.js` can be present on disk while Obsidian still has stale manifest metadata.
- The old runtime cache is not a fallback for the new version. It is removed only after the current version cache is valid.
- If old cache cleanup fails because of a file lock or sync provider, the graph view should still work from the new cache.

## Google Drive Check
Repeat both clean install and update checks in a vault stored under Google Drive.

Watch specifically for:
- `DataAdapter.writeBinary` failures during first runtime extraction;
- validation failures after files were written;
- missing `.runtime-ready.json`;
- old cache folders that remain because DriveFS could not remove them immediately;
- graph view failures after a successful ready marker write.

Google Drive behavior is not fully proven by Node-based automated tests or GitHub Actions. A real DriveFS vault check is required before treating a release candidate as DriveFS-ready.

## Cold-Start Control Check
This is not the closest simulation of Obsidian update, but it is useful for isolating file-copy and manifest issues.

1. Close Obsidian completely.
2. Replace `main.js`, `manifest.json`, and `styles.css`.
3. Leave `.reverysky-runtime/` intact.
4. Start Obsidian.
5. Open the graph view.

Expected result is the same as the update check: the current version cache is prepared and older version caches are removed best-effort after success.
