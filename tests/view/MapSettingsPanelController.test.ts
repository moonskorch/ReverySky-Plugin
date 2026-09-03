import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload, NoteFocusPayload } from "../../src/bridge/BridgeTypes";
import { MapSettingsPanelController } from "../../src/view/MapSettingsPanelController";
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

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect;
}

describe("MapSettingsPanelController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens suggestions on focus and hides them after blur delay", () => {
    vi.useFakeTimers();

    const session = createSession();
    const controller = new MapSettingsPanelController(session);
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

  it("uses unique suggestion list ids for separate controller instances", () => {
    const firstController = new MapSettingsPanelController(createSession());
    const secondController = new MapSettingsPanelController(createSession());
    const firstContainer = createObsidianTestContainer();
    const secondContainer = createObsidianTestContainer();
    firstController.render(firstContainer);
    secondController.render(secondContainer);

    const firstInput = firstContainer.querySelector("input.search-input") as HTMLInputElement;
    const secondInput = secondContainer.querySelector("input.search-input") as HTMLInputElement;
    firstInput.dispatchEvent(new Event("focus"));
    secondInput.dispatchEvent(new Event("focus"));

    const firstListbox = firstContainer.querySelector('[role="listbox"]') as HTMLElement;
    const secondListbox = secondContainer.querySelector('[role="listbox"]') as HTMLElement;

    expect(firstListbox.id).not.toBe(secondListbox.id);
    expect(firstInput.getAttribute("aria-controls")).toBe(firstListbox.id);
    expect(secondInput.getAttribute("aria-controls")).toBe(secondListbox.id);
  });

  it("renders suggestions outside the scrollable panel and positions them from the search area", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const root = container.querySelector(".reverysky-map-root") as HTMLElement;
    const panel = container.querySelector(".reverysky-map-settings-panel") as HTMLElement;
    const searchArea = container.querySelector(".reverysky-map-filter-search-area") as HTMLElement;
    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchArea.getBoundingClientRect = () => makeRect(24, 44, 280, 40);
    root.getBoundingClientRect = () => makeRect(14, 20, 320, 440);

    searchInput.dispatchEvent(new Event("focus"));

    expect(panel.contains(suggestions)).toBe(false);
    expect(root.contains(suggestions)).toBe(true);
    expect(suggestions.classList.contains("reverysky-map-filter-suggestions--overlay")).toBe(true);
    expect(suggestions.style.left).toBe("auto");
    expect(suggestions.style.right).toBe("30px");
    expect(suggestions.style.top).toBe("68px");
    expect(suggestions.style.width).toBe("");
    expect(suggestions.style.getPropertyValue("--reverysky-filter-suggestions-anchor-width")).toBe("280px");
    expect(suggestions.style.getPropertyValue("--reverysky-filter-suggestions-max-height")).toBe("364px");
  });

  it("filters every suggestion list to prefix matches while typing", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(container.querySelectorAll(".reverysky-map-filter-suggestion-option")).toHaveLength(3);

    searchInput.value = "pa";
    searchInput.dispatchEvent(new Event("input"));
    expect(container.querySelectorAll(".reverysky-map-filter-suggestion-option")).toHaveLength(1);
    const pathOperatorOption = container.querySelector(".reverysky-map-filter-suggestion-option") as HTMLElement;
    expect(pathOperatorOption.textContent).toContain("path:");
    pathOperatorOption.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(searchInput.value).toBe("path:");

    searchInput.value = "path:Pr";
    searchInput.dispatchEvent(new Event("input"));
    const folderOptions = Array.from(container.querySelectorAll(".reverysky-map-folder-suggestion-option"));
    expect(folderOptions.length).toBeGreaterThan(0);
    expect(folderOptions.every((option) => option.textContent?.toLowerCase().startsWith("projects"))).toBe(true);

    searchInput.value = "path: Pr";
    searchInput.dispatchEvent(new Event("input"));
    const spacedFolderOptions = Array.from(container.querySelectorAll(".reverysky-map-folder-suggestion-option"));
    expect(spacedFolderOptions.length).toBeGreaterThan(0);
    expect(spacedFolderOptions.every((option) => option.textContent?.toLowerCase().startsWith("projects"))).toBe(true);

    searchInput.value = "path:";
    searchInput.dispatchEvent(new Event("input"));
    expect(container.textContent).toContain("Folders");
    expect(container.querySelectorAll(".reverysky-map-folder-suggestion-option").length).toBeGreaterThan(0);

    searchInput.value = "tag:#wo";
    searchInput.dispatchEvent(new Event("input"));
    const tagOptions = Array.from(container.querySelectorAll(".reverysky-map-tag-suggestion-option"));
    expect(tagOptions).toHaveLength(1);
    expect(tagOptions[0]?.textContent).toBe("#work/subtag");

    searchInput.value = "date:to";
    searchInput.dispatchEvent(new Event("input"));
    const dateOptions = Array.from(container.querySelectorAll(".reverysky-map-date-suggestion-option"));
    expect(dateOptions).toHaveLength(1);
    expect(dateOptions[0]?.textContent).toContain("today");
    expect(container.textContent).not.toContain("one week ago");

    searchInput.value = "tag:#work pa";
    searchInput.dispatchEvent(new Event("input"));
    expect(container.querySelectorAll(".reverysky-map-filter-suggestion-option")).toHaveLength(1);
    expect(container.querySelector(".reverysky-map-filter-suggestion-option")?.textContent).toContain("path:");
  });

  it("replaces typed root prefixes when applying operator suggestions", () => {
    const expectRootPrefixReplacement = (prefix: string, expectedValue: string) => {
      const session = createSession();
      const controller = new MapSettingsPanelController(session);
      const container = createObsidianTestContainer();
      controller.render(container);

      const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
      searchInput.dispatchEvent(new Event("focus"));
      searchInput.value = prefix;
      searchInput.dispatchEvent(new Event("input"));

      const option = container.querySelector(".reverysky-map-filter-suggestion-option") as HTMLElement;
      expect(option.textContent).toContain(expectedValue);
      option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      expect(searchInput.value).toBe(expectedValue);
      expect(session.getState()).toMatchObject({ filterQuery: expectedValue });
    };

    expectRootPrefixReplacement("pa", "path:");
    expectRootPrefixReplacement("da", "date:");
    expectRootPrefixReplacement("ta", "tag:");
  });

  it("returns to root suggestions when the active query ends with a trailing space", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));
    searchInput.value = "tag:#work ";
    searchInput.dispatchEvent(new Event("input"));

    expect(container.textContent).toContain("Search settings");
    expect(container.querySelectorAll(".reverysky-map-filter-suggestion-option")).toHaveLength(3);
    expect(container.querySelectorAll(".reverysky-map-tag-suggestion-option")).toHaveLength(0);
  });

  it("filters date presets by the active trailing date term in mixed queries", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "path:Projects date:to";
    searchInput.dispatchEvent(new Event("input"));

    const dateOptions = Array.from(container.querySelectorAll(".reverysky-map-date-suggestion-option"));
    expect(container.textContent).toContain("Date presets");
    expect(dateOptions).toHaveLength(1);
    expect(dateOptions[0]?.textContent).toContain("today");
    expect(container.textContent).not.toContain("one week ago");
  });

  it("highlights the first root suggestion on open and moves with arrow keys", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
    const rootOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    expect(rootOptions).toHaveLength(3);
    expect(searchInput.getAttribute("role")).toBe("combobox");
    expect(searchInput.getAttribute("aria-haspopup")).toBe("listbox");
    expect(searchInput.getAttribute("aria-autocomplete")).toBe("list");
    expect(searchInput.getAttribute("aria-controls")).toBe(listbox.id);
    expect(searchInput.getAttribute("aria-expanded")).toBe("true");
    expect(suggestions.hasAttribute("role")).toBe(false);
    expect(listbox.getAttribute("role")).toBe("listbox");
    expect(listbox.contains(rootOptions[0])).toBe(true);
    expect(rootOptions[0].getAttribute("role")).toBe("option");
    expect(rootOptions[0].getAttribute("aria-selected")).toBe("true");
    expect(rootOptions[1].getAttribute("aria-selected")).toBe("false");
    expect(searchInput.getAttribute("aria-activedescendant")).toBe((rootOptions[0] as HTMLElement).id);
    expect(rootOptions[0].classList.contains("reverysky-map-filter-suggestion-option--active")).toBe(true);
    expect(rootOptions[1].classList.contains("reverysky-map-filter-suggestion-option--active")).toBe(false);

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(rootOptions[0].classList.contains("reverysky-map-filter-suggestion-option--active")).toBe(false);
    expect(rootOptions[1].classList.contains("reverysky-map-filter-suggestion-option--active")).toBe(true);
    expect(rootOptions[0].getAttribute("aria-selected")).toBe("false");
    expect(rootOptions[1].getAttribute("aria-selected")).toBe("true");
    expect(searchInput.getAttribute("aria-activedescendant")).toBe((rootOptions[1] as HTMLElement).id);
  });

  it("opens hidden suggestions from arrow keys", () => {
    const createOpenController = () => {
      const session = createSession();
      const controller = new MapSettingsPanelController(session);
      const container = createObsidianTestContainer();
      controller.render(container);

      const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
      const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
      searchInput.dispatchEvent(new Event("focus"));
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(true);

      return { container, searchInput, suggestions };
    };

    const downCase = createOpenController();
    downCase.searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const downOptions = downCase.container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    expect(downCase.suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);
    expect(downOptions[0].getAttribute("aria-selected")).toBe("true");
    expect(downCase.searchInput.getAttribute("aria-activedescendant")).toBe((downOptions[0] as HTMLElement).id);

    const upCase = createOpenController();
    upCase.searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const upOptions = upCase.container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    expect(upCase.suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);
    expect(upOptions[upOptions.length - 1].getAttribute("aria-selected")).toBe("true");
    expect(upCase.searchInput.getAttribute("aria-activedescendant")).toBe(
      (upOptions[upOptions.length - 1] as HTMLElement).id
    );
  });

  it("keeps empty hints outside options and clears active descendant for empty suggestion lists", () => {
    const expectEmptyState = (query: string, hint: string) => {
      const session = createSession();
      const controller = new MapSettingsPanelController(session);
      const container = createObsidianTestContainer();
      controller.render(container);

      const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
      searchInput.dispatchEvent(new Event("focus"));
      expect(searchInput.hasAttribute("aria-activedescendant")).toBe(true);

      searchInput.value = query;
      searchInput.dispatchEvent(new Event("input"));

      const listbox = container.querySelector('[role="listbox"]') as HTMLElement;
      const emptyHint = container.querySelector(".reverysky-map-suggestion-empty") as HTMLElement;
      expect(emptyHint.textContent).toBe(hint);
      expect(emptyHint.getAttribute("role")).not.toBe("option");
      expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(0);
      expect(searchInput.hasAttribute("aria-activedescendant")).toBe(false);
    };

    expectEmptyState("zz", "No matches found");
    expectEmptyState("path:NoSuchFolder", "No folders found");
    expectEmptyState("tag:#nosuchtag", "No tags found");
    expectEmptyState("date:never", "No presets found");
  });

  it("highlights the first item in each second-level suggestion list", () => {
    const expectFirstItemActive = (operatorIndex: number, selector: string) => {
      const session = createSession();
      const controller = new MapSettingsPanelController(session);
      const container = createObsidianTestContainer();
      controller.render(container);

      const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
      searchInput.dispatchEvent(new Event("focus"));

      const rootOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
      (rootOptions[operatorIndex] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const options = container.querySelectorAll(selector);
      expect(options.length).toBeGreaterThan(0);
      expect(options[0].classList.contains("reverysky-map-filter-suggestion-option--active")).toBe(true);
    };

    expectFirstItemActive(0, ".reverysky-map-folder-suggestion-option");
    expectFirstItemActive(1, ".reverysky-map-date-suggestion-option");
    expectFirstItemActive(2, ".reverysky-map-tag-suggestion-option");
  });

  it("hides open suggestions before clearing query and reopening root suggestions on Escape", async () => {
    vi.useFakeTimers();

    const session = createSession();
    await session.setState({ filterQuery: "tag:#project" });
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;

    searchInput.dispatchEvent(new Event("focus"));
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(searchInput.value).toBe("tag:#project");
    expect(session.getState()).toMatchObject({ filterQuery: "tag:#project" });
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(true);
    expect(searchInput.getAttribute("aria-expanded")).toBe("false");
    expect(searchInput.hasAttribute("aria-activedescendant")).toBe(false);

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(searchInput.value).toBe("");
    expect(session.getState()).toMatchObject({ filterQuery: "" });
    expect(suggestions.classList.contains(SUGGESTIONS_HIDDEN_CLASS)).toBe(false);
    expect(searchInput.getAttribute("aria-expanded")).toBe("true");
    expect(searchInput.hasAttribute("aria-activedescendant")).toBe(true);
    expect(suggestions.textContent).toContain("Search settings");
  });

  it("applies operator and value suggestions to the active query", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
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
    expect(searchInput.value).toBe("path:Archive ");
    expect(searchInput.value).toContain("Archive");
  });

  it("applies path value suggestions after operator separator whitespace", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.value = "path: ";
    searchInput.dispatchEvent(new Event("input"));

    const folderOptions = container.querySelectorAll(".reverysky-map-folder-suggestion-option");
    expect(folderOptions.length).toBeGreaterThan(0);
    (folderOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(searchInput.value).toBe("path:Archive ");
    expect(session.getState()).toMatchObject({ filterQuery: "path:Archive " });
  });

  it("keeps the WebGL host stable while navigating long suggestion lists", () => {
    const session = createSession();
    vi.spyOn(session, "getFolderSuggestions").mockReturnValue(
      Array.from({ length: 14 }, (_value, index) => ({
        path: `Long/Folder-${String(index + 1).padStart(2, "0")}`,
        normalizedPath: `long/folder-${String(index + 1).padStart(2, "0")}`,
        count: 1,
        depth: 2
      }))
    );

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value() {
        throw new Error("Filter suggestions must not scroll ancestor containers.");
      }
    });

    try {
      const container = createObsidianTestContainer();
      const controller = new MapSettingsPanelController(session);
      const iframeHost = controller.render(container);

      const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
      searchInput.dispatchEvent(new Event("focus"));

      const operatorOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
      (operatorOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const root = container.querySelector(".reverysky-map-root") as HTMLElement;
      const settingsPanel = container.querySelector(".reverysky-map-settings-panel") as HTMLElement;
      const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
      const folderOptions = Array.from(
        container.querySelectorAll<HTMLElement>(".reverysky-map-folder-suggestion-option")
      );
      let containerScrollTop = 0;
      let rootScrollTop = 0;
      let iframeHostTop = 12;
      let suggestionsScrollTop = 0;
      let settingsPanelScrollTop = 0;
      iframeHost.getBoundingClientRect = () => makeRect(0, iframeHostTop, 640, 360);
      const iframeHostRectBefore = iframeHost.getBoundingClientRect();

      Object.defineProperty(suggestions, "clientHeight", {
        configurable: true,
        value: 60
      });
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get: () => containerScrollTop,
        set: (value: number) => {
          containerScrollTop = value;
          iframeHostTop -= value;
        }
      });
      Object.defineProperty(root, "scrollTop", {
        configurable: true,
        get: () => rootScrollTop,
        set: (value: number) => {
          rootScrollTop = value;
          iframeHostTop -= value;
        }
      });
      Object.defineProperty(suggestions, "scrollTop", {
        configurable: true,
        get: () => suggestionsScrollTop,
        set: (value: number) => {
          suggestionsScrollTop = value;
        }
      });
      Object.defineProperty(settingsPanel, "scrollTop", {
        configurable: true,
        get: () => settingsPanelScrollTop,
        set: (value: number) => {
          settingsPanelScrollTop = value;
        }
      });
      folderOptions.forEach((option, index) => {
        Object.defineProperty(option, "offsetTop", {
          configurable: true,
          value: index * 24
        });
        Object.defineProperty(option, "offsetHeight", {
          configurable: true,
          value: 24
        });
      });

      for (let index = 0; index < 3; index += 1) {
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      }

      expect(folderOptions[3]?.getAttribute("aria-selected")).toBe("true");
      expect(suggestionsScrollTop).toBe(36);
      expect(settingsPanelScrollTop).toBe(0);
      expect(rootScrollTop).toBe(0);
      expect(containerScrollTop).toBe(0);
      expect(iframeHost.getBoundingClientRect()).toMatchObject({
        top: iframeHostRectBefore.top,
        left: iframeHostRectBefore.left,
        width: iframeHostRectBefore.width,
        height: iframeHostRectBefore.height
      });
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView
      });
    }
  });

  it("returns to the root suggestion pane after selecting a second-level item with Enter", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const operatorOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    (operatorOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const rootOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    expect(rootOptions).toHaveLength(3);
    expect(container.querySelectorAll(".reverysky-map-folder-suggestion-option")).toHaveLength(0);
    expect(container.textContent).toContain("Search settings");
    expect(searchInput.value.startsWith("path:")).toBe(true);
  });

  it("redraws suggestions once when moving between filter levels", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    searchInput.dispatchEvent(new Event("focus"));

    const suggestions = container.querySelector(".reverysky-map-filter-suggestions") as HTMLElement;
    const redrawSpy = vi.spyOn(suggestions, "replaceChildren");
    const operatorOptions = container.querySelectorAll(".reverysky-map-filter-suggestion-option");
    (operatorOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(redrawSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Folders");

    redrawSpy.mockClear();
    const folderOptions = container.querySelectorAll(".reverysky-map-folder-suggestion-option");
    (folderOptions[0] as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(redrawSpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Search settings");
  });

  it("syncs restored session state into the input, message, toggle, and dropdown", async () => {
    const session = createSession();
    await session.setState({
      filterQuery: "tag:#project",
      showTags: false,
      mapLayout: "dates",
      renderScale: 1.2,
      frameRateMode: "fps60",
      egoEnabled: true,
      egoDepth: 4,
      egoNeighborLinksEnabled: true
    });
    session.start(() => undefined);

    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const searchInput = container.querySelector("input.search-input") as HTMLInputElement;
    const tagsToggle = container.querySelector(".reverysky-map-tags-toggle") as HTMLButtonElement;
    const engineSelect = container.querySelector(".reverysky-map-engine-select") as HTMLSelectElement;
    const frameRateModeSelect =
      container.querySelector(".reverysky-map-frame-rate-mode-select") as HTMLSelectElement;
    const egoModeToggle = container.querySelector(".reverysky-map-ego-toggle") as HTMLButtonElement;
    const egoDepthInput = container.querySelector(".reverysky-map-ego-depth-input") as HTMLInputElement;
    const egoDepthValue = container.querySelector(".reverysky-map-ego-depth-value") as HTMLElement;
    const neighborLinksToggle = container.querySelector(
      ".reverysky-map-ego-neighbor-links-toggle"
    ) as HTMLButtonElement;
    const renderScaleInput = container.querySelector(".reverysky-map-render-scale-input") as HTMLInputElement;
    const renderScaleValue = container.querySelector(".reverysky-map-render-scale-value") as HTMLElement;
    const renderScaleMessage = container.querySelector(".reverysky-map-render-scale-message") as HTMLElement;
    const message = container.querySelector(".reverysky-map-filter-message") as HTMLElement;

    expect(searchInput.value).toBe("tag:#project");
    expect(tagsToggle.getAttribute("aria-checked")).toBe("false");
    expect(engineSelect.value).toBe("dates");
    expect(frameRateModeSelect.value).toBe("fps60");
    expect(egoModeToggle.getAttribute("aria-checked")).toBe("true");
    expect(egoDepthInput.value).toBe("4");
    expect(egoDepthValue.textContent).toBe("4");
    expect(neighborLinksToggle.getAttribute("aria-checked")).toBe("true");
    expect(renderScaleInput.min).toBe("0.5");
    expect(renderScaleInput.max).toBe("1.5");
    expect(renderScaleInput.step).toBe("0.1");
    expect(renderScaleInput.value).toBe("1.2");
    expect(renderScaleValue.textContent).toBe("1.2x");
    expect(renderScaleMessage.textContent).toBe("");
    expect(container.textContent).toContain("Selection");
    expect(container.textContent).not.toContain("Settings");
    expect(container.textContent).toContain("Layout");
    expect(container.textContent).toContain("Ego Graph");
    expect(container.textContent).toContain("Graphics");
    expect(container.textContent).toContain("Frame rate");
    const graphicsSection = container.querySelector(".reverysky-map-graphics-section") as HTMLElement;
    expect(graphicsSection.textContent).toContain("Render scale");
    expect(graphicsSection.textContent).toContain("Frame rate");
    expect(message.textContent).toBe("");
  });

  it("renders the ego section collapsed before graphics with default controls", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const settingsBody = container.querySelector(".reverysky-map-settings-panel-body") as HTMLElement;
    const egoSection = container.querySelector(".reverysky-map-ego-section") as HTMLElement;
    const graphicsSection = container.querySelector(".reverysky-map-graphics-section") as HTMLElement;
    const egoToggle = egoSection.querySelector(".reverysky-map-settings-section-toggle") as HTMLButtonElement;
    const egoContent = egoSection.querySelector(".reverysky-map-settings-section-content") as HTMLElement;
    const egoModeToggle = egoSection.querySelector(".reverysky-map-ego-toggle") as HTMLButtonElement;
    const egoDepthInput = egoSection.querySelector(".reverysky-map-ego-depth-input") as HTMLInputElement;
    const egoDepthValue = egoSection.querySelector(".reverysky-map-ego-depth-value") as HTMLElement;
    const neighborLinksToggle = egoSection.querySelector(
      ".reverysky-map-ego-neighbor-links-toggle"
    ) as HTMLButtonElement;

    expect(settingsBody.children[1]).toBe(egoSection);
    expect(settingsBody.children[2]).toBe(graphicsSection);
    expect(egoSection.textContent).toContain("Ego Graph");
    expect(egoSection.textContent).toContain("Depth");
    expect(egoSection.textContent).toContain("Neighbor links");
    expect(egoSection.classList.contains("reverysky-map-settings-section--collapsed")).toBe(true);
    expect(egoToggle.getAttribute("aria-expanded")).toBe("false");
    expect(egoContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(true);
    expect(egoModeToggle.getAttribute("aria-checked")).toBe("false");
    expect(egoDepthInput.min).toBe("1");
    expect(egoDepthInput.max).toBe("5");
    expect(egoDepthInput.step).toBe("1");
    expect(egoDepthInput.value).toBe("1");
    expect(egoDepthValue.textContent).toBe("1");
    expect(neighborLinksToggle.getAttribute("aria-checked")).toBe("false");
  });

  it("renders help links for documented sections", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const selectionActions = container.querySelector(
      ".reverysky-map-selection-section .reverysky-map-settings-section-actions"
    ) as HTMLElement;
    const selectionHelpLink = container.querySelector(
      ".reverysky-map-selection-section .reverysky-map-settings-help-link"
    ) as HTMLAnchorElement;
    const closeButton = container.querySelector(".reverysky-map-settings-close") as HTMLButtonElement;
    const egoHelpLink = container.querySelector(
      ".reverysky-map-ego-section .reverysky-map-settings-help-link"
    ) as HTMLAnchorElement;
    const graphicsHelpLink = container.querySelector(
      ".reverysky-map-graphics-section .reverysky-map-settings-help-link"
    ) as HTMLAnchorElement;
    const screenshotHelpLink = container.querySelector(
      ".reverysky-map-screenshot-section .reverysky-map-settings-help-link"
    ) as HTMLAnchorElement;

    expect(selectionActions.children[0]).toBe(selectionHelpLink);
    expect(selectionActions.children[1]).toBe(closeButton);
    expect(selectionHelpLink.href).toBe("https://github.com/moonskorch/ReverySky-Plugin#filter");
    expect(egoHelpLink.href).toBe("https://github.com/moonskorch/ReverySky-Plugin#ego-graph");
    expect(graphicsHelpLink.href).toBe("https://github.com/moonskorch/ReverySky-Plugin#visual-quality");
    expect(screenshotHelpLink.href).toBe("https://github.com/moonskorch/ReverySky-Plugin#screenshot");
    expect(selectionHelpLink.target).toBe("_blank");
    expect(selectionHelpLink.rel).toBe("noopener noreferrer");
    expect(selectionHelpLink.getAttribute("aria-label")).toBe("Open Selection documentation");
    expect(selectionHelpLink.getAttribute("title")).toBe("Open Selection documentation");
  });

  it("updates ego section controls in session state", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const egoSection = container.querySelector(".reverysky-map-ego-section") as HTMLElement;
    const egoModeToggle = egoSection.querySelector(".reverysky-map-ego-toggle") as HTMLButtonElement;
    const egoDepthInput = egoSection.querySelector(".reverysky-map-ego-depth-input") as HTMLInputElement;
    const egoDepthValue = egoSection.querySelector(".reverysky-map-ego-depth-value") as HTMLElement;
    const neighborLinksToggle = egoSection.querySelector(
      ".reverysky-map-ego-neighbor-links-toggle"
    ) as HTMLButtonElement;

    egoModeToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    egoDepthInput.value = "4";
    egoDepthInput.dispatchEvent(new Event("input"));
    neighborLinksToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(egoModeToggle.getAttribute("aria-checked")).toBe("true");
    expect(egoDepthInput.value).toBe("4");
    expect(egoDepthValue.textContent).toBe("4");
    expect(neighborLinksToggle.getAttribute("aria-checked")).toBe("true");
    expect(session.getState()).toMatchObject({
      filterQuery: "",
      showTags: true,
      mapLayout: "auto",
      egoEnabled: true,
      egoDepth: 4,
      egoNeighborLinksEnabled: true
    });
  });

  it("renders a screenshot section with a collapse toggle and copy action", () => {
    const session = createSession();
    const onCopyScreenshotRequested = vi.fn();
    const controller = new MapSettingsPanelController(session, {
      onCopyScreenshotRequested
    });
    const container = createObsidianTestContainer();
    controller.render(container);

    const settingsPanel = container.querySelector(".reverysky-map-settings-panel") as HTMLElement;
    const settingsBody = container.querySelector(".reverysky-map-settings-panel-body") as HTMLElement;
    const screenshotSection = container.querySelector(".reverysky-map-screenshot-section") as HTMLElement;
    const screenshotTitle = screenshotSection.querySelector(".reverysky-map-settings-section-title");
    const screenshotToggle = screenshotSection.querySelector(".reverysky-map-settings-section-toggle");
    const screenshotButton = container.querySelector(".reverysky-map-screenshot-button") as HTMLButtonElement;

    expect(settingsPanel.lastElementChild).toBe(settingsBody);
    expect(settingsBody.lastElementChild).toBe(screenshotSection);
    expect(screenshotTitle?.textContent).toBe("Screenshot");
    expect(screenshotToggle).not.toBeNull();
    expect(screenshotSection.textContent).toContain("Copy screenshot");

    screenshotButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onCopyScreenshotRequested).toHaveBeenCalledTimes(1);
  });

  it("updates frame-rate mode from the dropdown", () => {
    const session = createSession();
    session.start(() => undefined);
    const controller = new MapSettingsPanelController(session);
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

  it("opens with collapsed sections and preserves section state across panel reopen", () => {
    const session = createSession();
    const controller = new MapSettingsPanelController(session);
    const container = createObsidianTestContainer();
    controller.render(container);

    const settingsPanelToggle = container.querySelector(".reverysky-map-settings-toggle") as HTMLButtonElement;
    const panel = container.querySelector(".reverysky-map-settings-panel") as HTMLElement;
    const settingsToggle = container.querySelector(
      '.reverysky-map-selection-section .reverysky-map-settings-section-toggle'
    ) as HTMLButtonElement;
    const graphicsToggle = container.querySelector(
      '.reverysky-map-graphics-section .reverysky-map-settings-section-toggle'
    ) as HTMLButtonElement;
    const egoToggle = container.querySelector(
      '.reverysky-map-ego-section .reverysky-map-settings-section-toggle'
    ) as HTMLButtonElement;
    const settingsContent = container.querySelector(
      ".reverysky-map-selection-section .reverysky-map-settings-section-content"
    ) as HTMLElement;
    const egoContent = container.querySelector(
      ".reverysky-map-ego-section .reverysky-map-settings-section-content"
    ) as HTMLElement;
    const graphicsContent = container.querySelector(
      ".reverysky-map-graphics-section .reverysky-map-settings-section-content"
    ) as HTMLElement;
    const closeButton = container.querySelector(".reverysky-map-settings-close") as HTMLButtonElement;

    settingsPanelToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(settingsToggle.tabIndex).toBe(-1);
    expect(egoToggle.tabIndex).toBe(-1);
    expect(graphicsToggle.tabIndex).toBe(-1);
    expect(settingsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(egoToggle.getAttribute("aria-expanded")).toBe("false");
    expect(graphicsToggle.getAttribute("aria-expanded")).toBe("false");
    expect(settingsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(true);
    expect(egoContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(true);
    expect(graphicsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(true);

    settingsToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    egoToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    graphicsToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(settingsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(egoToggle.getAttribute("aria-expanded")).toBe("true");
    expect(graphicsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(settingsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);
    expect(egoContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);
    expect(graphicsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);

    closeButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(panel.classList.contains("reverysky-map-settings-panel--closed")).toBe(true);
    expect(settingsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(egoToggle.getAttribute("aria-expanded")).toBe("true");

    settingsPanelToggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(settingsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(egoToggle.getAttribute("aria-expanded")).toBe("true");
    expect(graphicsToggle.getAttribute("aria-expanded")).toBe("true");
    expect(settingsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);
    expect(egoContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);
    expect(graphicsContent.classList.contains("reverysky-map-settings-section-content--collapsed")).toBe(false);
  });

  it("updates render scale from the slider and shows reopen guidance", () => {
    const session = createSession();
    const persistRenderScale = vi.spyOn(session, "persistRenderScale");
    session.start(() => undefined);
    const controller = new MapSettingsPanelController(session);
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
