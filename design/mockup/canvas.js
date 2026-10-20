/* Cadence · Works app — full user-flow mockup.
 * Static. No host calls, daemon calls or persistence. The flow bar is a
 * review control, not product chrome.
 */
(function () {
  "use strict";

  /* ------------------------------- theme ------------------------------- */

  var KEY = "cadence-theme";
  var themeBtn = document.getElementById("theme-toggle");
  var icons = {
    system: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor"/></svg>',
    light: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg>',
    dark: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z"/></svg>'
  };
  var next = { system: "light", light: "dark", dark: "system" };
  function pref() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) { return "system"; }
  }
  function paintTheme(p) {
    if (!themeBtn) return;
    themeBtn.innerHTML = icons[p];
    themeBtn.title = "theme: " + p + " — switch to " + next[p];
    themeBtn.setAttribute("aria-label", themeBtn.title);
  }
  paintTheme(document.documentElement.getAttribute("data-theme") || pref());
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var p = next[pref()];
    try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch (e) {}
    if (p === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", p);
    paintTheme(p);
  });

  /* -------------------------------- data -------------------------------- */

  var DOCS = [
    { id: "Q3 planning", kind: "deck", rev: 5, reviewed: 4, state: "edited", updated: "2m ago", owner: "you" },
    { id: "Q3 planning notes", kind: "doc", rev: 3, reviewed: 2, state: "edited", updated: "12m ago", owner: "you" },
    { id: "Q3 budget", kind: "sheet", rev: 2, reviewed: 1, state: "edited", updated: "28m ago", owner: "Jon" },
    { id: "Customer review", kind: "deck", rev: 2, reviewed: 2, state: "reviewed", updated: "1h ago", owner: "Mira" },
    { id: "Launch brief", kind: "doc", rev: 2, reviewed: 2, state: "reviewed", updated: "3h ago", owner: "Mira" },
    { id: "Board update", kind: "deck", rev: 3, reviewed: 3, state: "reviewed", updated: "4h ago", owner: "Mira" },
    { id: "Pipeline", kind: "sheet", rev: 5, reviewed: 5, state: "reviewed", updated: "yesterday", owner: "Sam" },
    { id: "Launch readout", kind: "deck", rev: 1, reviewed: 0, state: "draft", updated: "yesterday", owner: "you" },
    { id: "Decision log", kind: "doc", rev: 7, reviewed: 7, state: "reviewed", updated: "2d ago", owner: "Jon" },
    { id: "Assumptions", kind: "sheet", rev: 1, reviewed: 0, state: "draft", updated: "3d ago", owner: "Sam" }
  ];

  var CHAT = {
    deck: {
      user: "Tighten the Q3 narrative and add the retention chart. Keep it to one slide.",
      assistant: "I can do that in one revision. The chart uses the Q2 board numbers; the headline gets shorter.",
      items: [
        "<b>Headline</b> — “Three bets. One dependency.”",
        "<b>Add</b> — retention chart on slide 4",
        "<b>Keep</b> — scope and risk slides unchanged"
      ],
      activity: ["Read the Q2 board numbers", "Drafted the shorter headline", "Prepared the retention chart block"]
    },
    doc: {
      user: "Tighten the scope section and cite the Q2 retention source.",
      assistant: "I can do that in one revision. The citation goes in paragraph 2; the scope table stays unchanged.",
      items: [
        "<b>Cite</b> — Q2 retention source in paragraph 2",
        "<b>Tighten</b> — the scope paragraph",
        "<b>Keep</b> — the table and the decision callout"
      ],
      activity: ["Located the Q2 source", "Checked the brief language", "Prepared the citation"]
    },
    sheet: {
      user: "Add the Q3 plan column and flag the export-success risk.",
      assistant: "One revision adds the column and a review note on C4; the totals row stays unchanged.",
      items: [
        "<b>Add</b> — Q3 plan column",
        "<b>Flag</b> — export-success risk on C4",
        "<b>Keep</b> — the totals row"
      ],
      activity: ["Read the workbook", "Checked the column order", "Prepared the review note"]
    }
  };

  var DIFF = {
    deck: [
      ["changed", "Headline — “What we ship, what we cut.” → “Three bets. One dependency.”"],
      ["added", "Retention chart on slide 4"]
    ],
    doc: [
      ["changed", "Scope paragraph tightened"],
      ["added", "Q2 retention source cited in paragraph 2"]
    ],
    sheet: [
      ["changed", "Q3 plan column added"],
      ["added", "Export-success risk flagged on C4"]
    ]
  };

  var FORMATS = {
    deck: [["html", "HTML", "Interactive deck"], ["pdf", "PDF", "Print layout"], ["pptx", "PowerPoint", "Editable slides"]],
    doc: [["md", "Markdown", "Source text"], ["html", "HTML", "Web page"], ["pdf", "PDF", "Print layout"]],
    sheet: [["csv", "CSV", "Sheet data"], ["xlsx", "Excel", "Workbook"]]
  };

  var state = {
    screen: "documents",
    kind: "deck",
    doc: "Q3 planning",
    filter: "all",
    query: "",
    sort: "updated",
    newKind: "deck",
    exportFormat: "html",
    flow: "documents",
    returnFlow: "documents"
  };

  var $ = function (id) { return document.getElementById(id); };
  var appgrid = $("appgrid");
  var toastTimer = 0;

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function docById(id) {
    for (var i = 0; i < DOCS.length; i += 1) if (DOCS[i].id === id) return DOCS[i];
    return null;
  }
  function currentDoc() { return docById(state.doc) || DOCS[0]; }
  function docsForKind(kind) { return DOCS.filter(function (d) { return d.kind === kind; }); }
  function kindLabel(kind) { return kind === "deck" ? "Deck" : kind === "sheet" ? "Sheet" : "Doc"; }
  function kindPlural(kind) { return kind === "deck" ? "Decks" : kind === "sheet" ? "Sheets" : "Docs"; }
  function kindMark(kind) { return kind === "deck" ? "Dk" : kind === "sheet" ? "S" : "D"; }
  function toast(message) {
    var el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 180);
    }, 2600);
  }

  /* ------------------------------- flow -------------------------------- */

  function setFlowActive(flow) {
    state.flow = flow;
    Array.prototype.forEach.call(document.querySelectorAll(".flowstep"), function (btn) {
      btn.classList.toggle("on", btn.getAttribute("data-flow") === flow);
    });
    var active = document.querySelector(".flowstep.on");
    var steps = document.querySelector(".flowsteps");
    if (active && steps) {
      steps.scrollLeft = active.getBoundingClientRect().left - steps.getBoundingClientRect().left + steps.scrollLeft;
      steps.classList.toggle("scrolled", steps.scrollLeft > 0);
    }
  }

  function setScreen(screen) {
    state.screen = screen;
    Array.prototype.forEach.call(document.querySelectorAll("[data-screen]"), function (el) {
      el.classList.toggle("on", el.getAttribute("data-screen") === screen);
    });
    appgrid.classList.toggle("chat-collapsed", screen === "review");
    if (screen === "documents") {
      renderDocuments();
      renderChat();
    } else if (screen === "editor") {
      applyEditor();
      renderChat();
    } else if (screen === "review") {
      renderReview();
      renderChat();
    }
  }

  function setFlow(flow) {
    closeNew(true);
    closeExport(true);
    if (flow === "documents") {
      state.screen = "documents";
      setFlowActive("documents");
      setScreen("documents");
      return;
    }
    if (flow === "new") {
      state.screen = "documents";
      setFlowActive("new");
      setScreen("documents");
      openNew(state.kind);
      return;
    }
    if (flow === "review") {
      var reviewDoc = docById("Q3 planning");
      if (reviewDoc) { state.doc = reviewDoc.id; state.kind = reviewDoc.kind; }
      state.screen = "review";
      setFlowActive("review");
      setScreen("review");
      return;
    }
    if (flow === "export") {
      var exportDoc = docById("Q3 planning");
      if (exportDoc) { state.doc = exportDoc.id; state.kind = exportDoc.kind; }
      state.screen = "review";
      setFlowActive("export");
      setScreen("review");
      openExport();
      return;
    }
    var list = docsForKind(flow);
    if (list.length) {
      state.doc = list[0].id;
      state.kind = list[0].kind;
    }
    state.screen = "editor";
    setFlowActive(flow);
    setScreen("editor");
  }

  function openDoc(id) {
    var doc = docById(id);
    if (!doc) return;
    closeNew(true);
    closeExport(true);
    state.doc = doc.id;
    state.kind = doc.kind;
    state.screen = "editor";
    setFlowActive(doc.kind);
    setScreen("editor");
  }

  /* ----------------------------- documents ----------------------------- */

  function stateBadge(doc) {
    if (doc.state === "reviewed") return '<span class="badge b-ok">reviewed</span>';
    if (doc.state === "edited") return '<span class="badge b-warn">edited</span>';
    return '<span class="badge plain">draft</span>';
  }

  function renderDocuments() {
    var all = DOCS.length;
    var counts = { all: all, doc: docsForKind("doc").length, sheet: docsForKind("sheet").length, deck: docsForKind("deck").length };
    $("count-all").textContent = String(counts.all);
    $("count-doc").textContent = String(counts.doc);
    $("count-sheet").textContent = String(counts.sheet);
    $("count-deck").textContent = String(counts.deck);
    $("documents-meta").textContent = all + " documents · 3 kinds · Cadence context";
    Array.prototype.forEach.call(document.querySelectorAll(".filtertab"), function (tab) {
      tab.classList.toggle("on", tab.getAttribute("data-filter") === state.filter);
    });
    var search = $("doc-search");
    if (search && document.activeElement !== search) search.value = state.query;

    var list = DOCS.filter(function (doc) {
      if (state.filter !== "all" && doc.kind !== state.filter) return false;
      if (state.query && doc.id.toLowerCase().indexOf(state.query.toLowerCase()) === -1) return false;
      return true;
    });
    if (state.sort === "name") list.sort(function (a, b) { return a.id.localeCompare(b.id); });
    if (state.sort === "kind") list.sort(function (a, b) { return a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id); });

    var body = $("documents-body");
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6"><div class="empty"><span class="etitle">No documents match</span><span>Try a different kind or search.</span></div></td></tr>';
      return;
    }
    body.innerHTML = list.map(function (doc) {
      return '<tr class="docrow" data-doc="' + esc(doc.id) + '" tabindex="0">' +
        '<td><span class="docicon ' + doc.kind + '"></span><span class="docname">' + esc(doc.id) + "</span></td>" +
        '<td class="col-kind"><span class="chip plain">' + kindLabel(doc.kind) + "</span></td>" +
        '<td class="col-rev num">r' + doc.rev + "</td>" +
        "<td>" + stateBadge(doc) + "</td>" +
        '<td class="col-updated">' + esc(doc.updated) + "</td>" +
        '<td class="col-owner">' + esc(doc.owner) + "</td>" +
        "</tr>";
    }).join("");
  }

  /* ------------------------------ editor ------------------------------- */

  function reviewState(doc) {
    if (doc.reviewed === 0) {
      return { line: "Not reviewed · current r" + doc.rev + ".", sub: "This revision hasn’t been approved for export.", link: "Request review" };
    }
    return {
      line: "Reviewed r" + doc.reviewed + " · current r" + doc.rev + ".",
      sub: doc.rev === doc.reviewed ? "This is the reviewed revision." : "Edits after review aren’t approved for export.",
      link: "Request re-review"
    };
  }

  function renderDocMenu() {
    var html = "";
    ["deck", "doc", "sheet"].forEach(function (kind) {
      var list = docsForKind(kind);
      if (!list.length) return;
      html += '<div class="menu-label">' + kindPlural(kind) + "</div>";
      html += list.map(function (doc) {
        return '<button class="menu-item doc-item' + (doc.id === state.doc ? " on" : "") + '" type="button" data-doc="' + esc(doc.id) + '">' +
          '<span><span class="kindmark ' + kind + '">' + kindMark(kind) + "</span> " + esc(doc.id) + "</span>" +
          '<span class="num">r' + doc.rev + " · " + esc(doc.state) + "</span></button>";
      }).join("");
    });
    html += '<div class="menu-sep"></div><button class="menu-item" type="button" data-newdoc>+ New document</button>';
    $("docmenu").innerHTML = html;
  }

  function applyEditor(refreshChat) {
    var doc = currentDoc();
    $("docswitch-label").textContent = doc.id;
    $("doc-kind").textContent = kindLabel(doc.kind);
    $("doc-meta").textContent = "r" + doc.rev + " · " + doc.state + (doc.state === "edited" ? " 2m ago" : "");
    $("present").textContent = doc.kind === "deck" ? "Present" : doc.kind === "sheet" ? "Edit" : "Preview";
    var review = reviewState(doc);
    $("review-line").textContent = review.line;
    $("review-sub").textContent = review.sub;
    $("review-link").textContent = review.link;
    var blocked = doc.reviewed === 0 || doc.rev !== doc.reviewed;
    $("export").setAttribute("aria-disabled", blocked ? "true" : "false");
    $("export").title = blocked ? "Export is blocked until the current revision is reviewed" : "Export the reviewed revision";
    $("slide-rev").textContent = String(doc.rev);
    $("chat-scope").textContent = "Works · " + doc.id;
    var byline = $("docbyline");
    if (byline) byline.textContent = "Edited by you · just now · revision " + doc.rev + " · " + (doc.reviewed ? "reviewed revision " + doc.reviewed : "not reviewed");
    var saved = $("sheet-saved");
    if (saved) saved.textContent = "Auto-saved · r" + doc.rev;
    Array.prototype.forEach.call(document.querySelectorAll(".surface"), function (el) {
      el.classList.toggle("on", el.getAttribute("data-surface") === doc.kind);
    });
    renderDocMenu();
    if (refreshChat !== false) renderChat();
  }

  /* -------------------------------- chat -------------------------------- */

  function chatHeader(scope) {
    $("chat-scope").textContent = scope;
  }

  function activityList(items) {
    return items.map(function (item) { return '<div><span class="ok">✓</span> ' + esc(item) + "</div>"; }).join("");
  }

  function proposalCard(doc) {
    var chat = CHAT[doc.kind];
    var nextRev = doc.rev + 1;
    return '<div class="proposal" id="proposal">' +
      '<div class="proposalhead"><span class="badge b-acc">proposal</span><span class="num">r' + nextRev + "</span></div>" +
      "<ul>" + chat.items.map(function (item) { return "<li>" + item + "</li>"; }).join("") + "</ul>" +
      '<div class="proposalactions">' +
        '<button class="btn btn-acc btn-sm" type="button" data-apply>Apply as r' + nextRev + "</button>" +
        '<button class="btn btn-sm" type="button" data-discard>Discard</button>' +
      "</div>" +
      '<p class="proposalnote">Applying creates a new revision and invalidates the current review.</p>' +
    "</div>";
  }

  function renderChat() {
    var scroll = $("chatscroll");
    if (!scroll) return;
    if (state.screen === "documents") {
      chatHeader("Works · All documents");
      scroll.innerHTML =
        '<div class="msg assistant">What are we making? I can draft a doc, build a sheet, or compose a deck.</div>' +
        '<div class="suggestrow">' +
          '<button class="suggest" type="button" data-suggest="doc">New doc</button>' +
          '<button class="suggest" type="button" data-suggest="sheet">New sheet</button>' +
          '<button class="suggest" type="button" data-suggest="deck">New deck</button>' +
        "</div>";
      return;
    }
    var doc = currentDoc();
    chatHeader("Works · " + doc.id);
    if (state.screen === "review") {
      scroll.innerHTML = '<div class="msg assistant">Reviewing <b>' + esc(doc.id) + "</b> at r" + doc.rev + ". Approve the current revision in the panel, then export.</div>";
      return;
    }
    var chat = CHAT[doc.kind];
    scroll.innerHTML =
      '<div class="msg user">' + esc(chat.user) + "</div>" +
      '<div class="msg assistant">' + esc(chat.assistant) + "</div>" +
      proposalCard(doc) +
      '<div class="activity">' +
        '<button class="activity-toggle" id="activity-toggle" type="button" data-activity aria-expanded="false">' +
          '<span>Completed activity <span class="num">(' + chat.activity.length + ")</span></span>" +
          '<span class="chev" aria-hidden="true">▾</span>' +
        "</button>" +
        '<div class="activity-list" id="activity-list" hidden>' + activityList(chat.activity) + "</div>" +
      "</div>";
    scroll.scrollTop = 0;
  }

  /* ------------------------------- review ------------------------------- */

  function renderReview() {
    var doc = currentDoc();
    $("review-kicker").textContent = "review · " + kindLabel(doc.kind).toLowerCase();
    $("review-title").textContent = "Review " + doc.id;
    $("review-meta").textContent = "Reviewed r" + doc.reviewed + " · current r" + doc.rev + " · " + (doc.rev === doc.reviewed ? "no changes" : "2 changes");
    $("review-from").textContent = "r" + doc.reviewed;
    $("review-to").textContent = "r" + doc.rev;
    $("review-changes").textContent = doc.rev === doc.reviewed ? "No changes since review" : "2 blocks changed since review";
    Array.prototype.forEach.call(document.querySelectorAll(".review-preview"), function (el) {
      el.hidden = el.getAttribute("data-preview") !== doc.kind;
    });
    var diffs = doc.rev === doc.reviewed ? [] : DIFF[doc.kind];
    $("diff-list").innerHTML = diffs.length
      ? diffs.map(function (row) {
          return '<div class="diffrow"><span class="badge ' + (row[0] === "added" ? "b-acc" : "b-warn") + '">' + row[0] + "</span><span>" + row[1] + "</span></div>";
        }).join("")
      : '<div class="diffrow"><span class="badge b-ok">clean</span><span>No changes since the reviewed revision.</span></div>';
    var approved = doc.rev === doc.reviewed;
    var approveBtn = $("approve-full");
    if (approveBtn) {
      approveBtn.textContent = approved ? "Approved r" + doc.rev : "Approve r" + doc.rev;
      approveBtn.disabled = approved;
    }
    $("review-export-note").textContent = approved
      ? "Reviewed r" + doc.rev + " · ready to export."
      : "Export is blocked until the current revision is approved.";
    $("export-review").setAttribute("aria-disabled", approved ? "false" : "true");
  }

  function approveDoc() {
    var doc = currentDoc();
    doc.reviewed = doc.rev;
    doc.state = "reviewed";
    applyEditor(false);
    renderDocuments();
    renderReview();
    toast("Approved r" + doc.rev + " · export enabled");
  }

  /* -------------------------------- dialogs ----------------------------- */

  function showDialog(id, scrim) {
    var dialog = $(id);
    var layer = $(scrim);
    if (dialog) { dialog.hidden = false; dialog.setAttribute("aria-hidden", "false"); }
    if (layer) layer.hidden = false;
  }
  function hideDialog(id, scrim) {
    var dialog = $(id);
    var layer = $(scrim);
    if (dialog) { dialog.hidden = true; dialog.setAttribute("aria-hidden", "true"); }
    if (layer) layer.hidden = true;
  }

  function updateNewDialog() {
    Array.prototype.forEach.call(document.querySelectorAll("#newdialog [data-new-kind]"), function (el) {
      el.classList.toggle("on", el.getAttribute("data-new-kind") === state.newKind);
    });
    $("new-title").value = "Untitled " + kindLabel(state.newKind).toLowerCase();
    $("new-create").textContent = "Create " + kindLabel(state.newKind).toLowerCase();
  }

  function openNew(kind) {
    closeMenus();
    state.newKind = kind || state.kind;
    state.returnFlow = state.screen === "documents" ? "documents" : state.screen === "review" ? "review" : state.kind;
    updateNewDialog();
    showDialog("newdialog", "newscrim");
    setFlowActive("new");
    setTimeout(function () { $("new-title").focus(); $("new-title").select(); }, 30);
  }
  function closeNew(silent) {
    hideDialog("newdialog", "newscrim");
    if (!silent) setFlowActive(state.returnFlow);
  }
  function createNew() {
    var title = ($("new-title").value || "").trim() || "Untitled " + kindLabel(state.newKind).toLowerCase();
    var doc = {
      id: title,
      kind: state.newKind,
      rev: 1,
      reviewed: 0,
      state: "draft",
      updated: "just now",
      owner: "you"
    };
    DOCS.unshift(doc);
    state.doc = doc.id;
    state.kind = doc.kind;
    closeNew(true);
    setFlowActive(doc.kind);
    setScreen("editor");
    toast("Created " + title + " · r1 · draft");
  }

  function renderExportFormats() {
    var doc = currentDoc();
    var formats = FORMATS[doc.kind];
    var exists = formats.some(function (f) { return f[0] === state.exportFormat; });
    if (!exists) state.exportFormat = formats[0][0];
    $("formatcards").innerHTML = formats.map(function (f) {
      return '<button class="formatcard' + (f[0] === state.exportFormat ? " on" : "") + '" type="button" data-format="' + f[0] + '">' +
        "<b>" + f[1] + "</b><span>" + f[2] + "</span></button>";
    }).join("");
    $("notescheck").hidden = doc.kind !== "deck";
  }

  function renderExport() {
    var doc = currentDoc();
    var approved = doc.reviewed > 0 && doc.rev === doc.reviewed;
    $("exporttitle").textContent = "Export " + doc.id;
    $("export-state").className = "exportstate " + (approved ? "ready" : "blocked");
    $("export-state").innerHTML = approved
      ? '<span class="badge b-ok">reviewed r' + doc.rev + '</span><span>Ready to export the reviewed revision.</span>'
      : '<span class="badge b-warn">blocked</span><span>Current r' + doc.rev + " isn’t reviewed.</span><button class=\"lnk\" type=\"button\" data-go-review>Go to review</button>";
    $("export-note").textContent = approved
      ? "The file records reviewed revision r" + doc.rev + " and its review."
      : "Review the current revision before exporting. The reviewed revision is what gets downloaded.";
    $("export-download").textContent = approved ? "Download reviewed r" + doc.rev : "Export blocked";
    $("export-download").setAttribute("aria-disabled", approved ? "false" : "true");
    renderExportFormats();
  }

  function openExport() {
    state.returnFlow = state.screen === "review" ? "review" : state.screen === "editor" ? state.kind : "documents";
    renderExport();
    showDialog("exportdialog", "exportscrim");
    setFlowActive("export");
  }
  function closeExport(silent) {
    hideDialog("exportdialog", "exportscrim");
    if (!silent) setFlowActive(state.returnFlow);
  }
  function downloadExport() {
    var doc = currentDoc();
    if ($("export-download").getAttribute("aria-disabled") === "true") {
      toast("Export blocked · r" + doc.rev + " isn’t the reviewed revision.");
      return;
    }
    var selected = $("formatcards .formatcard.on");
    var label = selected ? selected.querySelector("b").textContent : state.exportFormat;
    toast("Downloaded " + label + " · reviewed r" + doc.rev + " · mockup");
    closeExport();
  }

  /* ------------------------------- menus -------------------------------- */

  var menuPairs = [
    ["new-split", "new-menu"],
    ["sort-btn", "sort-menu"],
    ["docswitch", "docmenu"],
    ["ws-more", "ws-menu"],
    ["add-block", "add-menu"]
  ];
  function closeMenus(except) {
    menuPairs.forEach(function (pair) {
      var menu = $(pair[1]);
      if (!menu || menu === except) return;
      menu.hidden = true;
      var btn = $(pair[0]);
      if (btn) btn.setAttribute("aria-expanded", "false");
    });
  }
  function toggleMenu(btn, menu) {
    var open = menu.hidden;
    closeMenus(open ? menu : null);
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  menuPairs.forEach(function (pair) {
    var btn = $(pair[0]);
    var menu = $(pair[1]);
    if (btn && menu) btn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleMenu(btn, menu);
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".menu-wrap")) closeMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeMenus();
    if (!$("newdialog").hidden) closeNew();
    else if (!$("exportdialog").hidden) closeExport();
    else if (window.innerWidth <= 1100) closeChat();
  });

  $("sort-menu").addEventListener("click", function (e) {
    var item = e.target.closest("[data-sort]");
    if (!item) return;
    state.sort = item.getAttribute("data-sort");
    $("sort-btn").firstChild.textContent = item.textContent.trim() + " ";
    closeMenus();
    renderDocuments();
  });
  $("docmenu").addEventListener("click", function (e) {
    var item = e.target.closest(".doc-item");
    if (item) { closeMenus(); openDoc(item.getAttribute("data-doc")); return; }
    if (e.target.closest("[data-newdoc]")) { closeMenus(); openNew(state.kind); }
  });
  Array.prototype.forEach.call(document.querySelectorAll("#ws-menu .menu-item"), function (item) {
    item.addEventListener("click", function () {
      closeMenus();
      if (item.classList.contains("danger")) toast("Delete requires an explicit confirmation.");
      else toast(item.textContent.trim() + " · mockup");
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#add-menu .menu-item"), function (item) {
    item.addEventListener("click", function () {
      closeMenus();
      toast("Added " + item.textContent.trim() + " · mockup");
    });
  });

  /* ------------------------------ actions ------------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll("[data-new-kind]"), function (el) {
    if (el.closest("#newdialog")) return;
    el.addEventListener("click", function () {
      openNew(el.getAttribute("data-new-kind"));
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#newdialog [data-new-kind]"), function (el) {
    el.addEventListener("click", function () {
      state.newKind = el.getAttribute("data-new-kind");
      updateNewDialog();
    });
  });
  $("new-close").addEventListener("click", function () { closeNew(); });
  $("new-cancel").addEventListener("click", function () { closeNew(); });
  $("newscrim").addEventListener("click", function () { closeNew(); });
  $("new-create").addEventListener("click", createNew);
  $("export-close").addEventListener("click", function () { closeExport(); });
  $("export-cancel").addEventListener("click", function () { closeExport(); });
  $("exportscrim").addEventListener("click", function () { closeExport(); });
  $("export-download").addEventListener("click", downloadExport);
  $("export-state").addEventListener("click", function (e) {
    if (!e.target.closest("[data-go-review]")) return;
    closeExport(true);
    state.screen = "review";
    setFlowActive("review");
    setScreen("review");
  });
  $("formatcards").addEventListener("click", function (e) {
    var card = e.target.closest("[data-format]");
    if (!card) return;
    state.exportFormat = card.getAttribute("data-format");
    renderExportFormats();
  });

  $("present").addEventListener("click", function () { toast($("present").textContent + " mode · mockup"); });
  $("export").addEventListener("click", function () {
    openExport();
  });
  $("review-link").addEventListener("click", function () {
    state.screen = "review";
    setFlowActive("review");
    setScreen("review");
  });
  $("back-editor").addEventListener("click", function () {
    setFlow(currentDoc().kind);
  });
  $("approve-full").addEventListener("click", approveDoc);
  $("request-changes").addEventListener("click", function () {
    toast("Changes requested · revision stays at r" + currentDoc().rev);
  });
  $("export-review").addEventListener("click", function () {
    openExport();
  });
  $("add-slide").addEventListener("click", function () { toast("Add slide · mockup"); });

  /* ------------------------------- slides ------------------------------- */

  var SLIDES = [
    { k: "Q3 · 2026", t: "What we ship,<br>what we cut.", s: "A working plan for the next eight weeks.", n: "01" },
    { k: "Why now", t: "Eight weeks,<br>not a quarter.", s: "Three bets, one dependency, no new headcount.", n: "02" },
    { k: "Scope", t: "Three things ship.<br>Two wait.", s: "Retention chart, deck export, review trail. Pricing and mobile wait.", n: "03" },
    { k: "Metrics", t: "One number<br>per bet.", s: "Activation, review time, export success.", n: "04" },
    { k: "Risks", t: "The dependency<br>is the date.", s: "PPTX parity and host-side export are the long poles.", n: "05" },
    { k: "Decision", t: "Approve the<br>scope today.", s: "Review r5, then export.", n: "06" }
  ];
  var thumbs = Array.prototype.slice.call(document.querySelectorAll(".thumb[data-slide]"));
  function selectSlide(index) {
    var data = SLIDES[index];
    if (!data) return;
    thumbs.forEach(function (btn, i) {
      btn.classList.toggle("on", i === index);
      if (i === index) btn.setAttribute("aria-current", "true"); else btn.removeAttribute("aria-current");
    });
    $("slide-kicker").textContent = data.k;
    $("slide-title").innerHTML = data.t;
    $("slide-sub").textContent = data.s;
    $("slide-num").textContent = data.n + " / 06";
    $("slide-watermark").textContent = data.n;
  }
  thumbs.forEach(function (btn) {
    btn.addEventListener("click", function () { selectSlide(Number(btn.getAttribute("data-slide"))); });
  });

  /* ----------------------------- documents UI --------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll(".filtertab"), function (tab) {
    tab.addEventListener("click", function () {
      state.filter = tab.getAttribute("data-filter");
      renderDocuments();
    });
  });
  $("doc-search").addEventListener("input", function () {
    state.query = this.value.trim();
    renderDocuments();
  });
  $("documents-body").addEventListener("click", function (e) {
    var row = e.target.closest(".docrow");
    if (row) openDoc(row.getAttribute("data-doc"));
  });
  $("documents-body").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest(".docrow");
    if (!row) return;
    e.preventDefault();
    openDoc(row.getAttribute("data-doc"));
  });

  /* --------------------------------- chat -------------------------------- */

  var chat = $("chatpanel"), chatScrim = $("chatscrim");
  function openChat() {
    if (window.innerWidth <= 1100) {
      chat.classList.add("open");
      chatScrim.hidden = false;
      return;
    }
    appgrid.classList.remove("chat-collapsed");
    var input = $("composer");
    if (input) input.focus();
  }
  function closeChat() {
    chat.classList.remove("open");
    chatScrim.hidden = true;
  }
  $("ask").addEventListener("click", openChat);
  $("chat-collapse").addEventListener("click", function () {
    if (window.innerWidth <= 1100) closeChat();
    else appgrid.classList.add("chat-collapsed");
  });
  chatScrim.addEventListener("click", closeChat);

  $("chatscroll").addEventListener("click", function (e) {
    var suggest = e.target.closest("[data-suggest]");
    if (suggest) { openNew(suggest.getAttribute("data-suggest")); return; }
    var apply = e.target.closest("[data-apply]");
    if (apply) {
      var doc = currentDoc();
      doc.rev = doc.rev + 1;
      doc.state = "edited";
      applyEditor(false);
      renderDocuments();
      renderReview();
      var proposal = $("proposal");
      if (proposal) proposal.remove();
      appendMessage("assistant", "Applied as r" + doc.rev + ". The previous review is now stale — request a new review before export.");
      toast("Applied r" + doc.rev + " · previous review invalidated");
      return;
    }
    var discard = e.target.closest("[data-discard]");
    if (discard) {
      var card = $("proposal");
      if (card) card.remove();
      appendMessage("assistant", "Proposal discarded. The document is unchanged at r" + currentDoc().rev + ".");
      toast("Proposal discarded · no revision created");
      return;
    }
    var toggle = e.target.closest("[data-activity]");
    if (toggle) {
      var list = $("activity-list");
      if (!list) return;
      var open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  });

  function appendMessage(role, text) {
    var scroll = $("chatscroll");
    var el = document.createElement("div");
    el.className = "msg " + role;
    el.textContent = text;
    scroll.appendChild(el);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function sendMessage() {
    var input = $("composer");
    if (!input || !input.value.trim()) return;
    appendMessage("user", input.value.trim());
    input.value = "";
    setTimeout(function () {
      appendMessage("assistant", "In the real app this becomes a bounded proposal: apply creates a revision, discard leaves the document untouched.");
    }, 420);
  }
  $("send").addEventListener("click", sendMessage);
  $("composer").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendMessage();
  });

  /* --------------------------------- flow bar ---------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll(".flowstep"), function (step) {
    step.addEventListener("click", function () { setFlow(step.getAttribute("data-flow")); });
  });

  /* ---------------------------------- boot -------------------------------- */

  var query = null;
  try { query = new URLSearchParams(location.search); } catch (e) {}
  if (query && query.get("approved") === "1") {
    var approvedDoc = docById("Q3 planning");
    if (approvedDoc) { approvedDoc.reviewed = approvedDoc.rev; approvedDoc.state = "reviewed"; }
  }
  var start = query ? query.get("flow") || "documents" : "documents";
  if (start === "new") {
    state.screen = "documents";
    setScreen("documents");
    openNew(state.kind);
    setFlowActive("new");
  } else if (start === "export") {
    state.doc = "Q3 planning";
    state.kind = "deck";
    state.screen = "review";
    setScreen("review");
    openExport();
    setFlowActive("export");
  } else if (start === "review") {
    state.doc = "Q3 planning";
    state.kind = "deck";
    state.screen = "review";
    setFlowActive("review");
    setScreen("review");
  } else if (start === "deck" || start === "doc" || start === "sheet") {
    var first = docsForKind(start)[0];
    if (first) { state.doc = first.id; state.kind = first.kind; }
    state.screen = "editor";
    setFlowActive(start);
    setScreen("editor");
  } else {
    state.screen = "documents";
    setFlowActive("documents");
    setScreen("documents");
  }
  var flowsteps = document.querySelector(".flowsteps");
  if (flowsteps) flowsteps.addEventListener("scroll", function () {
    flowsteps.classList.toggle("scrolled", flowsteps.scrollLeft > 0);
  });
  window.addEventListener("load", function () { setFlowActive(state.flow); });
  if (query && query.get("apply") === "1") setTimeout(function () {
    var button = document.querySelector("[data-apply]");
    if (button) button.click();
  }, 60);
  if (query && query.get("create") === "1") setTimeout(function () {
    var button = document.getElementById("new-create");
    if (button) button.click();
  }, 60);
})();
