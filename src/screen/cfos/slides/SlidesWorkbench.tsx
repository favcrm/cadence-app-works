// Ported from cloudflare-os workspace-slides/files/client.ts

import { useEffect, useRef } from "react";
import type { DeckSlide } from "../../domain/works";
import { el, icon } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { extractBulletItems, formatAsBullets, isBulletSlide, makeSlideTemplate, type SlideTemplateKind } from "./codec";

export interface SlidesLabels {
  searchSlides: string;
  addSlide: string;
  addLayoutTitle: string;
  tplCover: string;
  tplCoverDesc: string;
  tplContent: string;
  tplContentDesc: string;
  tplBullets: string;
  tplBulletsDesc: string;
  prevSlide: string;
  nextSlide: string;
  jumpToSlide: string;
  undo: string;
  redo: string;
  editMode: string;
  presentMode: string;
  exitPresent: string;
  duplicateSlide: string;
  deleteSlide: string;
  inspectorTitle: string;
  fieldTitle: string;
  fieldBody: string;
  fieldNotes: string;
  formatBullets: string;
  slideSection: string;
  slideEyebrow: string;
}

export function SlidesWorkbench({
  slides,
  readOnly,
  resetKey,
  labels,
  onChange,
}: {
  slides: readonly DeckSlide[];
  readOnly: boolean;
  resetKey: number;
  labels: SlidesLabels;
  onChange: (next: DeckSlide[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialRef = useRef<DeckSlide[]>(slides.map((s) => ({ ...s })));
  initialRef.current = slides.map((s) => ({ ...s }));

  useEffect(() => {
    const mount = hostRef.current;
    if (!mount) return;
    mount.innerHTML = "";

    let deck: DeckSlide[] = initialRef.current.length
      ? initialRef.current.map((s) => ({ ...s }))
      : [makeSlideTemplate("cover", 0)];
    let currentIndex = 0;
    let editMode = !readOnly;
    let presenting = false;
    let slideSearch = "";
    const undoStack: DeckSlide[][] = [];
    const redoStack: DeckSlide[][] = [];

    const cloneDeck = (d: readonly DeckSlide[]) => d.map((s) => ({ ...s }));
    const emit = () => onChangeRef.current(cloneDeck(deck));

    const pushUndo = () => {
      undoStack.push(cloneDeck(deck));
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      updateUndoBtns();
    };

    const root = el("div", { class: "cfos-slides-root" });

    // ---- Left panel (thumbnails + search + add slide) ----
    const leftPanel = el("div", { class: "cfos-slides-left" });
    const searchInput = el("input", {
      class: "cfos-slides-search-input",
      placeholder: labels.searchSlides,
      "aria-label": labels.searchSlides,
    });
    const searchWrap = el("div", { class: "cfos-slides-search" }, [
      el("span", { class: "cfos-slides-search-ico", html: icon(ICONS.search, 14) }),
      searchInput,
    ]);
    const slideList = el("div", { class: "cfos-slides-list" });
    const leftFooter = el("div", { class: "cfos-slides-left-footer" });
    const addMenu = el("div", { class: "cfos-add-slide-menu" });

    const closeAddMenu = () => {
      addMenu.style.display = "none";
    };

    const addOption = (name: string, desc: string, kind: SlideTemplateKind) => {
      const btn = el(
        "button",
        {
          type: "button",
          class: "cfos-add-slide-opt",
          onclick: (e: Event) => {
            e.stopPropagation();
            closeAddMenu();
            insertSlide(kind);
          },
        },
        [el("span", { class: "opt-name", text: name }), el("span", { class: "opt-desc", text: desc })],
      );
      addMenu.appendChild(btn);
    };
    addOption(labels.tplCover, labels.tplCoverDesc, "cover");
    addOption(labels.tplContent, labels.tplContentDesc, "content");
    addOption(labels.tplBullets, labels.tplBulletsDesc, "bullets");

    const addControl = el("div", { class: "cfos-add-control" });
    const addDefault = el("button", {
      type: "button",
      class: "cfos-add-default",
      title: labels.addSlide,
      onclick: () => insertSlide("content"),
      html: `${icon(ICONS.plus, 14)}<span>${labels.addSlide}</span>`,
    });
    const addCaret = el("button", {
      type: "button",
      class: "cfos-add-caret",
      title: labels.addLayoutTitle,
      "aria-label": labels.addLayoutTitle,
      onclick: (e: Event) => {
        e.stopPropagation();
        addMenu.style.display = addMenu.style.display === "flex" ? "none" : "flex";
      },
      html: icon(ICONS.chevronDown, 14),
    });
    addControl.append(addDefault, addCaret);
    leftFooter.append(addMenu, addControl);
    leftPanel.append(searchWrap, slideList, leftFooter);

    // ---- Center stage ----
    const stageWrap = el("div", { class: "cfos-stage-wrap" });
    const stage = el("div", { class: "cfos-stage" });
    stageWrap.appendChild(stage);

    // ---- Right inspector ----
    const rightPanel = el("div", { class: "cfos-slides-right" });
    const inspectorBody = el("div", { class: "cfos-slides-inspector" });
    rightPanel.appendChild(inspectorBody);

    // ---- Floating control bar ----
    const bar = el("div", { class: "cfos-slides-bar" });
    const pillBtn = (svg: string, title: string, onClick: EventListener) =>
      el("button", {
        type: "button",
        class: "cfos-pill-btn",
        title,
        "aria-label": title,
        onclick: onClick,
        html: icon(svg, 16),
      });

    const prevBtn = pillBtn(ICONS.chevronLeft, labels.prevSlide, () => go(currentIndex - 1));
    const counterBtn = el("button", {
      type: "button",
      class: "cfos-pill-counter",
      title: labels.jumpToSlide,
      onclick: (e: Event) => {
        e.stopPropagation();
        toggleJumpMenu();
      },
    });
    const nextBtn = pillBtn(ICONS.chevronRight, labels.nextSlide, () => go(currentIndex + 1));
    const undoBtn = pillBtn(ICONS.undo, labels.undo, () => doUndo());
    const redoBtn = pillBtn(ICONS.redo, labels.redo, () => doRedo());
    const undoDiv = el("div", { class: "cfos-pill-div" });
    const editBtn = pillBtn(ICONS.pencil, labels.editMode, () => toggleEdit());
    const presentBtn = pillBtn(ICONS.expand, labels.presentMode, () => togglePresent());

    bar.append(prevBtn, counterBtn, nextBtn, el("div", { class: "cfos-pill-div" }));
    if (!readOnly) {
      bar.append(undoBtn, redoBtn, undoDiv, editBtn);
    }
    bar.append(presentBtn);

    const exitPresentBtn = el("button", {
      type: "button",
      class: "cfos-exit-present",
      title: labels.exitPresent,
      "aria-label": labels.exitPresent,
      onclick: () => togglePresent(),
      html: icon(ICONS.collapse, 16),
    });

    const jumpMenu = el("div", { class: "cfos-jump-menu" });
    stageWrap.append(bar, exitPresentBtn, jumpMenu);

    root.append(leftPanel, stageWrap, rightPanel);
    mount.appendChild(root);

    function renderSlideFrame(slide: DeckSlide, index: number, interactive: boolean): HTMLDivElement {
      const isCover = index === 0 && !isBulletSlide(slide.body) && slide.body.length < 180;
      const frame = el("div", {
        class: `cfos-slide-canvas ${isCover ? "is-cover" : "is-content"}`,
      });

      if (isCover) {
        const bgDecor = el("div", { class: "cfos-cover-art" });
        const brand = el("div", { class: "cfos-slide-brand" }, [
          el("span", { text: "Works" }),
          el("span", { class: "cfos-brand-dot" }),
        ]);
        const titleEl = el("div", {
          class: "cfos-cover-title",
          text: slide.title,
          contenteditable: interactive && editMode ? "true" : undefined,
        });
        const bodyEl = el("div", {
          class: "cfos-cover-subtitle",
          text: slide.body,
          contenteditable: interactive && editMode ? "true" : undefined,
        });
        if (interactive && editMode) {
          bindInline(titleEl, index, "title");
          bindInline(bodyEl, index, "body");
        }
        frame.append(bgDecor, brand, titleEl, bodyEl);
      } else {
        const eyebrow = el("div", {
          class: "cfos-slide-eyebrow",
          text: `${labels.slideEyebrow} ${index + 1}`,
        });
        const brand = el("div", { class: "cfos-slide-brand dark" }, [
          el("span", { text: "Works" }),
          el("span", { class: "cfos-brand-dot" }),
        ]);
        const titleEl = el("div", {
          class: "cfos-content-title",
          text: slide.title,
          contenteditable: interactive && editMode ? "true" : undefined,
        });
        if (interactive && editMode) bindInline(titleEl, index, "title");

        let bodyNode: HTMLElement;
        if (isBulletSlide(slide.body) && !(interactive && editMode)) {
          const ul = el("ul", { class: "cfos-slide-bullets" });
          for (const item of extractBulletItems(slide.body)) {
            ul.appendChild(
              el("li", {}, [el("span", { class: "cfos-bullet-dot" }), el("span", { text: item })]),
            );
          }
          bodyNode = ul;
        } else {
          bodyNode = el("div", {
            class: "cfos-content-body",
            text: slide.body,
            contenteditable: interactive && editMode ? "true" : undefined,
          });
          if (interactive && editMode) bindInline(bodyNode, index, "body");
        }
        const bottomBar = el("div", { class: "cfos-slide-bottom-bar" });
        frame.append(eyebrow, brand, titleEl, bodyNode, bottomBar);
      }
      return frame;
    }

    function bindInline(node: HTMLElement, idx: number, field: "title" | "body") {
      node.addEventListener("blur", () => {
        const nextVal = node.innerText.trim();
        const current = deck[idx];
        if (!current || !nextVal || nextVal === current[field]) return;
        pushUndo();
        current[field] = nextVal;
        renderList();
        renderInspector();
        emit();
      });
    }

    function renderStage() {
      const slide = deck[currentIndex];
      if (!slide) return;
      stage.replaceChildren(renderSlideFrame(slide, currentIndex, true));
      counterBtn.textContent = `${currentIndex + 1} / ${deck.length}`;
      prevBtn.disabled = currentIndex === 0;
      nextBtn.disabled = currentIndex >= deck.length - 1;
    }

    function renderList() {
      slideList.innerHTML = "";
      const q = slideSearch.trim().toLowerCase();
      deck.forEach((slide, idx) => {
        if (
          q &&
          !slide.title.toLowerCase().includes(q) &&
          !slide.body.toLowerCase().includes(q) &&
          !(slide.notes ?? "").toLowerCase().includes(q)
        ) {
          return;
        }
        const row = el("div", {
          class: "cfos-thumb-row" + (idx === currentIndex ? " active" : ""),
          draggable: !q && !readOnly ? "true" : undefined,
          onclick: () => go(idx),
        });
        const thumbWrap = el("div", { class: "cfos-thumb-frame" });
        const frame = renderSlideFrame(slide, idx, false);
        const scale = 156 / 1200;
        frame.style.transform = `scale(${scale})`;
        frame.style.transformOrigin = "0 0";
        thumbWrap.appendChild(frame);

        const actions = el("div", { class: "cfos-thumb-actions" }, [
          el("button", {
            type: "button",
            class: "cfos-thumb-btn",
            title: labels.duplicateSlide,
            "aria-label": labels.duplicateSlide,
            html: icon(ICONS.duplicate, 12),
            onclick: (e: Event) => {
              e.stopPropagation();
              duplicateAt(idx);
            },
          }),
          deck.length > 1
            ? el("button", {
                type: "button",
                class: "cfos-thumb-btn danger",
                title: labels.deleteSlide,
                "aria-label": labels.deleteSlide,
                html: icon(ICONS.trash, 12),
                onclick: (e: Event) => {
                  e.stopPropagation();
                  deleteAt(idx);
                },
              })
            : null,
        ]);

        const meta = el("div", { class: "cfos-thumb-meta" }, [
          el("span", { class: "cfos-thumb-num", text: String(idx + 1) }),
          el("span", { class: "cfos-thumb-title", text: slide.title }),
        ]);

        if (!q && !readOnly) {
          row.addEventListener("dragstart", (e) => {
            e.dataTransfer?.setData("text/plain", String(idx));
          });
          row.addEventListener("dragover", (e) => {
            e.preventDefault();
          });
          row.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer?.getData("text/plain"));
            if (!Number.isInteger(from) || from === idx || from < 0 || from >= deck.length) return;
            pushUndo();
            const [moved] = deck.splice(from, 1);
            deck.splice(idx, 0, moved!);
            currentIndex = idx;
            renderAll();
            emit();
          });
        }

        row.append(thumbWrap, actions, meta);
        slideList.appendChild(row);
      });
    }

    function renderInspector() {
      inspectorBody.innerHTML = "";
      if (!editMode || readOnly) return;
      const slide = deck[currentIndex];
      if (!slide) return;

      const titleInput = el("input", {
        class: "cfos-insp-input",
        value: slide.title,
        "aria-label": labels.fieldTitle,
      });
      const bodyArea = el("textarea", {
        class: "cfos-insp-textarea",
        rows: "6",
        "aria-label": labels.fieldBody,
      });
      bodyArea.value = slide.body;
      const notesArea = el("textarea", {
        class: "cfos-insp-textarea",
        rows: "3",
        "aria-label": labels.fieldNotes,
      });
      notesArea.value = slide.notes ?? "";

      let committedUndo = false;
      const ensureUndo = () => {
        if (!committedUndo) {
          pushUndo();
          committedUndo = true;
        }
      };

      titleInput.addEventListener("input", () => {
        ensureUndo();
        slide.title = titleInput.value;
        renderStage();
        renderList();
        emit();
      });
      bodyArea.addEventListener("input", () => {
        ensureUndo();
        slide.body = bodyArea.value;
        renderStage();
        renderList();
        emit();
      });
      notesArea.addEventListener("input", () => {
        ensureUndo();
        const v = notesArea.value;
        if (v.trim()) slide.notes = v;
        else delete slide.notes;
        emit();
      });
      for (const field of [titleInput, bodyArea, notesArea]) {
        field.addEventListener("blur", () => {
          committedUndo = false;
        });
      }

      const bulletHelper = el("button", {
        type: "button",
        class: "cfos-insp-btn",
        text: labels.formatBullets,
        onclick: () => {
          pushUndo();
          slide.body = formatAsBullets(slide.body);
          bodyArea.value = slide.body;
          renderStage();
          renderList();
          emit();
        },
      });

      inspectorBody.append(
        el("div", { class: "cfos-insp-head", text: `${labels.inspectorTitle} · ${currentIndex + 1}` }),
        el("label", { class: "cfos-insp-field" }, [
          el("span", { text: labels.fieldTitle }),
          titleInput,
        ]),
        el("label", { class: "cfos-insp-field" }, [
          el("span", { text: labels.fieldBody }),
          bodyArea,
        ]),
        bulletHelper,
        el("label", { class: "cfos-insp-field" }, [
          el("span", { text: labels.fieldNotes }),
          notesArea,
        ]),
      );
    }

    function updateChrome() {
      leftPanel.style.display = editMode && !presenting && !readOnly ? "flex" : "none";
      rightPanel.style.display = editMode && !presenting && !readOnly ? "flex" : "none";
      bar.style.display = presenting ? "none" : "flex";
      exitPresentBtn.style.display = presenting ? "inline-flex" : "none";
      root.classList.toggle("is-presenting", presenting);
      editBtn.classList.toggle("active", editMode);
      undoBtn.style.display = editMode && !readOnly ? "inline-flex" : "none";
      redoBtn.style.display = editMode && !readOnly ? "inline-flex" : "none";
      undoDiv.style.display = editMode && !readOnly ? "block" : "none";
      requestAnimationFrame(fit);
    }

    function fit() {
      const w = stageWrap.clientWidth;
      const h = stageWrap.clientHeight;
      if (!w || !h) return;
      const scale = presenting ? Math.min(w / 1200, h / 675) : Math.min((w - 40) / 1200, (h - 96) / 675);
      stage.style.transform = `translate(-50%, -50%) scale(${Math.max(0.15, scale)})`;
    }

    function updateUndoBtns() {
      undoBtn.disabled = undoStack.length === 0;
      redoBtn.disabled = redoStack.length === 0;
    }

    function doUndo() {
      if (readOnly || !undoStack.length) return;
      redoStack.push(cloneDeck(deck));
      deck = undoStack.pop()!;
      currentIndex = Math.min(currentIndex, deck.length - 1);
      updateUndoBtns();
      renderAll();
      emit();
    }

    function doRedo() {
      if (readOnly || !redoStack.length) return;
      undoStack.push(cloneDeck(deck));
      deck = redoStack.pop()!;
      currentIndex = Math.min(currentIndex, deck.length - 1);
      updateUndoBtns();
      renderAll();
      emit();
    }

    function go(idx: number) {
      currentIndex = Math.max(0, Math.min(deck.length - 1, idx));
      renderStage();
      renderList();
      renderInspector();
    }

    function insertSlide(kind: SlideTemplateKind) {
      if (readOnly) return;
      pushUndo();
      const pos = currentIndex + 1;
      deck.splice(pos, 0, makeSlideTemplate(kind, pos));
      currentIndex = pos;
      renderAll();
      emit();
    }

    function duplicateAt(idx: number) {
      if (readOnly) return;
      pushUndo();
      deck.splice(idx + 1, 0, { ...deck[idx]! });
      currentIndex = idx + 1;
      renderAll();
      emit();
    }

    function deleteAt(idx: number) {
      if (readOnly || deck.length <= 1) return;
      pushUndo();
      deck.splice(idx, 1);
      currentIndex = Math.min(currentIndex, deck.length - 1);
      renderAll();
      emit();
    }

    function toggleEdit() {
      if (readOnly) return;
      editMode = !editMode;
      if (editMode) presenting = false;
      updateChrome();
      renderAll();
    }

    function togglePresent() {
      presenting = !presenting;
      if (presenting) editMode = false;
      updateChrome();
      renderStage();
    }

    function toggleJumpMenu() {
      if (jumpMenu.style.display === "grid") {
        jumpMenu.style.display = "none";
        return;
      }
      jumpMenu.innerHTML = "";
      deck.forEach((_, i) => {
        jumpMenu.appendChild(
          el("button", {
            type: "button",
            class: "cfos-jump-btn" + (i === currentIndex ? " active" : ""),
            text: String(i + 1),
            onclick: () => {
              go(i);
              jumpMenu.style.display = "none";
            },
          }),
        );
      });
      jumpMenu.style.display = "grid";
    }

    function renderAll() {
      renderStage();
      renderList();
      renderInspector();
    }

    searchInput.addEventListener("input", () => {
      slideSearch = searchInput.value;
      renderList();
    });

    const onDocClick = (e: MouseEvent) => {
      if (!(e.target instanceof Node && leftFooter.contains(e.target))) closeAddMenu();
      if (
        jumpMenu.style.display === "grid" &&
        !(e.target instanceof Node && jumpMenu.contains(e.target)) &&
        e.target !== counterBtn
      ) {
        jumpMenu.style.display = "none";
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!mount.contains(document.activeElement) && document.activeElement !== document.body && !presenting) {
        return;
      }
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(currentIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(currentIndex - 1);
      } else if (e.key === "e" || e.key === "E") {
        toggleEdit();
      } else if (e.key === "f" || e.key === "F") {
        togglePresent();
      } else if (e.key === "Escape") {
        if (jumpMenu.style.display === "grid") jumpMenu.style.display = "none";
        else if (presenting) togglePresent();
      }
    };

    const ro = new ResizeObserver(fit);
    ro.observe(stageWrap);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);

    updateUndoBtns();
    updateChrome();
    renderAll();

    return () => {
      ro.disconnect();
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [readOnly, resetKey, labels]);

  return <div ref={hostRef} className="cfos-workbench-host cfos-slides-host" />;
}
