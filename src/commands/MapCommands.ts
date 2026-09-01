import type { TFile, WorkspaceLeaf } from "obsidian";
import { MAP_VIEW_TYPE, MapView } from "../view/MapView";
import type ReverySkyMapPlugin from "../main";

export function registerCommands(plugin: ReverySkyMapPlugin): void {
  plugin.addRibbonIcon("sparkles", "Toggle ReverySky 3D Graph", async () => {
    await toggleMapView(plugin);
  });

  plugin.addCommand({
    id: "open-map",
    name: "Open",
    callback: async () => {
      await activateMapView(plugin);
    }
  });

  plugin.addCommand({
    id: "close-map",
    name: "Close",
    callback: async () => {
      await closeMapView(plugin);
    }
  });

  plugin.addCommand({
    id: "copy-screenshot",
    name: "Copy screenshot",
    callback: async () => {
      await copyActiveMapViewScreenshot(plugin);
    }
  });
}

export function registerEditorMenuCommands(plugin: ReverySkyMapPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, info) => {
      const landmark = normalizeLandmarkSelection(editor.getSelection());
      const file = info.file;
      if (!file || !landmark) {
        return;
      }

      menu.addItem((item) => {
        item
          .setTitle("Add landmark")
          .setIcon("map-pin")
          .onClick(async () => {
            await addLandmarkToFile(plugin, file, landmark);
          });
      });
    })
  );
}

export function normalizeLandmarkSelection(selection: string): string {
  return selection
    .replace(/\s+/g, " ")
    .trim();
}

export function addLandmarkToFrontmatter(frontmatter: Record<string, unknown>, landmark: string): void {
  const currentLandmarks = frontmatter.landmarks;
  if (currentLandmarks === null || currentLandmarks === undefined) {
    frontmatter.landmarks = [landmark];
    return;
  }

  if (
    !Array.isArray(currentLandmarks) ||
    !currentLandmarks.every((currentLandmark) => typeof currentLandmark === "string")
  ) {
    return;
  }

  const hasDuplicate = currentLandmarks.some(
    (currentLandmark) =>
      typeof currentLandmark === "string" &&
      normalizeLandmarkSelection(currentLandmark) === landmark
  );
  if (!hasDuplicate) {
    currentLandmarks.push(landmark);
  }
}

export async function activateMapView(plugin: ReverySkyMapPlugin): Promise<void> {
  const { workspace } = plugin.app;
  let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(MAP_VIEW_TYPE)[0] ?? null;

  if (!leaf) {
    leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: MAP_VIEW_TYPE,
      active: true
    });
  }

  await workspace.revealLeaf(leaf);
}

export async function closeMapView(plugin: ReverySkyMapPlugin): Promise<boolean> {
  const { workspace } = plugin.app;
  const leaves = workspace.getLeavesOfType(MAP_VIEW_TYPE);

  if (leaves.length > 0) {
    await plugin.flushPersistedMapViewState();
    workspace.detachLeavesOfType(MAP_VIEW_TYPE);
    return true;
  }

  return false;
}

export async function toggleMapView(plugin: ReverySkyMapPlugin): Promise<void> {
  if (await closeMapView(plugin)) {
    return;
  }

  await activateMapView(plugin);
}

export async function copyActiveMapViewScreenshot(plugin: ReverySkyMapPlugin): Promise<void> {
  const activeView = getActiveMapView(plugin);
  if (!activeView) {
    return;
  }

  await activeView.copyRuntimeScreenshotToClipboard();
}

export function forwardFocusToViews(plugin: ReverySkyMapPlugin, path: string): void {
  const leaves = plugin.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);

  for (const leaf of leaves) {
    (leaf.view as MapView | undefined)?.requestFocusFromEditor(path);
  }
}

function getActiveMapView(plugin: ReverySkyMapPlugin): MapView | null {
  const { workspace } = plugin.app;
  const activeView = workspace.getActiveViewOfType(MapView);
  if (activeView) {
    return activeView;
  }

  return (workspace.getLeavesOfType(MAP_VIEW_TYPE)[0]?.view as MapView | undefined) ?? null;
}

async function addLandmarkToFile(
  plugin: ReverySkyMapPlugin,
  file: TFile,
  landmark: string
): Promise<void> {
  await plugin.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    addLandmarkToFrontmatter(frontmatter, landmark);
  });
}
