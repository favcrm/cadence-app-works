const KIND_LABEL = { deck: "Deck", doc: "Doc", sheet: "Sheet" };
const REVIEW_LABEL = { draft: "Draft", edited: "Edited", reviewed: "Reviewed" };
const REVIEW_DETAIL = { draft: "Draft", edited: "Edited since review", reviewed: "Reviewed" };
const REVIEW_TONE = {
  draft: "var(--color-ink-500)",
  edited: "var(--color-warn)",
  reviewed: "var(--color-ok)",
};
const CHANGE_TONE = {
  changed: "var(--color-warn)",
  added: "var(--color-ok)",
  removed: "var(--color-fail)",
};

export function mountWorks(root, { content }) {
  if (!root || !content) throw new Error("mountWorks requires a root and a content reader");

  const doc = root.ownerDocument;
  const state = { kind: "all", query: "", selectedId: null };

  const h = (tag, attrs = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "style") node.setAttribute("style", value);
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value);
      }
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null) continue;
      node.append(child.nodeType ? child : doc.createTextNode(String(child)));
    }
    return node;
  };

  const badge = (text, tone) => h("span", { class: "badge works-badge", style: `--c: ${tone}` }, text);

  const reviewText = (item) => {
    if (item.reviewedRevision === 0) return "Not reviewed";
    return `Reviewed r${item.reviewedRevision}`;
  };

  const header = () =>
    h(
      "header",
      { class: "works-head" },
      h(
        "div",
        {},
        h("div", { class: "kicker" }, "works · content"),
        h("h1", { class: "works-title" }, "Documents"),
        h("p", { class: "muted works-sub" }, "Read-only content surface · fixture data"),
      ),
      h("div", { class: "works-head-actions" }, badge("read-only", "var(--color-accent)")),
    );

  const counts = () => {
    const rows = content.list({ query: "" });
    const result = { all: rows.length, doc: 0, sheet: 0, deck: 0 };
    rows.forEach((row) => {
      result[row.kind] += 1;
    });
    return result;
  };

  const renderListBody = (body) => {
    body.replaceChildren();
    const rows = content.list({ query: state.query, kind: state.kind });
    if (rows.length === 0) {
      body.append(h("p", { class: "works-empty" }, "No documents match this view."));
      return;
    }

    rows.forEach((row) => {
      body.append(
        h(
          "button",
          {
            type: "button",
            class: "works-row",
            onclick: () => select(row.id),
          },
          h(
            "span",
            { class: "works-name" },
            h("span", { class: "works-name-text" }, row.title),
            h("span", { class: "works-kind" }, KIND_LABEL[row.kind]),
          ),
          h("span", { class: "works-rev" }, `r${row.revision}`),
          h("span", { class: "works-state-col" }, badge(REVIEW_LABEL[row.reviewState], REVIEW_TONE[row.reviewState])),
          h("span", { class: "works-updated-col" }, row.updated),
          h("span", { class: "works-owner-col" }, row.owner),
        ),
      );
    });
  };

  const toolbar = (listBody) => {
    const totals = counts();
    const tabs = [
      ["all", "All"],
      ["doc", "Docs"],
      ["sheet", "Sheets"],
      ["deck", "Decks"],
    ];
    const filters = h(
      "div",
      { class: "tabs works-filters", role: "tablist", "aria-label": "Document kind" },
      tabs.map(([kind, label]) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": state.kind === kind ? "true" : "false",
            class: `tab works-tab${state.kind === kind ? " on" : ""}`,
            onclick: () => {
              state.kind = kind;
              render();
            },
          },
          label,
          h("span", { class: "works-count" }, totals[kind]),
        ),
      ),
    );

    const search = h("input", {
      type: "search",
      class: "field works-search",
      placeholder: "Search documents",
      "aria-label": "Search documents",
      value: state.query,
      oninput: (event) => {
        state.query = event.target.value;
        renderListBody(listBody);
      },
    });

    return h("div", { class: "works-toolbar" }, filters, search);
  };

  const listView = () => {
    const listBody = h("div", { class: "works-list-body" });
    const list = h(
      "section",
      { class: "works-list", "aria-label": "Documents" },
      h(
        "div",
        { class: "works-list-head" },
        h("span", {}, "Name"),
        h("span", {}, "Revision"),
        h("span", {}, "State"),
        h("span", { class: "works-updated-col" }, "Updated"),
        h("span", { class: "works-owner-col" }, "Owner"),
      ),
      listBody,
    );
    const app = h("main", { class: "works-app" }, header(), toolbar(listBody), list);
    renderListBody(listBody);
    return app;
  };

  const statusView = (item) => {
    const review = reviewText(item);
    return h(
      "section",
      { class: "card works-status" },
      h(
        "div",
        { class: "works-status-head" },
        badge(REVIEW_DETAIL[item.reviewState], REVIEW_TONE[item.reviewState]),
        h("span", { class: "works-status-review" }, `${review} · current r${item.revision}`),
        badge(
          item.exportState === "ready" ? "export ready" : "export blocked",
          item.exportState === "ready" ? "var(--color-ok)" : "var(--color-warn)",
        ),
      ),
      h("p", { class: "works-status-copy" }, item.exportReason),
    );
  };

  const changesView = (item) => {
    if (!item.changes || item.changes.length === 0) return null;
    return h(
      "section",
      { class: "works-changes-wrap" },
      h("h2", { class: "works-section-title" }, "Changes since review"),
      h(
        "ul",
        { class: "works-changes" },
        item.changes.map((change) =>
          h(
            "li",
            {},
            badge(change.type, CHANGE_TONE[change.type] ?? "var(--color-ink-500)"),
            h("span", {}, change.text),
          ),
        ),
      ),
    );
  };

  const slideView = (item) =>
    h(
      "section",
      { class: "works-content" },
      h("h2", { class: "works-section-title" }, "Slides"),
      h(
        "div",
        { class: "works-slides" },
        item.slides.map((slide, index) =>
          h(
            "article",
            { class: "card works-slide" },
            h(
              "div",
              { class: "works-slide-top" },
              h("span", { class: "works-slide-num" }, String(index + 1).padStart(2, "0")),
              h("span", { class: "works-slide-kind" }, "slide"),
            ),
            h("h3", { class: "works-slide-title" }, slide.title),
            h("p", { class: "works-slide-body" }, slide.body),
            slide.notes ? h("p", { class: "works-notes" }, `Notes: ${slide.notes}`) : null,
          ),
        ),
      ),
    );

  const docView = (item) =>
    h(
      "section",
      { class: "card works-doc" },
      item.blocks.map((block) => {
        if (block.type === "h2") return h("h2", {}, block.text);
        if (block.type === "p") return h("p", {}, block.text);
        return h(
          "div",
          { class: "works-callout" },
          h("span", { class: "works-callout-label" }, block.label ?? "Note"),
          h("p", {}, block.text),
        );
      }),
    );

  const sheetView = (item) =>
    h(
      "section",
      { class: "card works-sheet" },
      h(
        "div",
        { class: "works-sheet-top" },
        h("span", { class: "works-sheet-tab on" }, "Sheet"),
        h("span", { class: "works-sheet-note" }, `${item.rows.length} rows · read-only`),
      ),
      h(
        "div",
        { class: "works-sheet-scroll" },
        h(
          "table",
          { class: "works-sheet-table" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              item.columns.map((column, index) => h("th", {}, column || (index === 0 ? "Row" : column))),
            ),
          ),
          h(
            "tbody",
            {},
            item.rows.map((row) =>
              h(
                "tr",
                {},
                row.map((cell, index) =>
                  h("td", { class: index === 0 ? "works-sheet-key" : "" }, String(cell)),
                ),
              ),
            ),
          ),
        ),
      ),
    );

  const contentView = (item) => {
    if (item.kind === "deck") return slideView(item);
    if (item.kind === "doc") return docView(item);
    return sheetView(item);
  };

  const detailView = (item) => {
    const back = h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost btn-sm works-back",
        onclick: () => {
          state.selectedId = null;
          render();
        },
      },
      "← Documents",
    );

    const head = h(
      "header",
      { class: "works-detail-head" },
      back,
      h(
        "div",
        { class: "works-detail-title" },
        h("div", { class: "kicker" }, `${KIND_LABEL[item.kind]} · r${item.revision}`),
        h("h1", { class: "works-title" }, item.title),
        h(
          "p",
          { class: "muted works-sub" },
          `Owner ${item.owner} · updated ${item.updated} · ${reviewText(item)}`,
        ),
      ),
      h("div", { class: "works-head-actions" }, badge("read-only", "var(--color-accent)")),
    );

    return h(
      "main",
      { class: "works-app" },
      h(
        "div",
        { class: "works-detail" },
        head,
        statusView(item),
        changesView(item),
        contentView(item),
      ),
    );
  };

  const render = () => {
    if (state.selectedId) {
      let item;
      try {
        item = content.get(state.selectedId);
      } catch {
        state.selectedId = null;
        render();
        return;
      }
      root.replaceChildren(detailView(item));
      return;
    }
    root.replaceChildren(listView());
  };

  function select(id) {
    try {
      content.get(id);
      state.selectedId = id;
      render();
    } catch {
      state.selectedId = null;
      render();
    }
  }

  render();
  return { select };
}
