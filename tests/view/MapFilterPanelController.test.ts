import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "../../src/bridge/BridgeTypes";
import { MapFilterPanelController } from "../../src/view/MapFilterPanelController";
import { MapSession } from "../../src/view/MapSession";

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
    enginePreference: "auto"
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
    buildGraph: vi.fn().mockReturnValue(makePathPayload()) as (app: never) => GraphPayload,
    now: () => 1700000000000,
    sendGraph: vi.fn(),
    sendFocus: vi.fn()
  });
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
    const container = document.createElement("div");
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.style.display).toBe("block");
    expect(suggestions.textContent).toContain("Search settings");

    searchInput.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(120);
    expect(suggestions.style.display).toBe("none");
  });

  it("clears query and hides suggestions on Escape", async () => {
    vi.useFakeTimers();

    const session = createSession();
    await session.setState({ pathFilterQuery: "tag:#project" });
    const controller = new MapFilterPanelController(session);
    const container = document.createElement("div");
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.style.display).toBe("block");

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(searchInput.value).toBe("");
    expect(session.getState()).toMatchObject({ pathFilterQuery: "" });
    expect(suggestions.style.display).toBe("none");
  });

  it("applies operator and value suggestions to the active query", () => {
    const session = createSession();
    const controller = new MapFilterPanelController(session);
    const container = document.createElement("div");
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
      enginePreference: "static25d"
    });

    const controller = new MapFilterPanelController(session);
    const container = document.createElement("div");
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const tagsToggle = container.querySelector(".reverysky-map-tags-toggle") as HTMLButtonElement;
    const engineSelect = container.querySelector(".reverysky-map-engine-select") as HTMLSelectElement;
    const message = container.querySelector(".reverysky-map-filter-message") as HTMLElement;

    expect(searchInput.value).toBe("tag:#project");
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");
    expect(engineSelect.value).toBe("static25d");
    expect(message.textContent).toBe("");
  });
});
