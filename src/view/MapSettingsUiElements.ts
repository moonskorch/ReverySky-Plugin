import { setIcon } from "obsidian";

type ObsidianHTMLElement = HTMLElement & {
  createEl: <K extends keyof HTMLElementTagNameMap>(tagName: K) => HTMLElementTagNameMap[K];
};

export type CollapsibleSectionElements = {
  section: HTMLElement;
  header: HTMLElement;
  actions: HTMLElement;
  toggleButton: HTMLButtonElement;
  content: HTMLElement;
};

export type CollapsibleSectionOptions = {
  className: string;
  label: string;
  helpUrl?: string;
  onToggle: () => void;
};

export type ToggleControlElements = {
  row: HTMLElement;
  button: HTMLButtonElement;
};

export type ToggleControlOptions = {
  rowClassName: string;
  buttonClassName: string;
  thumbClassName: string;
  label: string;
  ariaLabel: string;
  onToggle: (event: Event) => void;
};

export type RangeControlElements = {
  section: HTMLElement;
  input: HTMLInputElement;
  value: HTMLElement;
  message: HTMLElement;
};

export type RangeControlOptions = {
  sectionClassName: string;
  inputClassName: string;
  valueClassName: string;
  messageClassName: string;
  label: string;
  ariaLabel: string;
  min: string;
  max: string;
  step: string;
  onInput: (input: HTMLInputElement) => void;
  onChange?: (input: HTMLInputElement) => void;
};

export type SelectControlElements = {
  section: HTMLElement;
  host: HTMLElement;
  select: HTMLSelectElement;
};

export type SelectControlOption = {
  value: string;
  label: string;
};

export type SelectControlOptions = {
  sectionClassName?: string;
  hostClassName?: string;
  selectClassName?: string;
  label: string;
  ariaLabel: string;
  options: ReadonlyArray<SelectControlOption>;
  onChange: (select: HTMLSelectElement) => void;
};

export type ActionButtonOptions = {
  className: string;
  label: string;
  ariaLabel: string;
  onClick: () => void;
};

export function createCollapsibleSection(
  parent: ObsidianHTMLElement,
  options: CollapsibleSectionOptions
): CollapsibleSectionElements {
  const section = createChild(parent, "div");
  section.className = `reverysky-map-settings-section ${options.className}`;

  const header = createChild(section as ObsidianHTMLElement, "div");
  header.className = "reverysky-map-settings-section-header";

  const toggleButton = createChild(header as ObsidianHTMLElement, "button");
  toggleButton.type = "button";
  toggleButton.className = "reverysky-map-settings-section-toggle";
  toggleButton.tabIndex = -1;

  const chevron = createChild(toggleButton as ObsidianHTMLElement, "span");
  chevron.className = "reverysky-map-settings-section-chevron";
  setIcon(chevron, "chevron-right");

  const title = createChild(toggleButton as ObsidianHTMLElement, "span");
  title.className = "reverysky-map-settings-section-title";
  title.textContent = options.label;

  registerSectionToggle(toggleButton, options.onToggle);
  const actions = createChild(header as ObsidianHTMLElement, "div");
  actions.className = "reverysky-map-settings-section-actions";
  if (options.helpUrl) {
    createSectionHelpLink(actions as ObsidianHTMLElement, options.label, options.helpUrl);
  }

  const content = createChild(section as ObsidianHTMLElement, "div");
  content.className = "reverysky-map-settings-section-content";

  return {
    section,
    header,
    actions,
    toggleButton,
    content
  };
}

export function createSelectControl(
  parent: ObsidianHTMLElement,
  options: SelectControlOptions
): SelectControlElements {
  const section = createChild(parent, "div");
  section.className = joinClassNames(
    "reverysky-map-settings-section",
    "reverysky-map-settings-control-group",
    "reverysky-map-select-control",
    options.sectionClassName
  );

  const label = createChild(section as ObsidianHTMLElement, "div");
  label.className = "reverysky-map-settings-field-label";
  label.textContent = options.label;

  const host = createChild(section as ObsidianHTMLElement, "div");
  host.className = joinClassNames(
    "reverysky-map-select-host",
    "reverysky-map-engine-select-host",
    options.hostClassName
  );

  const select = createChild(host as ObsidianHTMLElement, "select");
  select.className = joinClassNames(
    "reverysky-map-select",
    "reverysky-map-engine-select",
    options.selectClassName
  );
  select.setAttribute("aria-label", options.ariaLabel);

  for (const option of options.options) {
    const optionEl = createChild(select as ObsidianHTMLElement, "option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
  }

  select.addEventListener("change", () => {
    options.onChange(select);
  });

  return {
    section,
    host,
    select
  };
}

export function createToggleControl(
  parent: ObsidianHTMLElement,
  options: ToggleControlOptions
): ToggleControlElements {
  const row = createChild(parent, "div");
  row.className = `reverysky-map-toggle-row ${options.rowClassName}`;

  const label = createChild(row as ObsidianHTMLElement, "div");
  label.className = "reverysky-map-settings-field-label";
  label.textContent = options.label;

  const button = createChild(row as ObsidianHTMLElement, "button");
  button.type = "button";
  button.className = `reverysky-map-toggle ${options.buttonClassName}`;
  button.setAttribute("aria-label", options.ariaLabel);

  const thumb = createChild(button as ObsidianHTMLElement, "span");
  thumb.className = `reverysky-map-toggle-thumb ${options.thumbClassName}`;

  button.addEventListener("mousedown", options.onToggle);
  button.addEventListener("click", (event) => {
    if (event.detail !== 0) {
      return;
    }
    options.onToggle(event);
  });

  return { row, button };
}

export function createRangeControl(
  parent: ObsidianHTMLElement,
  options: RangeControlOptions
): RangeControlElements {
  const section = createChild(parent, "div");
  section.className =
    `reverysky-map-settings-section reverysky-map-settings-control-group reverysky-map-range-control ${options.sectionClassName}`;

  const header = createChild(section as ObsidianHTMLElement, "div");
  header.className = "reverysky-map-range-control-header reverysky-map-render-scale-header";

  const label = createChild(header as ObsidianHTMLElement, "div");
  label.className = "reverysky-map-settings-field-label";
  label.textContent = options.label;

  const value = createChild(header as ObsidianHTMLElement, "div");
  value.className = `reverysky-map-range-control-value ${options.valueClassName}`;

  const input = createChild(section as ObsidianHTMLElement, "input");
  input.type = "range";
  input.min = options.min;
  input.max = options.max;
  input.step = options.step;
  input.className = `reverysky-map-range-control-input ${options.inputClassName}`;
  input.setAttribute("aria-label", options.ariaLabel);
  input.addEventListener("input", () => {
    options.onInput(input);
  });
  input.addEventListener("change", () => {
    options.onChange?.(input);
  });

  const message = createChild(section as ObsidianHTMLElement, "div");
  message.className = `reverysky-map-range-control-message ${options.messageClassName}`;

  return {
    section,
    input,
    value,
    message
  };
}

export function createActionButton(
  parent: ObsidianHTMLElement,
  options: ActionButtonOptions
): HTMLButtonElement {
  const button = createChild(parent, "button");
  button.type = "button";
  button.className = joinClassNames("reverysky-map-action-button", options.className);
  button.textContent = options.label;
  button.setAttribute("aria-label", options.ariaLabel);
  button.addEventListener("click", options.onClick);
  return button;
}

function registerSectionToggle(button: HTMLButtonElement, toggle: () => void): void {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    toggle();
  });
  button.addEventListener("click", (event) => {
    if (event.detail !== 0) {
      return;
    }

    event.preventDefault();
    toggle();
  });
}

function createSectionHelpLink(
  parent: ObsidianHTMLElement,
  label: string,
  url: string
): HTMLAnchorElement {
  const link = createChild(parent, "a");
  const tooltip = `Open ${label} documentation`;
  link.className = "reverysky-map-settings-help-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", tooltip);
  link.setAttribute("title", tooltip);
  setIcon(link, "circle-help");
  return link;
}

function joinClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter((className): className is string => Boolean(className)).join(" ");
}

function createChild<K extends keyof HTMLElementTagNameMap>(
  element: ObsidianHTMLElement,
  tagName: K
): HTMLElementTagNameMap[K] {
  return element.createEl(tagName);
}
