import { describe, expect, it, vi } from "vitest";
import {
  handleMarkdownEditorFocusUpdate,
  type MarkdownEditorFocusUpdate
} from "../../src/view/MarkdownEditorFocus";

function createUpdate(options: {
  focusChanged: boolean;
  hasFocus: boolean;
  filePath?: string | null;
}): MarkdownEditorFocusUpdate {
  return {
    focusChanged: options.focusChanged,
    view: {
      hasFocus: options.hasFocus
    },
    state: {
      field: vi.fn().mockReturnValue(
        options.filePath === undefined
          ? undefined
          : {
              file: options.filePath === null ? null : { path: options.filePath }
            }
      )
    }
  } as never;
}

describe("MarkdownEditorFocus", () => {
  it("requests focus only when the editor gains focus", () => {
    const onMarkdownFocus = vi.fn();

    handleMarkdownEditorFocusUpdate(
      createUpdate({
        focusChanged: true,
        hasFocus: true,
        filePath: "Notes/A.md"
      }),
      onMarkdownFocus
    );

    expect(onMarkdownFocus).toHaveBeenCalledWith("Notes/A.md");
  });

  it("ignores doc or selection updates without focus change", () => {
    const onMarkdownFocus = vi.fn();

    handleMarkdownEditorFocusUpdate(
      createUpdate({
        focusChanged: false,
        hasFocus: true,
        filePath: "Notes/A.md"
      }),
      onMarkdownFocus
    );

    expect(onMarkdownFocus).not.toHaveBeenCalled();
  });

  it("ignores updates when the editor is blurred", () => {
    const onMarkdownFocus = vi.fn();

    handleMarkdownEditorFocusUpdate(
      createUpdate({
        focusChanged: true,
        hasFocus: false,
        filePath: "Notes/A.md"
      }),
      onMarkdownFocus
    );

    expect(onMarkdownFocus).not.toHaveBeenCalled();
  });

  it("ignores missing or non-markdown files", () => {
    const onMarkdownFocus = vi.fn();

    handleMarkdownEditorFocusUpdate(
      createUpdate({
        focusChanged: true,
        hasFocus: true,
        filePath: null
      }),
      onMarkdownFocus
    );
    handleMarkdownEditorFocusUpdate(
      createUpdate({
        focusChanged: true,
        hasFocus: true,
        filePath: "Notes/A.txt"
      }),
      onMarkdownFocus
    );

    expect(onMarkdownFocus).not.toHaveBeenCalled();
  });
});
