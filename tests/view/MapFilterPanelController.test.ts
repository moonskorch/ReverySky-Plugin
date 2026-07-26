import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload, NoteFocusPayload } from "../../src/bridge/BridgeTypes";
import { MapFilterPanelController } from "../../src/view/MapFilterPanelController";
import { MapSession } from "../../src/view/MapSession";
import { makeBuildGraphMock, makeVoidCallback } from "./testUtils";

function makePathPayload(): GraphPayload {
  return {
    graphVersion: "0.0.1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    vault: { noteCount: 3 },
    notes: [
      {
        id: "daily",
        path: "Notes/Daily/2026-01-01.md",
        title: "Daily",
        tags: ["daily", "journal/daily"],
        size: 20
      },
      {
        id: "project",
        path: "Projects/ReverySky/Spec.md",
        title: "Spec",
        tags: ["work/subtag", "project"],
        size: 21
      },
      {
        id: "archive",
        path: "Archive/Old.md",
        title: "Old",
        tags: ["archive"],
        size: 22
      }
    ],
    links: [
      { sourceId: "daily", targetId: "project", kind: "resolved" },
      { sourceId: "project", targetId: "archive", kind: "resolved" }
    ],
    mapLayout: "auto"
  };
}

function createSession() {
  return new MapSession({
    app: {
      metadataCache: {
        on: vi.fn().mockReturnValue({ id: "metadata-event-ref" })
      },
      vault: {
        on: vi.fn().mockReturnValue({ id: "vault-event-ref" })
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: vi.fn().mockReturnValue([]),
        iterateAllLeaves: vi.fn(),
        on: vi.fn().mockReturnValue({ id: "event-ref" })
      }
    } as never,
    buildGraph: makeBuildGraphMock(makePathPayload()),
    now: () => 1700000000000,
    sendGraph: makeVoidCallback<[GraphPayload]>(),
    sendFocus: makeVoidCallback<[NoteFocusPayload]>()
  });
}

const SUGGESTIONS_HIDDEN_CLASS = "reverysky-map-filter-suggestions--hidden";

type ObsidianTestHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
};

function createObsidianTestContainer(): ObsidianTestHTMLElement {
  const container = document.createElement("div") as ObsidianTestHTMLElement;
  if (typeof container.createEl !== "function") {
    throw new Error("Obsidian createEl mock is not installed.");
  }
  return container;
}

describe("MapFilterPanelController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens suggestions on focus and hides them after blur delay", () => {
    vi.useFakeTimers();

    const session = createSession();
    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);
    expect(suggestions.textContent).toContain("Search settings");

    searchInput.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(120);
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(true);
  });

  it("clears query and hides suggestions on Escape", async () => {
    vi.useFakeTimers();

    const session = createSession();
    await session.setState({ pathFilterQuery: "tag:#project" });
    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(searchInput.value).toBe("");
    expect(session.getState()).toMatchObject({ pathFilterQuery: "" });
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(true);
  });

  it("applies operator and value suggestions to the active query", () => {
    const session = createSession();
    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const operatorOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    (operatorOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(searchInput.value).toBe("path:");

    controller.refreshSuggestions();
    const folderOptions = container.querySelectorAll(".reverysky-map-folder-suggestion-option");
    (folderOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(searchInput.value.startsWith("path:")).toBe(true);
    expect(searchInput.value).toContain("Archive");
  });

  it("syncs restored session state into the input, message, toggle, and dropdown", async () => {
    const session = createSession();
    await session.setState({
      pathFilterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates",
      renderScale: 1.2,
      frameRateMode: "fps60"
    });
    session.start(() => undefined);

    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const tagsToggle = container.querySelector(".reverysky-map-tags-toggle") as HTMLButtonElement;
    const engineSelect = container.querySelector(".reverysky-map-engine-select") as HTMLSelectElement;
    const frameRateModeSelect =
      container.querySelector(".reverysky-map-frame-rate-mode-select") as HTMLSelectElement;
    const renderScaleInput = container.querySelector(".reverysky-map-render-scale-input") as HTMLInputElement;
    const renderScaleValue = container.querySelector(".reverysky-map-render-scale-value") as HTMLElement;
    const renderScaleMessage = container.querySelector(".reverysky-map-render-scale-message") as HTMLElement;
    const message = container.querySelector(".reverysky-map-filter-message") as HTMLElement;

    expect(searchInput.value).toBe("tag:#project");
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");
    expect(engineSelect.value).toBe("dates");
    expect(frameRateModeSelect.value).toBe("fps60");
    expect(renderScaleInput.min).toBe("0.5");
    expect(renderScaleInput.max).toBe("1.5");
    expect(renderScaleInput.step).toBe("0.1");
    expect(renderScaleInput.value).toBe("1.2");
    expect(renderScaleValue.textContent).toBe("1.2x");
    expect(renderScaleMessage.textContent).toBe("");
    expect(container.textContent).toContain("Layout");
    expect(container.textContent).toContain("Frame rate");
    expect(message.textContent).toBe("");
  });

  it("updates frame-rate mode from the dropdown", () => {
    const session = createSession();
    session.start(() => undefined);
    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const frameRateModeSelect =
      container.querySelector(".reverysky-map-frame-rate-mode-select") as HTMLSelectElement;

    expect(frameRateModeSelect.value).toBe("auto");
    expect(frameRateModeSelect.textContent).toContain("Auto");
    expect(frameRateModeSelect.textContent).toContain("60 FPS");
    expect(frameRateModeSelect.textContent).toContain("30 FPS");
    expect(frameRateModeSelect.textContent).toContain("24 FPS");
    expect(frameRateModeSelect.textContent).not.toContain("fps60");

    frameRateModeSelect.value = "fps24";
    frameRateModeSelect.dispatchEvent(new Event("change"));

    expect(session.getState()).toMatchObject({ frameRateMode: "fps24" });
    expect(frameRateModeSelect.value).toBe("fps24");
  });

  it("updates render scale from the slider and shows reopen guidance", () => {
    const session = createSession();
    const persistRenderScale = vi.spyOn(session, "persistRenderScale");
    session.start(() => undefined);
    const controller = new MapFilterPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const renderScaleInput = container.querySelector(".reverysky-map-render-scale-input") as HTMLInputElement;
    const renderScaleValue = container.querySelector(".reverysky-map-render-scale-value") as HTMLElement;
    const renderScaleMessage = container.querySelector(".reverysky-map-render-scale-message") as HTMLElement;

    renderScaleInput.value = "1.3";
    renderScaleInput.dispatchEvent(new Event("input"));

    expect(session.getState()).toMatchObject({ renderScale: 1.3 });
    expect(persistRenderScale).not.toHaveBeenCalled();
    expect(renderScaleValue.textContent).toBe("1.3x");
    expect(renderScaleMessage.textContent).toBe("Reopen the graph view to apply.");
    expect(renderScaleMessage.classList.contains("reverysky-map-render-scale-message--hidden")).toBe(false);

    renderScaleInput.dispatchEvent(new Event("change"));

    expect(persistRenderScale).toHaveBeenCalledTimes(1);
  });
});
