import { describe, expect, it } from "vitest";
import { WHATS_NEW_VIEW_TYPE, WhatsNewView } from "../../src/view/WhatsNewView";

describe("WhatsNewView", () => {
  it("renders passed Markdown in an Obsidian preview container", async () => {
    const view = new WhatsNewView({ app: { name: "obsidian-test-app" } } as never);

    await view.setState({
      version: "1.4.1",
      markdown: "# ReverySky\n\n- New tab\n",
      sourcePath: "whats-new/1.4.1.md"
    }, {} as never);

    expect(view.getViewType()).toBe(WHATS_NEW_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("What's New");
    expect(view.getIcon()).toBe("sparkles");
    expect(view.contentEl.classList.contains("reverysky-whats-new-view")).toBe(true);
    expect(view.contentEl.querySelector(".markdown-preview-view")?.textContent).toBe("# ReverySky\n\n- New tab\n");
    expect(view.contentEl.querySelector(".markdown-preview-view")?.getAttribute("data-source-path")).toBe("whats-new/1.4.1.md");
  });

  it("tolerates empty restored state", async () => {
    const view = new WhatsNewView({ app: { name: "obsidian-test-app" } } as never);

    await view.setState(null, {} as never);

    expect(view.contentEl.classList.contains("reverysky-whats-new-view")).toBe(true);
    expect(view.contentEl.querySelector(".markdown-preview-view")?.textContent).toBe("");
  });
});
