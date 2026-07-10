// A small, dependency-free tabbed control panel. Each factory builds its DOM
// imperatively and returns a handle exposing `.value` / `.set()` so callers wire
// controls to scene state directly — no data-binding layer, no library. Styles
// are injected once and themed through CSS custom properties on `.panel`.

let stylesInjected = false;

const CSS = `
  .panel {
    --panel-bg: rgba(18, 18, 22, 0.92);
    --panel-fg: #e6e6ee;
    --panel-muted: #9a9aa8;
    --panel-accent: #ffc64a;
    --panel-track: rgba(255, 255, 255, 0.14);
    --panel-line: rgba(255, 255, 255, 0.08);
    position: fixed; top: 14px; right: 14px; z-index: 20;
    width: 292px; max-height: calc(100vh - 28px); overflow-y: auto;
    background: var(--panel-bg); color: var(--panel-fg);
    border: 1px solid var(--panel-line); border-radius: 12px;
    backdrop-filter: blur(10px);
    font: 12px/1.4 system-ui, sans-serif; user-select: none;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 11px 13px; cursor: pointer; font-weight: 600; letter-spacing: 0.02em;
  }
  .panel-head .chev { color: var(--panel-muted); transition: transform 0.15s; }
  .panel.collapsed .chev { transform: rotate(-90deg); }
  .panel.collapsed .panel-tabs, .panel.collapsed .panel-page { display: none; }
  .panel-tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--panel-line); }
  .panel-tab {
    flex: 1; padding: 7px 4px; text-align: center; cursor: pointer;
    color: var(--panel-muted); border-bottom: 2px solid transparent; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .panel-tab.active { color: var(--panel-fg); border-bottom-color: var(--panel-accent); }
  .panel-page { padding: 4px 13px 13px; }
  .panel-page:not(.active) { display: none; }
  .panel-row { display: flex; align-items: center; gap: 10px; margin: 9px 0; }
  .panel-row > .lab { flex: 0 0 88px; color: var(--panel-muted); }
  .panel-row > .ctl { flex: 1; display: flex; align-items: center; gap: 8px; }
  .panel-sec { margin: 12px -13px 4px; padding: 8px 13px 2px; border-top: 1px solid var(--panel-line);
    color: var(--panel-muted); text-transform: uppercase; font-size: 10px; letter-spacing: 0.08em; }
  .panel input[type="range"] { flex: 1; accent-color: var(--panel-accent); height: 3px; min-width: 0; }
  .panel .val { flex: 0 0 40px; text-align: right; color: var(--panel-muted); font-variant-numeric: tabular-nums; }
  .panel select, .panel input[type="number"] {
    flex: 1; width: 100%; background: var(--panel-track); color: var(--panel-fg);
    border: 1px solid var(--panel-line); border-radius: 6px; padding: 4px 6px; font: inherit;
  }
  .panel button {
    flex: 1; background: var(--panel-track); color: var(--panel-fg);
    border: 1px solid var(--panel-line); border-radius: 7px; padding: 7px 8px;
    font: inherit; cursor: pointer; transition: background 0.12s;
  }
  .panel button:hover { background: rgba(255, 255, 255, 0.22); }
  .panel button.primary { background: var(--panel-accent); color: #1a1408; border-color: transparent; font-weight: 600; }
  .panel button:disabled { opacity: 0.5; cursor: default; }
  .panel .switch {
    position: relative; width: 34px; height: 19px; flex: 0 0 auto;
    background: var(--panel-track); border-radius: 999px; cursor: pointer; transition: background 0.15s;
  }
  .panel .switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
    background: #fff; border-radius: 50%; transition: transform 0.15s;
  }
  .panel .switch.on { background: var(--panel-accent); }
  .panel .switch.on::after { transform: translateX(15px); }
  .panel a.link { color: var(--panel-accent); text-decoration: none; opacity: 0.85; }
  .panel a.link:hover { text-decoration: underline; }
`;

export interface NumberHandle { readonly value: number; set(v: number): void; }
export interface SliderHandle { readonly value: number; set(v: number): void; }
export interface ToggleHandle { readonly value: boolean; set(v: boolean): void; }
export interface DropdownHandle { readonly value: string; set(v: string): void; }
export interface LabelHandle { set(text: string): void; }

export interface SliderOpts {
  min: number;
  max: number;
  step?: number;
  value: number;
  format?: (v: number) => string;
}

// One tab's page: the surface controls attach to.
export class Page {
  readonly body: HTMLDivElement;

  constructor(body: HTMLDivElement) {
    this.body = body;
  }

  private row(label: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "panel-row";
    if (label) {
      const lab = document.createElement("span");
      lab.className = "lab";
      lab.textContent = label;
      row.appendChild(lab);
    }
    const ctl = document.createElement("div");
    ctl.className = "ctl";
    row.appendChild(ctl);
    this.body.appendChild(row);
    return ctl;
  }

  section(name: string): void {
    const sec = document.createElement("div");
    sec.className = "panel-sec";
    sec.textContent = name;
    this.body.appendChild(sec);
  }

  slider(label: string, opts: SliderOpts, onChange: (v: number) => void): SliderHandle {
    const ctl = this.row(label);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.step = String(opts.step ?? 1);
    input.value = String(opts.value);
    const val = document.createElement("span");
    val.className = "val";
    const fmt = opts.format ?? ((v) => String(v));
    val.textContent = fmt(opts.value);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      val.textContent = fmt(v);
      onChange(v);
    });
    ctl.append(input, val);
    return {
      get value() { return Number(input.value); },
      set(v) { input.value = String(v); val.textContent = fmt(v); },
    };
  }

  toggle(label: string, value: boolean, onChange: (v: boolean) => void): ToggleHandle {
    const ctl = this.row(label);
    const sw = document.createElement("div");
    sw.className = value ? "switch on" : "switch";
    let state = value;
    sw.addEventListener("click", () => {
      state = !state;
      sw.classList.toggle("on", state);
      onChange(state);
    });
    ctl.appendChild(sw);
    return {
      get value() { return state; },
      set(v) { state = v; sw.classList.toggle("on", v); },
    };
  }

  number(
    label: string,
    opts: { value: number; min?: number; max?: number; step?: number },
    onChange: (v: number) => void,
  ): NumberHandle {
    const ctl = this.row(label);
    const input = document.createElement("input");
    input.type = "number";
    if (opts.min !== undefined) input.min = String(opts.min);
    if (opts.max !== undefined) input.max = String(opts.max);
    input.step = String(opts.step ?? 1);
    input.value = String(opts.value);
    const emit = (): void => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    };
    input.addEventListener("change", emit);
    ctl.appendChild(input);
    return {
      get value() { return Number(input.value); },
      set(v) { input.value = String(v); },
    };
  }

  dropdown(
    label: string,
    options: readonly (string | { value: string; label: string })[],
    value: string,
    onChange: (v: string) => void,
  ): DropdownHandle {
    const ctl = this.row(label);
    const select = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      const v = typeof o === "string" ? o : o.value;
      opt.value = v;
      opt.textContent = typeof o === "string" ? o : o.label;
      if (v === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => onChange(select.value));
    ctl.appendChild(select);
    return {
      get value() { return select.value; },
      set(v) { select.value = v; },
    };
  }

  button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
    const ctl = this.row("");
    const btn = document.createElement("button");
    if (primary) btn.className = "primary";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    ctl.appendChild(btn);
    return btn;
  }

  label(label: string, initial = ""): LabelHandle {
    const ctl = this.row(label);
    const span = document.createElement("span");
    span.style.color = "var(--panel-fg)";
    span.textContent = initial;
    ctl.appendChild(span);
    return { set(text) { span.textContent = text; } };
  }

  custom(html: string): HTMLDivElement {
    const ctl = this.row("");
    ctl.innerHTML = html;
    return ctl;
  }
}

export class Panel {
  readonly el: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly pages = new Map<string, { tab: HTMLDivElement; page: Page; el: HTMLDivElement }>();

  constructor(title: string) {
    if (!stylesInjected) {
      const style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      stylesInjected = true;
    }
    this.el = document.createElement("div");
    this.el.className = "panel";
    const head = document.createElement("div");
    head.className = "panel-head";
    head.innerHTML = `<span>${title}</span><span class="chev">▾</span>`;
    head.addEventListener("click", () => this.el.classList.toggle("collapsed"));
    this.tabsEl = document.createElement("div");
    this.tabsEl.className = "panel-tabs";
    this.tabsEl.style.display = "none";
    this.el.append(head, this.tabsEl);
    document.body.appendChild(this.el);
  }

  // Get or lazily create a tab's page. The tab bar appears once there are ≥ 2.
  tab(name: string): Page {
    const existing = this.pages.get(name);
    if (existing) return existing.page;

    const pageEl = document.createElement("div");
    pageEl.className = "panel-page";
    const tabEl = document.createElement("div");
    tabEl.className = "panel-tab";
    tabEl.textContent = name;
    tabEl.addEventListener("click", () => this.select(name));

    const first = this.pages.size === 0;
    if (first) { pageEl.classList.add("active"); tabEl.classList.add("active"); }

    this.tabsEl.appendChild(tabEl);
    this.el.appendChild(pageEl);
    if (this.pages.size + 1 >= 2) this.tabsEl.style.display = "flex";

    const page = new Page(pageEl);
    this.pages.set(name, { tab: tabEl, page, el: pageEl });
    return page;
  }

  private select(name: string): void {
    for (const [key, { tab, el }] of this.pages) {
      const on = key === name;
      tab.classList.toggle("active", on);
      el.classList.toggle("active", on);
    }
  }
}
