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
  var REVIEW_LABEL = { draft: "Draft", edited: "Edited since review", reviewed: "Reviewed" };
  // The host's closed Works refusal vocabulary (store codes carried through the bridge).
  var REFUSAL_TEXT = {
    invalid: "The host refused this request as invalid.",
    forbidden: "Your verified role cannot perform this action.",
    not_found: "This Works item was not found.",
    conflict: "This item changed since you opened it. Reload and try again.",
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
    busy: false
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
      render();
    }, fail);
  }

  function createDocument(form) {
    var title = form.title.value.trim();
    if (!title) {
      state.notice = { kind: "refused", text: "Give the document a name." };
      render();
      return;
    }
    var kind = form.kind.value;
    var body = form.content.value.trim();
    setBusy(true);
    call("works.create", { kind: kind, title: title, content: contentFor(kind, body) })
      .then(function (created) {
        receipt("Created " + title + ".");
        return loadItem(created && created.id);
      }, fail);
  }

  // Shape a plain body into the kind's verified content grammar.
  // Doc = blocks, deck = slides, sheet = columns and rows.
  function contentFor(kind, body) {
    if (kind === "doc") return { blocks: body ? [{ type: "p", text: body }] : [] };
    if (kind === "deck") return { slides: body ? [{ title: body.split("\n")[0], body: body }] : [] };
    return { columns: ["Item"], rows: [] };
  }

  // Patch uses the verified grammar: set_title only.
  function patchDocument(item, form) {
    var title = form.title.value.trim();
    if (!title) {
      state.notice = { kind: "refused", text: "Give the document a name." };
      render();
      return;
    }
    setBusy(true);
    call("works.patch", {
      id: item.id,
      if_revision: item.revision,
      operations: [{ type: "set_title", title: title }]
    }).then(function () {
      receipt("Saved.");
      return loadItem(item.id);
    }, fail);
  }

  function requestReview(item) {
    setBusy(true);
    call("works.request_review", { id: item.id, revision: item.revision })
      .then(function () {
        receipt("Review requested for revision " + item.revision + ".");
        return loadItem(item.id);
      }, fail);
  }

  // Trash is soft. The item leaves the list; its id is kept so Restore stays reachable.
  function trashItem(item) {
    setBusy(true);
    call("works.trash", { id: item.id, if_revision: item.revision })
      .then(function () {
        state.trashed = { id: item.id, title: item.title, revision: item.revision };
        state.view = "list";
        receipt("Moved " + item.title + " to trash.");
        return loadList();
      }, fail);
  }

  // Restore needs the trashed revision the host last reported.
  function restoreItem(trashed) {
    setBusy(true);
    call("works.restore", { id: trashed.id, if_revision: trashed.revision })
      .then(function () {
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

  function newDocumentForm() {
    var kindSelect = el("select", { name: "kind" }, KINDS.map(function (kind) {
      return el("option", { value: kind, text: KIND_LABEL[kind] });
    }));
    var title = el("input", { name: "title", placeholder: "Name", required: true });
    var content = el("textarea", { name: "content", placeholder: "Body (doc or deck first slide)" });
    var form = el("form", { class: "works-form", on: {
      submit: function (event) {
        event.preventDefault();
        createDocument(form);
      }
    } }, [
      el("h2", { text: "New document" }),
      el("label", null, [el("span", { text: "Kind" }), kindSelect]),
      el("label", null, [el("span", { text: "Name" }), title]),
      el("label", null, [el("span", { text: "Content" }), content]),
      el("button", { type: "submit", disabled: state.busy, text: "Create" })
    ]);
    form.kind = kindSelect;
    form.title = title;
    form.content = content;
    return form;
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
      newDocumentForm()
    ]);
  }

  function detailView(item) {
    var editForm = el("form", { class: "works-form", on: {
      submit: function (event) {
        event.preventDefault();
        patchDocument(item, editForm);
      }
    } }, [
      el("label", null, [el("span", { text: "Name" }), el("input", { name: "title", value: item.title })]),
      el("button", { type: "submit", disabled: state.busy, text: "Save title" })
    ]);
    editForm.title = editForm.querySelector("input[name=title]");
    var exportable = item.exportState === "ready";
    var actions = el("div", { class: "works-actions" }, [
      el("button", { type: "button", disabled: state.busy, text: "Request review", on: { click: function () { requestReview(item); } } }),
      el("button", { type: "button", disabled: state.busy || item.reviewStatus !== "pending", text: "Review", on: { click: function () { reviewItem(item); } } }),
      el("button", { type: "button", disabled: state.busy || !exportable, text: "Export", on: { click: function () { exportItem(item); } } }),
      el("button", { type: "button", disabled: state.busy, text: "Trash", on: { click: function () { trashItem(item); } } })
    ]);
    return el("main", { class: "works-app" }, [
      el("button", { type: "button", disabled: state.busy, text: "← Documents", on: { click: function () { state.view = "list"; loadList(); } } }),
      el("h1", { text: item.title }),
      el("p", { text: (KIND_LABEL[item.kind] || item.kind) + " · r" + item.revision + " · " + (REVIEW_LABEL[item.reviewState] || item.reviewState) }),
      el("p", { text: item.exportReason || (exportable ? "Export ready." : "Export blocked.") }),
      noticeNode(),
      editForm,
      actions
    ]);
  }

  function render() {
    root.replaceChildren(state.view === "detail" && state.item ? detailView(state.item) : listView());
  }

  init();
  loadList();
})();
