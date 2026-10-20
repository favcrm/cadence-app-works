import { createContentReader } from "../content/reader.mjs";
import { createHostClient, HostClientError } from "../host/client.mjs";
import { mountWorks } from "./works.mjs";

const DEFAULT_HOST = "http://127.0.0.1:4174";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const isLoopbackHost = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/") return false;
  return LOOPBACK_HOSTS.has(url.hostname);
};

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (typeof value === "boolean") {
      if (value) node.setAttribute(key, "");
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
};

const contentFrom = (kind, title, body, base) => {
  if (kind === "doc") {
    const paragraphs = body
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      blocks: [
        { type: "h2", text: title },
        ...(paragraphs.length ? paragraphs : [body.trim() || title]).map((text) => ({ type: "p", text })),
      ],
    };
  }
  if (kind === "deck") {
    const paragraphs = body
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    const parts = paragraphs.length ? paragraphs : [title];
    return {
      slides: parts.map((text, index) => ({
        title: index === 0 ? title || "Slide 1" : `Slide ${index + 1}`,
        body: text || title,
      })),
    };
  }
  const columns = Array.isArray(base?.columns) && base.columns.length ? [...base.columns] : ["Row", "Value"];
  const rows = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(",").map((cell) => cell.trim());
      while (cells.length < columns.length) cells.push("");
      return cells.slice(0, columns.length);
    });
  return { columns, rows: rows.length ? rows : [columns.map(() => "")] };
};

const openDialog = (title, fields, submitLabel) =>
  new Promise((resolve) => {
    const dialog = el("dialog", { class: "works-dialog", "aria-label": title });
    const form = el("form", { class: "works-dialog-form", method: "dialog" });
    const controls = {};
    const body = el("div", { class: "works-dialog-fields" });

    for (const field of fields) {
      const id = `works-field-${field.name}`;
      const label = el("label", { class: "works-field", for: id });
      label.append(el("span", { class: "works-field-label" }, field.label));
      let control;
      if (field.type === "select") {
        control = el("select", { id, class: "field", name: field.name });
        for (const [value, text] of field.options) {
          const option = el("option", { value }, text);
          if (String(field.value ?? "") === value) option.selected = true;
          control.append(option);
        }
      } else if (field.type === "textarea") {
        control = el("textarea", {
          id,
          class: "field",
          name: field.name,
          rows: "6",
          placeholder: field.placeholder ?? "",
        });
        control.value = field.value ?? "";
      } else {
        control = el("input", {
          id,
          class: "field",
          name: field.name,
          type: field.type ?? "text",
          value: field.value ?? "",
          placeholder: field.placeholder ?? "",
        });
      }
      if (field.required) control.required = true;
      controls[field.name] = control;
      label.append(control);
      body.append(label);
    }

    const cancel = el("button", { type: "button", class: "btn btn-ghost btn-sm" }, "Cancel");
    const submit = el("button", { type: "submit", class: "btn btn-acc btn-sm" }, submitLabel);
    form.append(
      el("h2", { class: "works-dialog-title" }, title),
      body,
      el("div", { class: "works-dialog-actions" }, cancel, submit),
    );
    dialog.append(form);

    const close = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };

    cancel.addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(null);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = {};
      for (const [name, control] of Object.entries(controls)) values[name] = control.value.trim();
      close(values);
    });

    document.body.append(dialog);
    dialog.showModal();
    Object.values(controls)[0]?.focus();
  });

export async function mountWorksWrite(root, { host, status, feedback, actorInput } = {}) {
  if (!root) throw new Error("mountWorksWrite requires a root");
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const requestedHost = host || params.get("host") || DEFAULT_HOST;
  const author = () => actorInput?.value.trim() || "author-1";
  const nextKey = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

  let feedbackTimer;
  const showFeedback = (message, tone = "info") => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.tone = tone;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedback.textContent = "";
      delete feedback.dataset.tone;
    }, 8000);
  };
  const setStatus = (message, tone) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  if (!isLoopbackHost(requestedHost)) {
    setStatus(`refused non-loopback host: ${requestedHost}`, "error");
    showFeedback("Only a loopback reference host is allowed.", "error");
    return null;
  }
  const base = requestedHost;
  const client = createHostClient(base);

  let reader = createContentReader([]);
  const hostRows = new Map();
  const hostDetails = new Map();

  const hostView = (row) => {
    const host = hostRows.get(row.id);
    if (!host) return row;
    return {
      ...row,
      reviewState: host.reviewStatus === "changes_requested" ? "edited" : host.reviewState,
      exportState: host.exportState,
      reviewStatus: host.reviewStatus,
    };
  };

  const content = {
    list: (options) => reader.list(options).map(hostView),
    get: (id) => {
      const detail = reader.get(id);
      const host = hostDetails.get(id);
      if (!host) return detail;
      return {
        ...detail,
        reviewState: host.reviewStatus === "changes_requested" ? "edited" : host.reviewState,
        exportState: host.exportState,
        exportReason: host.exportReason,
        reviewStatus: host.reviewStatus,
        reviewRequestedRevision: host.reviewRequestedRevision,
      };
    },
  };

  const reload = async () => {
    const rows = await client.list({ query: "" });
    const details = await Promise.all(rows.map((row) => client.get(row.id)));
    hostRows.clear();
    hostDetails.clear();
    for (const row of rows) hostRows.set(row.id, row);
    for (const detail of details) hostDetails.set(detail.id, detail);
    reader = createContentReader(details);
  };

  let app;
  let lastTrashed = null;

  const run = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HostClientError && error.code === "conflict") {
        showFeedback(`Revision changed: ${error.message}. Reloading the current content.`, "warn");
        try {
          await reload();
          app?.refresh();
        } catch {
          // The conflict message is already visible; a failed reload keeps the stale view.
        }
        return null;
      }
      showFeedback(error instanceof Error ? error.message : "request failed", "error");
      return null;
    }
  };

  const refresh = async () => {
    await reload();
    app.refresh();
  };

  const actions = {
    async create() {
      const values = await openDialog(
        "New content",
        [
          {
            name: "kind",
            label: "Kind",
            type: "select",
            options: [
              ["doc", "Doc"],
              ["sheet", "Sheet"],
              ["deck", "Deck"],
            ],
            value: "doc",
          },
          { name: "title", label: "Title", required: true, placeholder: "Retention addendum" },
          {
            name: "body",
            label: "Body",
            type: "textarea",
            placeholder:
              "Doc: paragraphs separated by blank lines.\nSheet: one row per line, comma separated.\nDeck: one slide body per paragraph.",
          },
        ],
        "Create",
      );
      if (!values) return;
      const created = await run(() =>
        client.create({
          kind: values.kind,
          title: values.title,
          content: contentFrom(values.kind, values.title, values.body),
          tags: [],
          actor: author(),
          key: nextKey("create"),
        }),
      );
      if (!created) return;
      try {
        await refresh();
        app.select(created.id);
        showFeedback(`Created ${created.id} r${created.revision}.`, "ok");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },

    async edit(item) {
      const values = await openDialog(
        `Edit ${item.title}`,
        [{ name: "title", label: "Title", value: item.title, required: true }],
        "Save revision",
      );
      if (!values) return;
      const saved = await run(() =>
        client.patch(item.id, {
          ifRevision: item.revision,
          operations: [{ type: "set_title", title: values.title }],
          actor: author(),
          key: nextKey(`patch-${item.id}`),
        }),
      );
      if (!saved) return;
      try {
        await refresh();
        app.select(saved.id);
        showFeedback(`Saved ${saved.id} r${saved.revision}.`, "ok");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },

    async requestReview(item) {
      const result = await run(() =>
        client.requestReview(item.id, { revision: item.revision, actor: author() }),
      );
      if (!result) return;
      try {
        await refresh();
        app.select(item.id);
        showFeedback(`Review requested for ${item.id} r${item.revision}.`, "ok");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },

    async review(item) {
      const values = await openDialog(
        `Review ${item.id} r${item.revision}`,
        [
          { name: "actor", label: "Reviewer", value: "reviewer-1", required: true },
          {
            name: "decision",
            label: "Decision",
            type: "select",
            options: [
              ["approve", "Approve"],
              ["changes", "Request changes"],
            ],
            value: "approve",
          },
          { name: "note", label: "Note", type: "textarea", placeholder: "Optional review note" },
        ],
        "Record review",
      );
      if (!values) return;
      const result = await run(() =>
        client.review(item.id, {
          revision: item.revision,
          decision: values.decision,
          note: values.note,
          actor: values.actor,
        }),
      );
      if (!result) return;
      try {
        await refresh();
        app.select(item.id);
        showFeedback(`Review recorded for ${item.id} r${item.revision}.`, "ok");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },

    async export(item) {
      const values = await openDialog(
        `Export ${item.id} r${item.revision}`,
        [
          {
            name: "format",
            label: "Format",
            type: "select",
            options: [
              ["html", "HTML"],
              ["pdf", "PDF"],
              ["pptx", "PowerPoint"],
            ],
            value: "html",
          },
          { name: "actor", label: "Actor", value: author(), required: true },
        ],
        "Export",
      );
      if (!values) return;
      const receipt = await run(() =>
        client.export(item.id, {
          revision: item.revision,
          format: values.format,
          actor: values.actor,
        }),
      );
      if (!receipt) return;
      showFeedback(`Exported ${receipt.format}: ${receipt.digest}`, "ok");
    },

    async trash(item) {
      if (!globalThis.confirm(`Trash ${item.title}?`)) return;
      const result = await run(() =>
        client.trash(item.id, {
          ifRevision: item.revision,
          actor: author(),
          key: nextKey(`trash-${item.id}`),
        }),
      );
      if (!result) return;
      lastTrashed = { id: result.id, revision: result.revision };
      try {
        await refresh();
        showFeedback(`Trashed ${result.id}; Restore can bring back r${result.revision}.`, "warn");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },

    async restore() {
      let target = lastTrashed;
      if (!target) {
        const values = await openDialog(
          "Restore content",
          [
            { name: "id", label: "Content id", required: true, placeholder: "retention-addendum" },
            { name: "revision", label: "Revision", type: "number", value: "1", required: true },
          ],
          "Restore",
        );
        if (!values) return;
        target = { id: values.id, revision: Number(values.revision) };
      }
      const result = await run(() =>
        client.restore(target.id, {
          ifRevision: target.revision,
          actor: author(),
          key: nextKey(`restore-${target.id}`),
        }),
      );
      if (!result) return;
      lastTrashed = null;
      try {
        await refresh();
        app.select(result.id);
        showFeedback(`Restored ${result.id}.`, "ok");
      } catch (error) {
        showFeedback(error.message, "error");
      }
    },
  };

  setStatus(`connecting to ${base}`, "pending");
  try {
    await client.health();
    await reload();
  } catch (error) {
    setStatus(`unavailable at ${base}`, "error");
    showFeedback(error instanceof Error ? error.message : "reference host unavailable", "error");
    return null;
  }

  app = mountWorks(root, { content, actions });
  setStatus(`connected to ${base}`, "ok");
  return app;
}
