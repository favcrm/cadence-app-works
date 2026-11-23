// Synthetic Works host for the local preview. It speaks the screen.v2
// MessageChannel protocol and imitates the Works verbs closely enough to
// drive the screen: revision CAS, idempotent writes, review/export slots drawn
// by the host, and a read-only canvas surface. Synthetic data only.

type Kind = "doc" | "deck" | "sheet";
type Section = "all" | "docs" | "sheets" | "decks";
type Json = Record<string, unknown>;

interface Item {
  id: string;
  kind: Kind;
  title: string;
  revision: number;
  reviewedRevision: number;
  reviewStatus: "none" | "pending" | "approved" | "changes_requested";
  trashed: boolean;
  content: Json;
  updatedAt: string;
}

const SECTIONS: { id: Section; en: string; zh: string }[] = [
  { id: "all", en: "All", zh: "全部" },
  { id: "docs", en: "Docs", zh: "文件" },
  { id: "sheets", en: "Sheets", zh: "試算表" },
  { id: "decks", en: "Decks", zh: "簡報" },
];

function seed(): Map<string, Item> {
  const now = new Date().toISOString();
  const items: Item[] = [
    {
      id: "quarterly-plan", kind: "doc", title: "Quarterly plan", revision: 3, reviewedRevision: 0,
      reviewStatus: "none", trashed: false, updatedAt: now,
      content: { blocks: [
        { type: "h2", text: "Goals for the quarter" },
        { type: "p", text: "Ship the onboarding revamp and cut support replies to under four hours." },
        { type: "callout", label: "Risk", text: "The billing migration may slip by one sprint if vendor access is late." },
        { type: "p", text: "Review the plan at the next weekly sync." },
      ] },
    },
    {
      id: "launch-deck", kind: "deck", title: "Launch review deck", revision: 2, reviewedRevision: 2,
      reviewStatus: "approved", trashed: false, updatedAt: now,
      content: { slides: [
        { title: "Where we are", body: "Beta is live with twelve pilot accounts and steady weekly use.", notes: "Mention the two churned pilots." },
        { title: "What we learned", body: "Setup takes too long; the checklist cut it from forty minutes to ten." },
        { title: "Next steps", body: "Open signups in March, with a waitlist for the first cohort." },
      ] },
    },
    {
      id: "budget-tracker", kind: "sheet", title: "Budget tracker", revision: 5, reviewedRevision: 3,
      reviewStatus: "none", trashed: false, updatedAt: now,
      content: { columns: ["Item", "Owner", "Planned", "Actual"], rows: [
        ["Design tools", "Mina", 1200, 1150],
        ["Hosting", "Arjun", 3400, 3625],
        ["Contractor", "Lee", 8000, 7200],
        ["Events", "Sam", 2500, 0],
      ] },
    },
    {
      id: "review-notes", kind: "doc", title: "Review notes", revision: 1, reviewedRevision: 0,
      reviewStatus: "pending", trashed: false, updatedAt: now,
      content: { blocks: [{ type: "p", text: "Collected feedback from the design review." }] },
    },
  ];
  return new Map(items.map((i) => [i.id, i]));
}

const DIGEST = `sha256:${"b".repeat(64)}`;
let items = seed();
const replays = new Map<string, unknown>();

const state = {
  nonce: "",
  generation: 1,
  section: "all" as Section,
  view: "list" as "list" | "new",
  recordId: null as string | null,
  params: {} as Record<string, string>,
  canvas: false,
  readsAdmitted: true,
  theme: "dark" as "dark" | "light",
  locale: "en" as "en" | "zh-TW",
  port: null as MessagePort | null,
  ready: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("works-frame");
const frameWrap = $("pv-frame-wrap");
const tabsEl = $("pv-tabs");
const statusEl = $("pv-status");
const dialog = $("pv-dialog");
const btnSurface = $<HTMLButtonElement>("btn-surface");
const selView = $<HTMLSelectElement>("sel-view");
const selReads = $<HTMLSelectElement>("sel-reads");

const randomNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");

function reviewState(i: Item): "draft" | "edited" | "reviewed" {
  if (i.reviewStatus === "changes_requested") return "edited";
  if (i.reviewedRevision === 0) return "draft";
  return i.reviewedRevision === i.revision ? "reviewed" : "edited";
}
const exportReady = (i: Item) => i.reviewStatus === "approved" && i.reviewedRevision === i.revision;

function snippet(i: Item): string {
  const c = i.content as { blocks?: { text: string }[]; slides?: { body: string }[]; rows?: unknown[] };
  if (i.kind === "doc") return c.blocks?.[0]?.text ?? "";
  if (i.kind === "deck") return c.slides?.[0]?.body ?? "";
  return `${c.rows?.length ?? 0} rows`;
}

function summary(i: Item): Json {
  return {
    id: i.id, kind: i.kind, title: i.title, revision: i.revision,
    reviewedRevision: i.reviewedRevision, reviewState: reviewState(i),
    exportState: exportReady(i) ? "ready" : "blocked", updated: "just now",
    updatedAt: i.updatedAt, owner: "operator", tags: [], snippet: snippet(i),
    reviewStatus: i.reviewStatus,
  };
}
const detail = (i: Item): Json => ({
  ...summary(i), exportReason: exportReady(i) ? "ready" : "blocked", author: "operator",
  contentDigest: DIGEST, ...structuredClone(i.content),
});

function actionsList(): string[] {
  if (state.canvas) {
    return state.readsAdmitted ? ["works.query", "works.get", "screen.route.patch"] : ["screen.route.patch"];
  }
  return [
    "works.query", "works.get", "works.create", "works.patch", "works.trash", "works.restore",
    "works.request_review", "works.review", "works.export", "screen.route.patch",
  ];
}

function pushScreen(): void {
  state.port?.postMessage({
    v: 2, op: "screen", tag: "works", install_id: "install_works_preview", context_id: "default", digest: DIGEST,
    installation: {
      install_id: "install_works_preview", name: "works", title: "Works", version: "0.2.3",
      digest: DIGEST, summary: "Synthetic Works host preview.",
    },
    contexts: SECTIONS.map((s) => ({ id: s.id, label: state.locale === "zh-TW" ? s.zh : s.en })),
    actions: actionsList(),
    presentation_locale: state.locale,
    route: {
      section: state.section, view: state.view, record_id: state.recordId, segment_id: null,
      params: { ...state.params },
    },
  });
}

function pushSurface(): void {
  state.port?.postMessage(
    state.canvas
      ? { v: 1, op: "surface", role: "canvas", modal: false, readOnly: true }
      : { v: 1, op: "surface", role: "primary", modal: false },
  );
}

const ok = (id: string, data: unknown) => state.port?.postMessage({ v: 2, op: "reply", id, ok: true, data });
const refuse = (id: string, code: string, text: string) =>
  state.port?.postMessage({ v: 2, op: "reply", id, ok: false, refusal: { code, text } });

function renderChrome(): void {
  document.documentElement.setAttribute("data-theme", state.theme);
  frameWrap.classList.toggle("is-canvas", state.canvas);
  btnSurface.textContent = state.canvas ? "Surface: Chat Canvas" : "Surface: Full App";
  btnSurface.setAttribute("aria-pressed", String(state.canvas));
  $("btn-theme").textContent = state.theme === "light" ? "Theme: Light" : "Theme: Dark";
  $("btn-theme").setAttribute("aria-pressed", String(state.theme === "light"));
  $("btn-locale").textContent = state.locale === "zh-TW" ? "Locale: zh-TW" : "Locale: EN";
  $("btn-locale").setAttribute("aria-pressed", String(state.locale === "zh-TW"));
  statusEl.textContent = `${state.ready ? "ready" : "connecting"} · ${items.size} items · ${state.canvas ? "canvas(ro)" : "primary"}`;
  tabsEl.innerHTML = "";
  for (const sec of SECTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pv-tab";
    btn.dataset.section = sec.id;
    btn.textContent = state.locale === "zh-TW" ? sec.zh : sec.en;
    btn.setAttribute("aria-selected", String(state.section === sec.id));
    btn.addEventListener("click", () => {
      state.section = sec.id;
      state.view = "list";
      state.recordId = null;
      state.params = {};
      pushScreen();
      renderChrome();
    });
    tabsEl.appendChild(btn);
  }
}

function slotDone(id: string, receipt: unknown): void {
  state.port?.postMessage({ v: 2, op: "slot-state", id, state: "done", receipt });
}
function slotRefused(id: string, code: string): void {
  state.port?.postMessage({ v: 2, op: "slot-state", id, state: "refused", refusal: { code, text: code } });
}

// The host, not the screen, draws the decision and supplies the format.
function drawConfirmation(title: string, choices: { label: string; value: string }[], done: (v: string | null) => void): void {
  dialog.hidden = false;
  dialog.innerHTML = "";
  const h = document.createElement("strong");
  h.textContent = title;
  const row = document.createElement("div");
  row.className = "pv-row";
  for (const choice of [...choices, { label: "Cancel", value: "" }]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pv-btn";
    b.textContent = choice.label;
    b.addEventListener("click", () => {
      dialog.hidden = true;
      done(choice.value || null);
    });
    row.appendChild(b);
  }
  dialog.append(h, row);
}

const MAX_CONTENT = 64 * 1024;

function validContent(kind: Kind, content: unknown): boolean {
  if (!content || typeof content !== "object") return false;
  if (JSON.stringify(content).length > MAX_CONTENT) return false;
  const c = content as Record<string, unknown[]>;
  if (kind === "doc") return Array.isArray(c.blocks) && c.blocks.every((b) => typeof (b as Json).text === "string" && String((b as Json).text).trim());
  if (kind === "deck") return Array.isArray(c.slides);
  return Array.isArray(c.columns) && c.columns.length > 0 && Array.isArray(c.rows) && c.rows.every((r) => Array.isArray(r) && r.length === c.columns.length);
}

function handleCall(id: string, verb: string, args: Json): void {
  if (verb === "screen.route.patch") {
    if (typeof args.section === "string" && SECTIONS.some((s) => s.id === args.section)) state.section = args.section as Section;
    if (args.view === "list" || args.view === "new") state.view = args.view;
    if ("record_id" in args) state.recordId = typeof args.record_id === "string" ? args.record_id : null;
    if (args.params && typeof args.params === "object") state.params = { ...(args.params as Record<string, string>) };
    ok(id, {});
    pushScreen();
    renderChrome();
    return;
  }
  if (!actionsList().includes(verb)) return refuse(id, "forbidden", "a read-only screen admits only read operations");
  const found = typeof args.id === "string" ? items.get(args.id) : undefined;

  if (verb === "works.query") {
    let rows = [...items.values()].filter((i) => !i.trashed);
    if (typeof args.kind === "string") rows = rows.filter((i) => i.kind === args.kind);
    if (typeof args.review === "string") rows = rows.filter((i) => (args.review === "pending" || args.review === "changes_requested" ? i.reviewStatus === args.review : reviewState(i) === args.review));
    if (typeof args.text === "string" && args.text) rows = rows.filter((i) => JSON.stringify(detail(i)).toLowerCase().includes(String(args.text).toLowerCase()));
    if (args.sort === "name") rows.sort((a, b) => a.title.localeCompare(b.title));
    return ok(id, rows.map(summary));
  }
  if (verb === "works.get") {
    if (!found || found.trashed) return refuse(id, "not_found", "works content was not found");
    return ok(id, detail(found));
  }
  if (verb === "works.create") {
    const key = String(args.idempotency_key);
    if (replays.has(key)) return ok(id, replays.get(key));
    const kind = args.kind as Kind;
    const title = String(args.title ?? "").trim();
    if (!title || !validContent(kind, args.content)) return refuse(id, "invalid", "works content is invalid");
    let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
    while (items.has(slug)) slug += "-2";
    const item: Item = { id: slug, kind, title, revision: 1, reviewedRevision: 0, reviewStatus: "none", trashed: false, content: args.content as Json, updatedAt: new Date().toISOString() };
    items.set(slug, item);
    replays.set(key, detail(item));
    renderChrome();
    return ok(id, detail(item));
  }
  if (!found || found.trashed && verb !== "works.restore") return refuse(id, "not_found", "works content was not found");

  if (verb === "works.patch") {
    const key = String(args.idempotency_key);
    if (replays.has(key)) return ok(id, replays.get(key));
    if (args.if_revision !== found.revision) return refuse(id, "conflict", "works content revision is stale");
    for (const op of args.operations as Json[]) {
      if (op.type === "set_title" && typeof op.title === "string" && op.title.trim()) found.title = op.title.trim();
      else if (op.type === "set_content" && validContent(found.kind, op.content)) found.content = op.content as Json;
      else return refuse(id, "invalid", "works operation is unsupported");
    }
    found.revision += 1;
    found.reviewStatus = "none";
    found.updatedAt = new Date().toISOString();
    replays.set(key, detail(found));
    renderChrome();
    return ok(id, detail(found));
  }
  if (verb === "works.trash" || verb === "works.restore") {
    if (args.if_revision !== found.revision) return refuse(id, "conflict", "works content revision is stale");
    found.trashed = verb === "works.trash";
    return ok(id, found.trashed ? { id: found.id, revision: found.revision, trashed: true } : detail(found));
  }
  if (verb === "works.request_review") {
    if (args.revision !== found.revision) return refuse(id, "conflict", "works content revision is stale");
    found.reviewStatus = "pending";
    return ok(id, detail(found));
  }
  refuse(id, "forbidden", `Operation ${verb} is unavailable`);
}

function handleSlot(id: string, verb: string, args: Json): void {
  const found = typeof args.id === "string" ? items.get(args.id) : undefined;
  if (!found || found.trashed) return slotRefused(id, "not_found");
  if (args.revision !== found.revision) return slotRefused(id, "facts_changed");
  if (verb === "works.review") {
    if (found.reviewStatus !== "pending") return slotRefused(id, "needs_review");
    drawConfirmation(`Review "${found.title}" revision ${found.revision}`, [
      { label: "Approve", value: "approve" },
      { label: "Request changes", value: "changes" },
    ], (decision) => {
      if (!decision) return slotRefused(id, "cancelled");
      if (decision === "approve") { found.reviewedRevision = found.revision; found.reviewStatus = "approved"; }
      else found.reviewStatus = "changes_requested";
      slotDone(id, { id: found.id, revision: found.revision });
    });
    return;
  }
  if (verb === "works.export") {
    if (!exportReady(found)) return slotRefused(id, "needs_review");
    drawConfirmation(`Export "${found.title}" revision ${found.revision}`, [{ label: "Export as HTML", value: "html" }], (format) => {
      if (!format) return slotRefused(id, "cancelled");
      slotDone(id, { id: found.id, revision: found.revision, format, digest: `sha256:${"c".repeat(16)}` });
    });
    return;
  }
  slotRefused(id, "forbidden");
}

window.addEventListener("message", (ev) => {
  if (ev.origin !== window.location.origin || ev.source !== frame.contentWindow) return;
  const msg = ev.data;
  if (!msg || msg.v !== 1 || msg.op !== "init" || msg.tag !== "works" || msg.bridge_nonce !== state.nonce || msg.generation !== state.generation) return;
  const port = ev.ports[0];
  if (!port) return;
  state.port?.close();
  state.port = port;
  state.ready = false;
  port.onmessage = (portEv) => {
    const packet = portEv.data;
    if (!packet || typeof packet !== "object") return;
    if (packet.op === "ready") {
      state.ready = true;
      pushScreen();
      pushSurface();
      renderChrome();
    } else if (packet.v === 2 && packet.op === "call" && typeof packet.id === "string") {
      handleCall(packet.id, String(packet.verb ?? ""), (packet.args ?? {}) as Json);
    } else if (packet.v === 2 && packet.op === "slot" && typeof packet.id === "string") {
      handleSlot(packet.id, String(packet.verb ?? ""), (packet.args ?? {}) as Json);
    }
  };
  port.start();
});

function mountFrame(): void {
  state.nonce = randomNonce();
  state.generation += 1;
  state.ready = false;
  const qs = new URLSearchParams({ nonce: state.nonce, gen: String(state.generation), origin: window.location.origin, theme: state.theme });
  frame.src = `/dev/preview/frame.html?${qs.toString()}`;
  renderChrome();
}

function applyView(): void {
  if (selView.value === "card") {
    state.canvas = true;
    state.section = "all";
    state.view = "list";
    state.recordId = null;
    state.params = { id: "quarterly-plan" };
  } else {
    state.params = {};
    state.recordId = null;
  }
  pushScreen();
  pushSurface();
  renderChrome();
}

btnSurface.addEventListener("click", () => {
  state.canvas = !state.canvas;
  pushScreen();
  pushSurface();
  renderChrome();
});
selView.addEventListener("change", applyView);
selReads.addEventListener("change", () => {
  state.readsAdmitted = selReads.value === "admitted";
  pushScreen();
});
$("btn-theme").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  frame.contentWindow?.postMessage({ type: "preview-theme", theme: state.theme }, window.location.origin);
  renderChrome();
});
$("btn-locale").addEventListener("click", () => {
  state.locale = state.locale === "en" ? "zh-TW" : "en";
  pushScreen();
  renderChrome();
});
// Another member saves the open item: the screen's loaded revision is now stale.
$("btn-elsewhere").addEventListener("click", () => {
  const target = items.get(state.recordId ?? state.params.id ?? "");
  if (!target) return;
  target.revision += 1;
  target.reviewStatus = "none";
});
$("btn-reset").addEventListener("click", () => {
  items = seed();
  replays.clear();
  state.section = "all";
  state.view = "list";
  state.recordId = null;
  state.params = {};
  state.canvas = false;
  selView.value = "default";
  mountFrame();
});

renderChrome();
mountFrame();
