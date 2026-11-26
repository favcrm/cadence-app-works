// Ported from cloudflare-os libraries/ui/src/toolbar.ts
// Uses inline SVG checkmarks instead of CSS url(data:...) to comply with bundle rules.

import { el, icon } from "./dom";
import { ICONS } from "./icons";

export type ClickHandler = (event: MouseEvent) => void;

function toolButton(
  className: string,
  paths: string | null,
  title: string,
  onClick: ClickHandler,
  label?: string,
): HTMLButtonElement {
  const button = el("button", {
    class: className,
    type: "button",
    title,
    "aria-label": title,
  });
  if (label !== undefined) button.textContent = label;
  else if (paths !== null) button.innerHTML = icon(paths);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);
  return button;
}

export function iconBtn(
  paths: string | null,
  title: string,
  onClick: ClickHandler,
  label?: string,
): HTMLButtonElement {
  return toolButton("cfos-icon-btn", paths, title, onClick, label);
}

export function segBtn(paths: string, title: string, onClick: ClickHandler): HTMLButtonElement {
  return toolButton("cfos-seg-btn", paths, title, onClick);
}

export function group(prio: string | null, items: Node[], first = false): HTMLDivElement {
  const children: Node[] = first ? [] : [el("div", { class: "cfos-tdiv" })];
  children.push(...items);
  return el("div", { class: "cfos-tgroup" + (prio ? " " + prio : "") }, children);
}

export interface ColorButtonControl {
  el: HTMLDivElement;
  setColor(color: string): void;
  getColor(): string;
}

export function colorBtn(
  paths: string,
  title: string,
  defaultColor: string,
  onChange: (color: string) => void,
): ColorButtonControl {
  const bar = el("span", { class: "cfos-color-bar" });
  bar.style.background = defaultColor;
  const input = el("input", {
    type: "color",
    value: defaultColor,
    title,
    "aria-label": title,
  });
  const button = el("div", { class: "cfos-color-btn", title }, [
    el("span", { html: icon(paths) }),
    bar,
    input,
  ]);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  input.addEventListener("input", () => {
    bar.style.background = input.value;
    onChange(input.value);
  });
  return {
    el: button,
    setColor(color: string) {
      input.value = color;
      bar.style.background = color;
    },
    getColor: () => input.value,
  };
}

export type SelectValue = string | number;

export type SelectOption =
  | {
      value: SelectValue;
      label: string;
      style?: string;
      ex?: string;
    }
  | { sep: true };

export interface CustomSelectOptions {
  className?: string;
  title?: string;
  options: SelectOption[];
  value: SelectValue;
  showUnlistedValue?: boolean;
  onChange: (value: string) => void;
}

export interface CustomSelect {
  el: HTMLButtonElement;
  setValue(value: SelectValue): void;
  getValue(): string | undefined;
  destroy(): void;
}

const CHEVRON = icon(ICONS.chevronDown, 12);

export function customSelect({
  className,
  title,
  options,
  value,
  showUnlistedValue,
  onChange,
}: CustomSelectOptions): CustomSelect {
  let current: string | undefined;
  const labelSpan = el("span", { class: "cfos-cs-label" });
  const button = el("button", {
    type: "button",
    class: "cfos-cselect " + (className ?? ""),
    title,
    "aria-label": title,
  }, [labelSpan, el("span", { class: "cfos-cs-chev", html: CHEVRON })]);
  button.addEventListener("mousedown", (event) => event.preventDefault());

  const menu = el("div", { class: "cfos-cmenu" });
  const choices = options.filter(
    (option): option is Exclude<SelectOption, { sep: true }> => !("sep" in option),
  );
  const items: HTMLDivElement[] = [];

  for (const option of options) {
    if ("sep" in option) {
      menu.appendChild(el("div", { class: "cfos-cmenu-sep" }));
      continue;
    }
    const check = el("span", { class: "cfos-cmenu-check", html: icon(ICONS.check, 13) });
    const item = el("div", { class: "cfos-cmenu-item", "data-value": option.value }, [
      el("span", {}, option.label),
      option.ex ? el("span", { class: "ex" }, option.ex) : null,
      check,
    ]);
    if (option.style) item.style.cssText += option.style;
    item.addEventListener("mousedown", (event) => event.preventDefault());
    item.addEventListener("click", () => {
      closeMenu();
      setValue(option.value);
      onChange(String(option.value));
    });
    menu.appendChild(item);
    items.push(item);
  }

  let open = false;
  function setValue(next: SelectValue): void {
    const key = String(next);
    if (key === current) return;
    current = key;
    const chosen = choices.find((option) => String(option.value) === key);
    labelSpan.textContent = chosen
      ? chosen.label
      : showUnlistedValue
        ? key
        : (choices[0]?.label ?? "");
    for (const item of items) item.classList.toggle("sel", item.dataset.value === key);
  }
  function openMenu(): void {
    const rect = button.getBoundingClientRect();
    menu.style.left = Math.min(Math.round(rect.left), Math.max(8, window.innerWidth - 220)) + "px";
    menu.style.top = Math.round(rect.bottom + 4) + "px";
    menu.style.minWidth = Math.round(Math.max(rect.width, 152)) + "px";
    document.body.appendChild(menu);
    open = true;
    button.classList.add("open");
  }
  function closeMenu(): void {
    menu.remove();
    open = false;
    button.classList.remove("open");
  }

  const onDocDown = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (open && !menu.contains(target) && !button.contains(target)) closeMenu();
  };
  const onScroll = () => {
    if (open) closeMenu();
  };
  const onResize = () => {
    if (open) closeMenu();
  };

  button.addEventListener("click", () => (open ? closeMenu() : openMenu()));
  document.addEventListener("mousedown", onDocDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  setValue(value);
  return {
    el: button,
    setValue,
    getValue: () => current,
    destroy: () => {
      closeMenu();
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    },
  };
}

export interface ActionMenuItem {
  id: string;
  label: string;
  desc?: string;
  section?: string;
  onSelect: () => void;
}

/** Floating action menu anchored to any button (e.g., Export, Insert function, Slide layout). */
export function bindActionMenu(
  trigger: HTMLElement,
  getItems: () => ActionMenuItem[],
): () => void {
  let menu: HTMLDivElement | null = null;

  const close = () => {
    menu?.remove();
    menu = null;
    trigger.classList.remove("open");
  };

  const open = () => {
    if (menu) {
      close();
      return;
    }
    const list = getItems();
    const m = el("div", { class: "cfos-cmenu cfos-action-menu" });
    let lastSection = "";
    for (const item of list) {
      if (item.section && item.section !== lastSection) {
        lastSection = item.section;
        m.appendChild(el("div", { class: "cfos-cmenu-section" }, item.section));
      }
      const row = el("button", { type: "button", class: "cfos-cmenu-item" }, [
        el("span", { class: "cfos-am-main" }, item.label),
        item.desc ? el("span", { class: "ex" }, item.desc) : null,
      ]);
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => {
        close();
        item.onSelect();
      });
      m.appendChild(row);
    }
    const rect = trigger.getBoundingClientRect();
    m.style.left = Math.min(Math.round(rect.left), Math.max(8, window.innerWidth - 260)) + "px";
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 220 && rect.top > 220) {
      m.style.bottom = Math.round(window.innerHeight - rect.top + 6) + "px";
    } else {
      m.style.top = Math.round(rect.bottom + 4) + "px";
    }
    m.style.minWidth = Math.round(Math.max(rect.width, 210)) + "px";
    document.body.appendChild(m);
    menu = m;
    trigger.classList.add("open");
  };

  const onTriggerClick = (e: MouseEvent) => {
    e.stopPropagation();
    open();
  };
  const onDocDown = (e: MouseEvent) => {
    const t = e.target as Node | null;
    if (menu && !menu.contains(t) && !trigger.contains(t)) close();
  };
  const onScroll = (e: Event) => {
    if (menu && e.target instanceof Node && !menu.contains(e.target)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (menu && e.key === "Escape") close();
  };

  trigger.addEventListener("mousedown", (e) => e.preventDefault());
  trigger.addEventListener("click", onTriggerClick);
  document.addEventListener("mousedown", onDocDown);
  window.addEventListener("scroll", onScroll, true);
  document.addEventListener("keydown", onKey);

  return () => {
    close();
    trigger.removeEventListener("click", onTriggerClick);
    document.removeEventListener("mousedown", onDocDown);
    window.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("keydown", onKey);
  };
}
