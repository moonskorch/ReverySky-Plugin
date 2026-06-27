import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { editorInfoField, type MarkdownFileInfo } from "obsidian";

export type MarkdownEditorFocusUpdate = Pick<ViewUpdate, "focusChanged" | "state" | "view">;

/**
 * CodeMirror update events are the reliable way to detect when a markdown editor gains focus.
 * DOM focus alone is too noisy for this case because it does not carry the current file path.
 */
export function handleMarkdownEditorFocusUpdate(
  update: MarkdownEditorFocusUpdate,
  onMarkdownFocus: (path: string) => void
): void {
  // Only a real focus gain should move map focus; selection and content updates are ignored.
  if (!update.focusChanged || !update.view.hasFocus) {
    return;
  }

  const path = getMarkdownEditorPath(update);
  if (!path) {
    return;
  }

  onMarkdownFocus(path);
}

export function createMarkdownEditorFocusExtension(
  onMarkdownFocus: (path: string) => void
): Extension {
  return EditorView.updateListener.of((update) => {
    handleMarkdownEditorFocusUpdate(update, onMarkdownFocus);
  });
}

function getMarkdownEditorPath(update: MarkdownEditorFocusUpdate): string | null {
  const info = update.state.field(editorInfoField, false) as MarkdownFileInfo | undefined;
  const path = info?.file?.path?.trim();

  if (!path || !path.toLowerCase().endsWith(".md")) {
    return null;
  }

  return path;
}
