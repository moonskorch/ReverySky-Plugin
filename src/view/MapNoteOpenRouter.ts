import type { App } from "obsidian";
import type { NoteOpenPayload } from "../bridge/BridgeTypes";
import { MapSession } from "./MapSession";

/**
 * Resolves runtime note-open requests into Obsidian leaf selection and `openLinkText` calls.
 */
export class MapNoteOpenRouter {
  constructor(
    private readonly app: App,
    private readonly session: MapSession,
    private readonly notify: (message: string) => void
  ) {}

  async openRequestedNote(payload: NoteOpenPayload): Promise<void> {
    const resolvedPath = this.session.resolveRequestedPath(payload);
    if (!resolvedPath) {
      this.notify("Unable to open note: bridge payload did not include a valid note id or path.");
      return;
    }

    const noteFile = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!noteFile || typeof (noteFile as { path?: unknown }).path !== "string") {
      this.notify(`Unable to open note: file not found for path '${resolvedPath}'.`);
      return;
    }

    const targetLeaf = this.session.resolveTargetMarkdownLeaf();
    const sourcePath = targetLeaf ? this.session.getLeafSourcePath(targetLeaf) : "";
    try {
      await this.app.workspace.openLinkText(
        noteFile.path,
        sourcePath,
        false,
        targetLeaf
          ? {
              active: true,
              group: targetLeaf
            }
          : {
              active: true
            }
      );
    } catch (error) {
      this.notify(`Unable to open note: ${String(error)}`);
    }
  }
}
