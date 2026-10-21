// Works screen client. Runs in the host-sandboxed document (opaque origin).
// Talks to the host only through the MessagePort the host hands over in init.
// Every operation is a host verb declared in screens.json; no other channel exists.
// Screen arguments carry selectors and content only. The host supplies the
// installation, context, reviewer identity, reviewer decision and export format.
(function () {
  "use strict";

  var BOOT_ID = "cadence-screen-boot";
  var RECORDS = "screen-records.v1";
  var KINDS = ["doc", "deck", "sheet"];
  var KIND_LABEL = { doc: "Doc", deck: "Deck", sheet: "Sheet" };
  var DOC_BLOCK_TYPES = ["p", "h2", "callout"];
  // Review presentation comes only from host results: reviewState, reviewStatus,
  // reviewedRevision, revision and exportState/exportReason.
  var REVIEW_LABEL = { draft: "Draft", edited: "Edited since review", reviewed: "Reviewed" };
  // The host's closed Works refusal vocabulary (store codes carried through the bridge).
  var REFUSAL_TEXT = {
    invalid: "The host refused this request as invalid.",
    forbidden: "Your verified role cannot perform this action.",
    not_found: "This Works item was not found.",
    conflict: "This item changed since you opened it. Your unsaved input is kept below.",
    needs_review: "Export needs an approved current revision.",
    facts_changed: "That changed. Refresh before trying again.",
    rejected: "The host refused this request.",
    unauthorized: "This app's access is no longer available.",
    expired: "This confirmation has expired."
  };

  var boot = readBoot();
  if (!boot) return;

  var root = document.getElementById("app") || document.body;
  var port = null;
  var nextId = 0;
  var pending = {};
  var state = {
    view: "list",
    kind: "all",
    query: "",
    rows: [],
    item: null,
    trashed: null,
    notice: null,
    busy: false,
    // Unsaved draft kept across a CAS refusal so the user does not lose input.
    draft: null
  };

  function readBoot() {
    var node = document.getElementById(BOOT_ID);
    if (!node) return null;
    try {
      var data = JSON.parse(node.textContent || "{}");
      if (typeof data.tag !== "string" || typeof data.bridge_nonce !== "string") return null;
      if (typeof data.generation !== "number" || typeof data.parent_origin !== "string") return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === undefined || value === null || value === false) return;
        if (key === "text") node.textContent = String(value);
        else if (key === "class") node.className = value;
        else if (key === "on") Object.keys(value).forEach(function (ev) { node.addEventListener(ev, value[ev]); });
        else if (value === true) node.setAttribute(key, "");
        else node.setAttribute(key, String(value));
      });
    }
    (children || []).forEach(function (child) {
      if (child !== null && child !== undefined) node.append(child);
    });
    return node;
  }

  function refusalText(refusal) {
    if (!refusal) return "The host refused this request.";
    return REFUSAL_TEXT[refusal.code] || refusal.text || "The host refused this request.";
  }

  // One idempotency key per user intent. A retry of the same intent reuses the
  // key; a new intent rotates it. The host replays the same key and payload.
  function newKey(verb) {
    return verb + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function send(message) {
    if (port) port.postMessage(message);
  }

  // Host CALL verb: resolves with reply data, rejects with the host refusal.
  function call(verb, args) {
    return new Promise(function (resolve, reject) {
      var id = "c" + (++nextId);
      pending[id] = { resolve: resolve, reject: reject };
      send({ v: 2, op: "call", id: id, verb: verb, args: args });
    });
  }

  // Host SLOT verb: the host draws the confirmation card and reports the outcome.
  function slot(verb, args) {
    return new Promise(function (resolve, reject) {
      var id = "s" + (++nextId);
      pending[id] = { resolve: resolve, reject: reject };
      send({ v: 2, op: "slot", id: id, verb: verb, args: args, anchor: "footer" });
    });
  }

  function onReply(message) {
    var entry = pending[message.id];
    if (!entry) return;
    delete pending[message.id];
    if (message.ok) entry.resolve(message.data);
    else entry.reject(message.refusal || { code: "invalid", text: "" });
  }

  function onSlotState(message) {
    var entry = pending[message.id];
    if (!entry || message.state === "pending") return;
    delete pending[message.id];
    if (message.state === "refused") entry.reject(message.refusal || { code: "invalid", text: "" });
    else entry.resolve(message.data);
  }

  function onPortMessage(event) {
    var message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.op === "reply") onReply(message);
    else if (message.op === "slot-state") onSlotState(message);
  }

  function init() {
    var channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onPortMessage;
    window.parent.postMessage(
      { v: 1, op: "init", tag: boot.tag, bridge_nonce: boot.bridge_nonce, generation: boot.generation },
      boot.parent_origin,
      [channel.port2]
    );
    send({ v: 1, op: "ready", accepts: ["screen.v2", RECORDS] });
  }

  function setBusy(flag) {
    state.busy = flag;
    render();
  }

  // A refusal keeps the unsaved draft in state.draft, so the user can reconcile it.
  function fail(refusal) {
    state.busy = false;
    state.notice = { kind: "refused", text: refusalText(refusal) };
    render();
  }

  function receipt(text) {
    state.busy = false;
    state.notice = { kind: "receipt", text: text };
  }

  // works.query returns a bare array of compact rows. Trashed items are excluded.
  function loadList() {
    setBusy(true);
    var args = { sort: "updated" };
    if (state.kind !== "all") args.kind = state.kind;
    if (state.query) args.text = state.query;
    return call("works.query", args).then(function (rows) {
      state.rows = Array.isArray(rows) ? rows : [];
      state.busy = false;
      render();
    }, fail);
  }

  // works.get returns the item detail, or not_found for trashed items.
  function loadItem(id) {
    setBusy(true);
    return call("works.get", { id: id }).then(function (item) {
      state.item = item;
      state.view = "detail";
      state.busy = false;
      state.notice = null;
      state.draft = null;
      render();
    }, fail);
  }

  // Typed content, per kind. Each form edits only the fields it shows; other
  // fields of the stored content are carried over verbatim.
  function contentFromDraft(kind, draft) {
    if (kind === "doc") {
      return { blocks: draft.blocks.map(function (block) {
        var out = { type: block.type, text: block.text };
        if (block.type === "callout" && block.label) out.label = block.label;
        return out;
      }) };
    }
    if (kind === "deck") {
      return { slides: draft.slides.map(function (slide) {
        var out = { title: slide.title, body: slide.body };
        if (slide.notes) out.notes = slide.notes;
        return out;
      }) };
    }
    return { columns: draft.columns.slice(), rows: draft.rows.map(function (row) { return row.slice(); }) };
  }

  function validateDraft(kind, draft) {
    if (!draft.title.trim()) return "Give the document a name.";
    if (kind === "doc") {
      for (var i = 0; i < draft.blocks.length; i++) {
        if (!draft.blocks[i].text.trim()) return "Every block needs text.";
      }
    }
    if (kind === "deck") {
      for (var j = 0; j < draft.slides.length; j++) {
        if (!draft.slides[j].title.trim() || !draft.slides[j].body.trim()) {
          return "Every slide needs a title and a body.";
        }
      }
    }
    if (kind === "sheet") {
      if (!draft.columns.length || draft.columns.some(function (c) { return !c.trim(); })) {
        return "Every column needs a name.";
      }
      for (var k = 0; k < draft.rows.length; k++) {
        if (draft.rows[k].length !== draft.columns.length) return "Every row must match the columns.";
      }
    }
    return null;
  }

  // Build a draft from the stored host content, so unedited fields survive.
  function draftFromItem(item) {
    var content = item.content || {};
    var base = { title: item.title };
    if (item.kind === "doc") base.blocks = (content.blocks || []).map(function (b) {
      return { type: b.type, text: b.text, label: b.label };
    });
    else if (item.kind === "deck") base.slides = (content.slides || []).map(function (s) {
      return { title: s.title, body: s.body, notes: s.notes };
    });
    else {
      base.columns = (content.columns || []).slice();
      base.rows = (content.rows || []).map(function (r) { return r.slice(); });
    }
    return base;
  }

  function createDocument(kind, draft) {
    var problem = validateDraft(kind, draft);
    if (problem) {
      state.notice = { kind: "refused", text: problem };
      render();
      return;
    }
    var key = newKey("create");
    setBusy(true);
    call("works.create", {
      kind: kind,
      title: draft.title.trim(),
      content: contentFromDraft(kind, draft),
      idempotency_key: key
    }).then(function (created) {
      receipt("Created " + draft.title.trim() + ".");
      state.draft = null;
      return loadItem(created && created.id);
    }, fail);
  }

  // patch: title and typed content, both at if_revision, with one key per save.
  function saveItem(item, draft) {
    var problem = validateDraft(item.kind, draft);
    if (problem) {
      state.notice = { kind: "refused", text: problem };
      render();
      return;
    }
    var operations = [];
    if (draft.title.trim() !== item.title) operations.push({ type: "set_title", title: draft.title.trim() });
    var nextContent = contentFromDraft(item.kind, draft);
    if (JSON.stringify(nextContent) !== JSON.stringify(item.content)) {
      operations.push({ type: "set_content", content: nextContent });
    }
    if (!operations.length) {
      state.notice = { kind: "receipt", text: "Nothing to save." };
      render();
      return;
    }
    setBusy(true);
    call("works.patch", {
      id: item.id,
      if_revision: item.revision,
      operations: operations,
      idempotency_key: newKey("patch")
    }).then(function () {
      receipt("Saved.");
      state.draft = null;
      return loadItem(item.id);
    }, fail);
  }

  function requestReview(item) {
    setBusy(true);
    call("works.request_review", {
      id: item.id,
      revision: item.revision,
      idempotency_key: newKey("request_review")
    }).then(function () {
      receipt("Review requested for revision " + item.revision + ".");
      return loadItem(item.id);
    }, fail);
  }

  // Trash is soft. The item leaves the list; its id is kept so Restore stays reachable.
  function trashItem(item) {
    setBusy(true);
    call("works.trash", {
      id: item.id,
      if_revision: item.revision,
      idempotency_key: newKey("trash")
    }).then(function (reply) {
      var revision = reply && typeof reply.revision === "number" ? reply.revision : item.revision;
      state.trashed = { id: item.id, title: item.title, revision: revision };
      state.view = "list";
      receipt("Moved " + item.title + " to trash.");
      return loadList();
    }, fail);
  }

  // Restore needs the trashed revision the host last reported.
  function restoreItem(trashed) {
    setBusy(true);
    call("works.restore", {
      id: trashed.id,
      if_revision: trashed.revision,
      idempotency_key: newKey("restore")
    }).then(function () {
      state.trashed = null;
      receipt("Restored " + trashed.title + ".");
      return loadList();
    }, fail);
  }

  // Review is a SLOT: the host draws the approve/changes card and supplies the decision.
  function reviewItem(item) {
    setBusy(true);
    slot("works.review", { id: item.id, revision: item.revision })
      .then(function () {
        receipt("Review recorded.");
        return loadItem(item.id);
      }, fail);
  }

  // Export is a SLOT: the host draws the confirmation card and supplies the format.
  // The receipt is {id, revision, format, digest}; no rendered file is produced here.
  function exportItem(item) {
    setBusy(true);
    slot("works.export", { id: item.id, revision: item.revision })
      .then(function (exported) {
        state.busy = false;
        state.notice = {
          kind: "receipt",
          text: "Export receipt: revision " + exported.revision +
            " · format " + exported.format + " · digest " + exported.digest
        };
        render();
      }, fail);
  }

  // Presentation from host results only. Stale approval = a reviewed revision
  // that is no longer current, so the host reports the state as edited.
  function reviewPresentation(item) {
    if (item.reviewStatus === "pending") return "Review pending for revision " + item.revision + ".";
    if (item.reviewStatus === "changes_requested") return "Changes requested. Edit and request review again.";
    if (item.reviewState === "reviewed" && item.exportState === "ready") {
      return "Reviewed: revision " + item.revision + " is approved and current.";
    }
    if (item.reviewState === "edited" && item.reviewedRevision) {
      return "Stale approval: revision " + item.reviewedRevision + " was approved; current is " + item.revision + ".";
    }
    return REVIEW_LABEL[item.reviewState] || "Draft";
  }

  function noticeNode() {
    if (!state.notice) return null;
    return el("div", { class: "works-notice " + state.notice.kind, role: "status", text: state.notice.text });
  }

  function trashedNode() {
    if (!state.trashed) return null;
    return el("div", { class: "works-trashed" }, [
      el("span", { text: "In trash: " + state.trashed.title }),
      el("button", {
        type: "button",
        disabled: state.busy,
        text: "Restore",
        on: { click: function () { restoreItem(state.trashed); } }
      })
    ]);
  }

  // Draft-backed editor for doc blocks, deck slides and sheet rows. Input edits
  // mutate the draft object so a CAS refusal re-renders the unsaved text.
  function kindEditor(kind, draft, onChange) {
    if (kind === "doc") {
      return el("div", { class: "works-blocks" }, draft.blocks.map(function (block, index) {
        var typeSelect = el("select", { "aria-label": "Block type", on: { change: function (e) { block.type = e.target.value; onChange(); } } },
          DOC_BLOCK_TYPES.map(function (t) {
            var o = el("option", { value: t, text: t });
            if (t === block.type) o.setAttribute("selected", "");
            return o;
          }));
        var text = el("textarea", { "aria-label": "Block text", on: { input: function (e) { block.text = e.target.value; } } });
        text.value = block.text;
        return el("div", { class: "works-block" }, [typeSelect, text,
          el("button", { type: "button", text: "Remove", on: { click: function () { draft.blocks.splice(index, 1); onChange(); } } })]);
      }).concat([el("button", { type: "button", text: "Add block", on: { click: function () { draft.blocks.push({ type: "p", text: "" }); onChange(); } } })]));
    }
    if (kind === "deck") {
      return el("div", { class: "works-slides" }, draft.slides.map(function (slide, index) {
        var title = el("input", { "aria-label": "Slide title", on: { input: function (e) { slide.title = e.target.value; } } });
        title.value = slide.title;
        var body = el("textarea", { "aria-label": "Slide body", on: { input: function (e) { slide.body = e.target.value; } } });
        body.value = slide.body;
        return el("div", { class: "works-slide" }, [title, body,
          el("button", { type: "button", text: "Remove", on: { click: function () { draft.slides.splice(index, 1); onChange(); } } })]);
      }).concat([el("button", { type: "button", text: "Add slide", on: { click: function () { draft.slides.push({ title: "", body: "" }); onChange(); } } })]));
    }
    // sheet: columns and rows as a text grid; cells are strings or numbers.
    var header = el("input", { "aria-label": "Columns (comma separated)", on: { input: function (e) {
      draft.columns = e.target.value.split(",").map(function (c) { return c.trim(); });
    } } });
    header.value = draft.columns.join(", ");
    return el("div", { class: "works-sheet" }, [header,
      el("p", { text: "Columns and rows keep their shape. Rows must match the column count." }),
      el("button", { type: "button", text: "Add row", on: { click: function () {
        draft.rows.push(draft.columns.map(function () { return ""; })); onChange();
      } } })
    ].concat(draft.rows.map(function (row, r) {
      return el("div", { class: "works-row-cells" }, row.map(function (cell, c) {
        var input = el("input", { "aria-label": "Cell " + (r + 1) + "-" + (c + 1), on: { input: function (e) { row[c] = e.target.value; } } });
        input.value = String(cell);
        return input;
      }).concat([el("button", { type: "button", text: "Remove row", on: { click: function () { draft.rows.splice(r, 1); onChange(); } } })]));
    })));
  }

  function listView() {
    var rows = state.rows.map(function (row) {
      return el("button", {
        class: "works-row",
        type: "button",
        disabled: state.busy,
        on: { click: function () { loadItem(row.id); } }
      }, [
        el("span", { text: row.title }),
        el("span", { text: KIND_LABEL[row.kind] || row.kind }),
        el("span", { text: "r" + row.revision }),
        el("span", { text: REVIEW_LABEL[row.reviewState] || row.reviewState }),
        el("span", { text: row.updated })
      ]);
    });
    var tabs = ["all"].concat(KINDS).map(function (kind) {
      return el("button", {
        type: "button",
        class: state.kind === kind ? "on" : "",
        disabled: state.busy,
        on: { click: function () { state.kind = kind; loadList(); } },
        text: kind === "all" ? "All" : KIND_LABEL[kind]
      });
    });
    var search = el("input", {
      type: "search",
      placeholder: "Search",
      value: state.query,
      "aria-label": "Search documents",
      on: { change: function (event) { state.query = event.target.value; loadList(); } }
    });
    return el("main", { class: "works-app" }, [
      el("h1", { text: "Works" }),
      el("div", { class: "works-actions" }, tabs.concat([search])),
      noticeNode(),
      trashedNode(),
      rows.length
        ? el("div", null, rows)
        : el("p", { class: "works-empty", text: state.busy ? "Loading…" : "No documents match this view." }),
      newDocumentView()
    ]);
  }

  function newDocumentView() {
    var draft = state.draft && state.draft.create ? state.draft.create : { kind: "doc", title: "", blocks: [{ type: "p", text: "" }], slides: [], columns: [], rows: [] };
    state.draft = { create: draft };
    var kindSelect = el("select", { name: "kind", "aria-label": "Kind", on: { change: function (e) {
      draft.kind = e.target.value;
      if (draft.kind === "sheet" && !draft.columns.length) draft.columns = ["Item"];
      if (draft.kind === "deck" && !draft.slides.length) draft.slides = [{ title: "", body: "" }];
      render();
    } } }, KINDS.map(function (kind) {
      var o = el("option", { value: kind, text: KIND_LABEL[kind] });
      if (kind === draft.kind) o.setAttribute("selected", "");
      return o;
    }));
    var title = el("input", { name: "title", placeholder: "Name", "aria-label": "Name", on: { input: function (e) { draft.title = e.target.value; } } });
    title.value = draft.title;
    var editor = kindEditor(draft.kind, draft, render);
    return el("div", { class: "works-form" }, [
      el("h2", { text: "New document" }),
      el("label", null, [el("span", { text: "Kind" }), kindSelect]),
      el("label", null, [el("span", { text: "Name" }), title]),
      editor,
      el("button", { type: "button", disabled: state.busy, text: "Create", on: { click: function () { createDocument(draft.kind, draft); } } })
    ]);
  }

  function detailView(item) {
    var draft = state.draft && state.draft.item === item.id ? state.draft.edit : draftFromItem(item);
    state.draft = { item: item.id, edit: draft };
    var title = el("input", { name: "title", "aria-label": "Name", on: { input: function (e) { draft.title = e.target.value; } } });
    title.value = draft.title;
    var editor = kindEditor(item.kind, draft, render);
    var exportable = item.exportState === "ready";
    var actions = el("div", { class: "works-actions" }, [
      el("button", { type: "button", disabled: state.busy, text: "Save", on: { click: function () { saveItem(item, draft); } } }),
      el("button", { type: "button", disabled: state.busy, text: "Request review", on: { click: function () { requestReview(item); } } }),
      el("button", { type: "button", disabled: state.busy || item.reviewStatus !== "pending", text: "Review", on: { click: function () { reviewItem(item); } } }),
      el("button", { type: "button", disabled: state.busy || !exportable, text: "Export", on: { click: function () { exportItem(item); } } }),
      el("button", { type: "button", disabled: state.busy, text: "Trash", on: { click: function () { trashItem(item); } } }),
      el("button", { type: "button", disabled: state.busy, text: "Refresh", on: { click: function () { loadItem(item.id); } } })
    ]);
    return el("main", { class: "works-app" }, [
      el("button", { type: "button", disabled: state.busy, text: "← Documents", on: { click: function () { state.view = "list"; state.draft = null; loadList(); } } }),
      el("h1", { text: item.title }),
      el("p", { text: (KIND_LABEL[item.kind] || item.kind) + " · r" + item.revision }),
      el("p", { text: reviewPresentation(item) }),
      el("p", { text: item.exportReason || (exportable ? "Export ready." : "Export blocked.") }),
      noticeNode(),
      el("div", { class: "works-form" }, [
        el("label", null, [el("span", { text: "Name" }), title]),
        editor
      ]),
      actions
    ]);
  }

  function render() {
    root.replaceChildren(state.view === "detail" && state.item ? detailView(state.item) : listView());
  }

  init();
  loadList();
})();
