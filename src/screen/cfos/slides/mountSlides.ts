// Ported from cloudflare-os workspace-slides/files/client.ts
// Full multi-block slide designer & presenter: 1200x675 scaled stage, component library palette,
// typed block & slide inspector, drag-to-move with 6px alignment snap guides, resize handle,
// slide rail drag-reorder, undo/redo, Present mode, and HTML export.

import type { DeckSlide } from "../../domain/works";
import { sanitizeFileName, triggerDownload } from "../ui/download";
import { el, icon } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { prepareImage } from "../ui/images";
import { bindActionMenu, iconBtn } from "../ui/toolbar";
import {
  cfosDeckToWorks,
  exportDeckHtml,
  makeCfosSlideTemplate,
  newSlideUid,
  slideLabel,
  slideText,
  worksDeckToCfos,
  type CfosBlock,
  type CfosDeck,
  type CfosSlide,
  type SlideTemplateKind,
} from "./codec";
import {
  C,
  COMPONENTS,
  COMPONENT_CATEGORIES,
  COMP_DESC,
  COMP_ICON,
  renderSlideSurface,
  type ComponentDef,
  type FieldSchema,
} from "./components";

export interface SlidesLabels {
  searchSlides: string;
  addSlide: string;
  addLayoutTitle: string;
  tplCover: string;
  tplCoverDesc: string;
  tplContent: string;
  tplContentDesc: string;
  tplTwoCol: string;
  tplTwoColDesc: string;
  tplFourCol: string;
  tplFourColDesc: string;
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
  componentsTab: string;
  inspectorTab: string;
  slideBackground: string;
  slideInset: string;
  slideDotGrid: string;
  slideCoverArt: string;
  fieldX: string;
  fieldY: string;
  fieldW: string;
  fieldH: string;
  bringForward: string;
  sendBackward: string;
  deleteBlock: string;
  duplicateBlock: string;
  uploadImage: string;
  exportHtml: string;
  fieldNotes: string;
}

const SNAP_THRESHOLD = 6;

export interface MountSlidesOptions {
  host: HTMLElement;
  slides: readonly DeckSlide[];
  documentTitle?: string;
  readOnly: boolean;
  labels: SlidesLabels;
  onChange: (next: DeckSlide[]) => void;
}

export interface MountedSlidesHandle {
  updateExternal: (slides: readonly DeckSlide[], title?: string) => void;
  destroy: () => void;
}

export function mountSlides({
  host,
  slides,
  documentTitle = "Untitled deck",
  readOnly,
  labels,
  onChange,
}: MountSlidesOptions): MountedSlidesHandle {
  let deckTitle = documentTitle;
  let hydrated = worksDeckToCfos(slides);
  let deck: CfosDeck = hydrated.deck;
  let speakerNotes: Record<string, string> = hydrated.speakerNotes;
  let currentIndex = 0;
  let selectedBlockId: string | null = null;
  let editMode = !readOnly;
  let presentMode = false;
  let rightTab: "inspector" | "palette" = "inspector";
  let slideSearch = "";
  let stageScale = 0.6;
  let lastSerialized = JSON.stringify(slides);
  let dragSlideIndex: number | null = null;

  const undoStack: string[] = [];
  const redoStack: string[] = [];

  const currentSlide = (): CfosSlide | null => deck.slides[currentIndex] ?? null;

  const snapState = () => JSON.stringify({ deck, speakerNotes, currentIndex });
  const pushUndo = () => {
    undoStack.push(snapState());
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    updateUndoBtns();
  };

  const emit = () => {
    if (readOnly) return;
    const next = cfosDeckToWorks(deck, speakerNotes);
    const serialized = JSON.stringify(next);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    onChange(next);
  };

  // --- Shell elements ------------------------------------------------------
  const searchInput = el("input", {
    class: "cfos-slides-search-input",
    type: "search",
    placeholder: labels.searchSlides,
    "aria-label": labels.searchSlides,
  });
  const thumbList = el("div", { class: "cfos-thumb-list" });
  const addSlideBtn = el(
    "button",
    { type: "button", class: "cfos-btn-add-slide" },
    [el("span", { class: "cfos-ico", html: icon(ICONS.plus, 14) }), el("span", {}, labels.addSlide)],
  );
  const leftPanel = el("aside", { class: "cfos-slides-left" }, [
    el("div", { class: "cfos-slides-search" }, [
      el("span", { class: "cfos-search-ico", html: icon(ICONS.search, 14) }),
      searchInput,
    ]),
    thumbList,
    readOnly ? null : el("div", { class: "cfos-slides-left-foot" }, [addSlideBtn]),
  ]);

  const stageEl = el("div", { class: "cfos-stage" });
  const stageWrap = el("div", { class: "cfos-stage-wrap" }, [stageEl]);

  const prevBtn = iconBtn(ICONS.chevronLeft, labels.prevSlide, () => stepSlide(-1));
  const counterEl = el("div", { class: "cfos-slide-counter", title: labels.jumpToSlide });
  const nextBtn = iconBtn(ICONS.chevronRight, labels.nextSlide, () => stepSlide(1));
  const undoBtn = iconBtn(ICONS.undo, labels.undo, () => undo());
  const redoBtn = iconBtn(ICONS.redo, labels.redo, () => redo());
  const editBtn = iconBtn(ICONS.pencil, labels.editMode, () => toggleEdit());
  const presentBtn = iconBtn(ICONS.expand, labels.presentMode, () => togglePresent());
  const exportBtn = iconBtn(ICONS.download, labels.exportHtml, () => {
    const html = exportDeckHtml(deckTitle, deck);
    triggerDownload(sanitizeFileName(deckTitle, "deck", "html"), html, "text/html;charset=utf-8");
  });

  const pill = el("div", { class: "cfos-slide-pill" }, [
    prevBtn,
    counterEl,
    nextBtn,
    readOnly ? null : el("div", { class: "cfos-pill-div" }),
    readOnly ? null : undoBtn,
    readOnly ? null : redoBtn,
    readOnly ? null : editBtn,
    presentBtn,
    exportBtn,
  ]);

  const exitPresentBtn = el("button", {
    type: "button",
    class: "cfos-exit-present",
    title: labels.exitPresent,
    "aria-label": labels.exitPresent,
    html: icon(ICONS.collapse, 16),
  });
  exitPresentBtn.addEventListener("click", () => {
    presentMode = false;
    syncModeClasses();
    fitStage();
  });

  const stageArea = el("div", { class: "cfos-slides-stage-area" }, [
    stageWrap,
    pill,
    exitPresentBtn,
  ]);

  const tabInspBtn = el("button", { type: "button", class: "cfos-right-tab active" }, labels.inspectorTab);
  const tabPalBtn = el("button", { type: "button", class: "cfos-right-tab" }, labels.componentsTab);
  const rightBody = el("div", { class: "cfos-right-body" });
  const rightPanel = el("aside", { class: "cfos-slides-right" }, [
    el("div", { class: "cfos-right-tabs" }, [tabInspBtn, tabPalBtn]),
    rightBody,
  ]);

  tabInspBtn.addEventListener("click", () => {
    rightTab = "inspector";
    tabInspBtn.classList.add("active");
    tabPalBtn.classList.remove("active");
    renderRightSidebar();
  });
  tabPalBtn.addEventListener("click", () => {
    rightTab = "palette";
    tabPalBtn.classList.add("active");
    tabInspBtn.classList.remove("active");
    renderRightSidebar();
  });

  const app = el("div", { class: "cfos-slides-app" }, [leftPanel, stageArea, rightPanel]);
  host.replaceChildren(app);

  // --- Add slide template menu ---------------------------------------------
  const unbindAddSlide = bindActionMenu(addSlideBtn, () => {
    const tpls: { kind: SlideTemplateKind; label: string; desc: string }[] = [
      { kind: "cover", label: labels.tplCover, desc: labels.tplCoverDesc },
      { kind: "content", label: labels.tplContent, desc: labels.tplContentDesc },
      { kind: "twoCol", label: labels.tplTwoCol, desc: labels.tplTwoColDesc },
      { kind: "fourCol", label: labels.tplFourCol, desc: labels.tplFourColDesc },
      { kind: "bullets", label: labels.tplBullets, desc: labels.tplBulletsDesc },
    ];
    return tpls.map((tpl) => ({
      id: tpl.kind,
      label: tpl.label,
      desc: tpl.desc,
      onSelect: () => addSlide(tpl.kind),
    }));
  });

  // --- Scale & layout ------------------------------------------------------
  function fitStage() {
    const padX = presentMode ? 24 : 40;
    const padY = presentMode ? 24 : 84;
    const rect = stageArea.getBoundingClientRect();
    const availW = Math.max(240, rect.width - padX);
    const availH = Math.max(160, rect.height - padY);
    stageScale = Math.min(availW / 1200, availH / 675);
    stageEl.style.width = "1200px";
    stageEl.style.height = "675px";
    stageEl.style.transformOrigin = "0 0";
    stageEl.style.transform = `scale(${stageScale})`;
    stageWrap.style.width = Math.round(1200 * stageScale) + "px";
    stageWrap.style.height = Math.round(675 * stageScale) + "px";
  }

  function syncModeClasses() {
    app.classList.toggle("editing", editMode && !presentMode && !readOnly);
    app.classList.toggle("presenting", presentMode);
    editBtn.classList.toggle("active", editMode && !presentMode && !readOnly);
    leftPanel.style.display = readOnly || presentMode ? "none" : editMode ? "flex" : "none";
    rightPanel.style.display = readOnly || presentMode ? "none" : editMode ? "flex" : "none";
  }

  function updateUndoBtns() {
    undoBtn.disabled = readOnly || undoStack.length === 0;
    redoBtn.disabled = readOnly || redoStack.length === 0;
  }

  function undo() {
    if (readOnly || !undoStack.length) return;
    redoStack.push(snapState());
    const parsed = JSON.parse(undoStack.pop()!) as {
      deck: CfosDeck;
      speakerNotes: Record<string, string>;
      currentIndex: number;
    };
    deck = parsed.deck;
    speakerNotes = parsed.speakerNotes;
    currentIndex = Math.max(0, Math.min(deck.slides.length - 1, parsed.currentIndex));
    selectedBlockId = null;
    updateUndoBtns();
    renderAll();
    emit();
  }

  function redo() {
    if (readOnly || !redoStack.length) return;
    undoStack.push(snapState());
    const parsed = JSON.parse(redoStack.pop()!) as {
      deck: CfosDeck;
      speakerNotes: Record<string, string>;
      currentIndex: number;
    };
    deck = parsed.deck;
    speakerNotes = parsed.speakerNotes;
    currentIndex = Math.max(0, Math.min(deck.slides.length - 1, parsed.currentIndex));
    selectedBlockId = null;
    updateUndoBtns();
    renderAll();
    emit();
  }

  function stepSlide(delta: number) {
    const next = currentIndex + delta;
    if (next < 0 || next >= deck.slides.length) return;
    currentIndex = next;
    selectedBlockId = null;
    renderAll();
  }

  function toggleEdit() {
    if (readOnly) return;
    editMode = !editMode;
    if (presentMode && editMode) presentMode = false;
    selectedBlockId = null;
    syncModeClasses();
    fitStage();
    renderAll();
  }

  function togglePresent() {
    presentMode = !presentMode;
    selectedBlockId = null;
    syncModeClasses();
    fitStage();
    renderStage();
  }

  // --- Slide mutations -----------------------------------------------------
  function addSlide(kind: SlideTemplateKind) {
    if (readOnly) return;
    pushUndo();
    const s = makeCfosSlideTemplate(kind, deck.slides.length);
    deck.slides.splice(currentIndex + 1, 0, s);
    currentIndex += 1;
    selectedBlockId = null;
    renderAll();
    emit();
  }

  function duplicateSlide(index: number) {
    if (readOnly) return;
    const src = deck.slides[index];
    if (!src) return;
    pushUndo();
    const clone: CfosSlide = {
      id: newSlideUid("s"),
      background: { ...src.background },
      blocks: src.blocks.map((b) => ({
        ...b,
        id: newSlideUid("b"),
        props: { ...b.props },
      })),
    };
    deck.slides.splice(index + 1, 0, clone);
    if (speakerNotes[src.id]) speakerNotes[clone.id] = speakerNotes[src.id];
    currentIndex = index + 1;
    selectedBlockId = null;
    renderAll();
    emit();
  }

  function deleteSlide(index: number) {
    if (readOnly || deck.slides.length <= 1) return;
    pushUndo();
    const [removed] = deck.slides.splice(index, 1);
    if (removed) delete speakerNotes[removed.id];
    currentIndex = Math.max(0, Math.min(currentIndex, deck.slides.length - 1));
    selectedBlockId = null;
    renderAll();
    emit();
  }

  function moveSlide(fromIndex: number, toIndex: number) {
    if (readOnly || fromIndex === toIndex) return;
    pushUndo();
    const [moved] = deck.slides.splice(fromIndex, 1);
    deck.slides.splice(toIndex, 0, moved);
    currentIndex = toIndex;
    renderAll();
    emit();
  }

  // --- Block drag, 6px snap guides, & resize -------------------------------
  function computeSnapTargets(slide: CfosSlide, dragging: CfosBlock) {
    const verts: number[] = [0, 600, 1200];
    const horiz: number[] = [0, 337.5, 675];
    for (const b of slide.blocks) {
      if (b.id === dragging.id) continue;
      const def = COMPONENTS[b.type];
      if (!def || def.fullBleed) continue;
      const node = stageEl.querySelector<HTMLElement>(`[data-block-id="${b.id}"]`);
      const x = b.x ?? 0;
      const y = b.y ?? 0;
      const w = b.w ?? node?.offsetWidth ?? 0;
      const h = b.h ?? node?.offsetHeight ?? 0;
      if (w > 0) verts.push(x, x + w, x + w / 2);
      if (h > 0) horiz.push(y, y + h, y + h / 2);
    }
    return { verts, horiz };
  }

  function applySnap(
    nx: number,
    ny: number,
    bw: number,
    bh: number,
    targets: { verts: number[]; horiz: number[] },
  ) {
    const xCands = [
      { pos: nx, offset: 0 },
      { pos: nx + bw / 2, offset: -bw / 2 },
      { pos: nx + bw, offset: -bw },
    ];
    const yCands = [
      { pos: ny, offset: 0 },
      { pos: ny + bh / 2, offset: -bh / 2 },
      { pos: ny + bh, offset: -bh },
    ];
    let bestX: { d: number; x: number; g: number } | null = null;
    for (const c of xCands) {
      for (const t of targets.verts) {
        const d = Math.abs(t - c.pos);
        if (d <= SNAP_THRESHOLD && (!bestX || d < bestX.d)) {
          bestX = { d, x: t + c.offset, g: t };
        }
      }
    }
    let bestY: { d: number; y: number; g: number } | null = null;
    for (const c of yCands) {
      for (const t of targets.horiz) {
        const d = Math.abs(t - c.pos);
        if (d <= SNAP_THRESHOLD && (!bestY || d < bestY.d)) {
          bestY = { d, y: t + c.offset, g: t };
        }
      }
    }
    return {
      x: bestX ? Math.round(bestX.x) : nx,
      y: bestY ? Math.round(bestY.y) : ny,
      guidesV: bestX ? [bestX.g] : [],
      guidesH: bestY ? [bestY.g] : [],
    };
  }

  function drawSnapGuides(frame: HTMLElement | null, xs: number[], ys: number[]) {
    if (!frame) return;
    let layer = frame.querySelector<HTMLDivElement>("[data-snap-layer]");
    if (!layer) {
      layer = el("div", {
        "data-snap-layer": "1",
        style: "position:absolute;inset:0;pointer-events:none;z-index:100;",
      });
      frame.appendChild(layer);
    }
    layer.replaceChildren();
    for (const x of xs) {
      layer.appendChild(
        el("div", {
          style: `position:absolute;left:${x}px;top:0;width:1px;height:675px;background:${C.orange};opacity:0.9;`,
        }),
      );
    }
    for (const y of ys) {
      layer.appendChild(
        el("div", {
          style: `position:absolute;left:0;top:${y}px;width:1200px;height:1px;background:${C.orange};opacity:0.9;`,
        }),
      );
    }
  }

  function attachBlockDrag(block: CfosBlock, wrap: HTMLDivElement, e: PointerEvent) {
    if (e.button !== 0 || readOnly || !editMode) return;
    if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
    e.stopPropagation();

    const slide = currentSlide();
    if (!slide) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = block.x ?? 0;
    const origY = block.y ?? 0;
    const bw = block.w ?? wrap.offsetWidth;
    const bh = block.h ?? wrap.offsetHeight;
    const targets = computeSnapTargets(slide, block);
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / stageScale;
      const dy = (ev.clientY - startY) / stageScale;
      if (!dragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        dragged = true;
        pushUndo();
      }
      if (!dragged) return;
      let nx = Math.round(origX + dx);
      let ny = Math.round(origY + dy);
      let gv: number[] = [];
      let gh: number[] = [];
      if (!ev.altKey) {
        const snap = applySnap(nx, ny, bw, bh, targets);
        nx = snap.x;
        ny = snap.y;
        gv = snap.guidesV;
        gh = snap.guidesH;
      }
      drawSnapGuides(wrap.parentElement, gv, gh);
      block.x = nx;
      block.y = ny;
      wrap.style.left = nx + "px";
      wrap.style.top = ny + "px";
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      stageEl.querySelector("[data-snap-layer]")?.remove();
      selectedBlockId = block.id;
      rightTab = "inspector";
      tabInspBtn.classList.add("active");
      tabPalBtn.classList.remove("active");
      renderAll();
      if (dragged) emit();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function addBlockResizeHandle(wrap: HTMLDivElement, block: CfosBlock, def: ComponentDef) {
    const handle = el("div", {
      style: `position:absolute;right:-6px;bottom:-6px;width:12px;height:12px;background:#fff;border:2px solid ${C.orange};border-radius:3px;cursor:nwse-resize;z-index:10;`,
    });
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      pushUndo();
      const sx = e.clientX;
      const sy = e.clientY;
      const sw = block.w ?? wrap.offsetWidth;
      const sh = block.h ?? wrap.offsetHeight;
      const onMove = (ev: PointerEvent) => {
        if (def.resizableW) {
          block.w = Math.max(40, Math.round(sw + (ev.clientX - sx) / stageScale));
          wrap.style.width = block.w + "px";
        }
        if (def.resizableH) {
          block.h = Math.max(20, Math.round(sh + (ev.clientY - sy) / stageScale));
          wrap.style.height = block.h + "px";
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        renderAll();
        emit();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    wrap.appendChild(handle);
  }

  // --- Stage + Left Rail + Right Inspector/Palette rendering ----------------
  function renderStage() {
    const slide = currentSlide();
    if (!slide) return;
    const frame = renderSlideSurface(slide, {
      editable: editMode && !presentMode && !readOnly,
      selectedBlockId,
      onSelectBlock: (id) => {
        selectedBlockId = id;
        rightTab = "inspector";
        tabInspBtn.classList.add("active");
        tabPalBtn.classList.remove("active");
        renderStage();
        renderRightSidebar();
      },
      onCommitBlockText: (id, key, val) => {
        const blk = slide.blocks.find((b) => b.id === id);
        if (!blk) return;
        pushUndo();
        blk.props[key] = val;
        renderThumbRail();
        renderRightSidebar();
        emit();
      },
      onDragMove: attachBlockDrag,
      onAddResize: addBlockResizeHandle,
    });
    frame.addEventListener("pointerdown", (e) => {
      if (e.target === frame && editMode && !readOnly) {
        selectedBlockId = null;
        renderStage();
        renderRightSidebar();
      }
    });
    stageEl.replaceChildren(frame);
    counterEl.textContent = `${currentIndex + 1} / ${deck.slides.length}`;
    prevBtn.disabled = currentIndex === 0;
    nextBtn.disabled = currentIndex >= deck.slides.length - 1;
  }

  function renderThumbRail() {
    if (readOnly || presentMode) return;
    thumbList.replaceChildren();
    const q = slideSearch.trim().toLowerCase();
    deck.slides.forEach((slide, idx) => {
      if (q && !slideText(slide).toLowerCase().includes(q)) return;
      const preview = renderSlideSurface(slide, {
        editable: false,
        selectedBlockId: null,
      });
      preview.style.transform = "scale(0.16)";
      preview.style.transformOrigin = "0 0";
      const thumbStage = el("div", { class: "cfos-thumb-stage" }, [preview]);

      const dupBtn = iconBtn(ICONS.duplicate, labels.duplicateSlide, (e) => {
        e.stopPropagation();
        duplicateSlide(idx);
      });
      const delBtn = iconBtn(ICONS.trash, labels.deleteSlide, (e) => {
        e.stopPropagation();
        deleteSlide(idx);
      });
      delBtn.disabled = deck.slides.length <= 1;

      const card = el(
        "div",
        {
          class: "cfos-slide-thumb" + (idx === currentIndex ? " active" : ""),
          draggable: "true",
        },
        [
          thumbStage,
          el("div", { class: "cfos-thumb-actions" }, [dupBtn, delBtn]),
          el("div", { class: "cfos-thumb-meta" }, [
            el("span", { class: "cfos-thumb-num" }, String(idx + 1)),
            el("span", { class: "cfos-thumb-title" }, slideLabel(slide)),
          ]),
        ],
      );
      card.addEventListener("click", () => {
        currentIndex = idx;
        selectedBlockId = null;
        renderAll();
      });
      card.addEventListener("dragstart", () => {
        dragSlideIndex = idx;
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        dragSlideIndex = null;
        card.classList.remove("dragging");
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragSlideIndex !== null) moveSlide(dragSlideIndex, idx);
        dragSlideIndex = null;
      });
      thumbList.appendChild(card);
    });
  }

  function renderPalette(): HTMLElement {
    const slide = currentSlide();
    const frag = el("div", { class: "cfos-palette" });
    if (!slide) return frag;
    for (const cat of COMPONENT_CATEGORIES) {
      frag.appendChild(el("div", { class: "cfos-insp-head" }, cat.name));
      const grid = el("div", { class: "cfos-palette-grid" });
      for (const type of cat.types) {
        const def = COMPONENTS[type];
        if (!def?.defaultBlock) continue;
        const btn = el("button", { type: "button", class: "cfos-palette-item" }, [
          el("span", { class: "cfos-pal-ico", html: icon(COMP_ICON[type] || ICONS.plus, 15) }),
          el("span", { class: "cfos-pal-info" }, [
            el("span", { class: "cfos-pal-name" }, def.name),
            el("span", { class: "cfos-pal-desc" }, COMP_DESC[type] || ""),
          ]),
        ]);
        btn.addEventListener("click", () => {
          pushUndo();
          const d = def.defaultBlock!();
          const blk: CfosBlock = {
            id: newSlideUid("b"),
            type,
            x: d.x,
            y: d.y,
            ...(d.w !== undefined ? { w: d.w } : {}),
            ...(d.h !== undefined ? { h: d.h } : {}),
            props: { ...d.props },
          };
          slide.blocks.push(blk);
          selectedBlockId = blk.id;
          rightTab = "inspector";
          tabInspBtn.classList.add("active");
          tabPalBtn.classList.remove("active");
          renderAll();
          emit();
        });
        grid.appendChild(btn);
      }
      frag.appendChild(grid);
    }
    return frag;
  }

  function renderFieldControl(
    _slide: CfosSlide,
    block: CfosBlock,
    field: FieldSchema,
  ): HTMLElement {
    const val = block.props[field.key];
    const apply = (next: string | number | boolean) => {
      pushUndo();
      block.props[field.key] = next;
      renderStage();
      renderThumbRail();
      emit();
    };

    if (field.type === "multiline") {
      const ta = el("textarea", { class: "cfos-insp-textarea", rows: "3" }, String(val ?? ""));
      ta.addEventListener("input", () => {
        block.props[field.key] = ta.value;
        renderStage();
        renderThumbRail();
        emit();
      });
      return ta;
    }
    if (field.type === "number") {
      const inp = el("input", {
        type: "number",
        class: "cfos-insp-input",
        value: String(val ?? 0),
        min: field.min != null ? String(field.min) : null,
        max: field.max != null ? String(field.max) : null,
        step: field.step != null ? String(field.step) : null,
      });
      inp.addEventListener("change", () => apply(Number(inp.value) || 0));
      return inp;
    }
    if (field.type === "checkbox") {
      const chk = el("input", { type: "checkbox" });
      chk.checked = Boolean(val);
      chk.addEventListener("change", () => apply(chk.checked));
      return el("label", { class: "cfos-insp-check" }, [chk, el("span", {}, field.label)]);
    }
    if (field.type === "color") {
      const inp = el("input", { type: "color", class: "cfos-insp-color", value: String(val || "#000000") });
      const hex = el("input", { type: "text", class: "cfos-insp-input", value: String(val || "#000000") });
      inp.addEventListener("input", () => {
        hex.value = inp.value;
        apply(inp.value);
      });
      hex.addEventListener("change", () => {
        if (/^#[0-9a-f]{3,6}$/i.test(hex.value.trim())) {
          inp.value = hex.value.trim();
          apply(hex.value.trim());
        }
      });
      return el("div", { class: "cfos-insp-color-row" }, [inp, hex]);
    }
    if (field.type === "select" && field.options?.length) {
      const seg = el("div", { class: "cfos-insp-seg" });
      for (const opt of field.options) {
        const b = el(
          "button",
          {
            type: "button",
            class: "cfos-insp-seg-btn" + (String(val ?? field.options[0]) === opt ? " active" : ""),
          },
          opt,
        );
        b.addEventListener("click", () => {
          apply(opt);
          renderRightSidebar();
        });
        seg.appendChild(b);
      }
      return seg;
    }
    if (field.type === "image") {
      const fileInput = el("input", {
        type: "file",
        accept: "image/png,image/jpeg,image/webp,image/gif",
        style: "display:none;",
      });
      const uploadBtn = el("button", { type: "button", class: "cfos-btn-action" }, labels.uploadImage);
      uploadBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          const prep = await prepareImage(file, { maxDimension: 720, maxDataUrlLength: 20_000 });
          apply(prep.src);
          renderRightSidebar();
        } catch {
          // Keep current image if over Works 64 KiB budget.
        }
      });
      return el("div", { class: "cfos-insp-img-row" }, [fileInput, uploadBtn]);
    }
    if (field.type === "svg") {
      const ta = el("textarea", { class: "cfos-insp-textarea", rows: "4" }, String(val ?? ""));
      ta.addEventListener("change", () => apply(ta.value));
      return ta;
    }
    const inp = el("input", { type: "text", class: "cfos-insp-input", value: String(val ?? "") });
    inp.addEventListener("input", () => {
      block.props[field.key] = inp.value;
      renderStage();
      renderThumbRail();
      emit();
    });
    return inp;
  }

  function renderInspector(): HTMLElement {
    const slide = currentSlide();
    const wrap = el("div", { class: "cfos-inspector-pane" });
    if (!slide) return wrap;

    const block = selectedBlockId ? slide.blocks.find((b) => b.id === selectedBlockId) : null;
    const def = block ? COMPONENTS[block.type] : null;
    if (block && def) {
      const blockIdx = slide.blocks.findIndex((b) => b.id === block.id);
      wrap.appendChild(
        el("div", { class: "cfos-insp-head" }, `${def.name.toUpperCase()} · #${blockIdx + 1}`),
      );
      wrap.appendChild(
        el("div", { class: "cfos-insp-actions" }, [
          iconBtn(ICONS.arrowUp, labels.bringForward, () => {
            if (blockIdx >= slide.blocks.length - 1) return;
            pushUndo();
            const [item] = slide.blocks.splice(blockIdx, 1);
            slide.blocks.splice(blockIdx + 1, 0, item);
            renderAll();
            emit();
          }),
          iconBtn(ICONS.arrowDown, labels.sendBackward, () => {
            if (blockIdx <= 0) return;
            pushUndo();
            const [item] = slide.blocks.splice(blockIdx, 1);
            slide.blocks.splice(blockIdx - 1, 0, item);
            renderAll();
            emit();
          }),
          iconBtn(ICONS.duplicate, labels.duplicateBlock, () => duplicateSelectedBlock()),
          iconBtn(ICONS.trash, labels.deleteBlock, () => deleteSelectedBlock()),
        ]),
      );

      if (!def.fullBleed) {
        const numInput = (val: number, onSet: (n: number) => void) => {
          const inp = el("input", { type: "number", class: "cfos-insp-input", value: String(val) });
          inp.addEventListener("change", () => {
            pushUndo();
            onSet(Math.round(Number(inp.value) || 0));
            renderStage();
            emit();
          });
          return inp;
        };
        wrap.appendChild(
          el("div", { class: "cfos-insp-coords" }, [
            el("label", { class: "cfos-field" }, [
              el("span", {}, labels.fieldX),
              numInput(block.x ?? 0, (n) => {
                block.x = n;
              }),
            ]),
            el("label", { class: "cfos-field" }, [
              el("span", {}, labels.fieldY),
              numInput(block.y ?? 0, (n) => {
                block.y = n;
              }),
            ]),
            def.resizableW
              ? el("label", { class: "cfos-field" }, [
                  el("span", {}, labels.fieldW),
                  numInput(block.w ?? 300, (n) => {
                    block.w = Math.max(24, n);
                  }),
                ])
              : null,
            def.resizableH
              ? el("label", { class: "cfos-field" }, [
                  el("span", {}, labels.fieldH),
                  numInput(block.h ?? 160, (n) => {
                    block.h = Math.max(16, n);
                  }),
                ])
              : null,
          ]),
        );
      }

      for (const field of def.fields ?? []) {
        const ctrl = renderFieldControl(slide, block, field);
        if (field.type === "checkbox") {
          wrap.appendChild(ctrl);
        } else {
          wrap.appendChild(
            el("div", { class: "cfos-field" }, [el("span", {}, field.label), ctrl]),
          );
        }
      }
      return wrap;
    }

    // Slide properties inspector
    wrap.appendChild(
      el("div", { class: "cfos-insp-head" }, `${labels.inspectorTitle} · ${currentIndex + 1}`),
    );
    const bgColorInp = el("input", {
      type: "color",
      class: "cfos-insp-color",
      value: slide.background.color || "#FFFFFF",
    });
    bgColorInp.addEventListener("input", () => {
      slide.background.color = bgColorInp.value;
      renderStage();
      renderThumbRail();
      emit();
    });
    const coverCheck = el("input", { type: "checkbox" });
    coverCheck.checked = !!slide.background.coverOrange;
    coverCheck.addEventListener("change", () => {
      pushUndo();
      slide.background.coverOrange = coverCheck.checked;
      renderAll();
      emit();
    });
    const insetCheck = el("input", { type: "checkbox" });
    insetCheck.checked = !!slide.background.inset;
    insetCheck.addEventListener("change", () => {
      pushUndo();
      slide.background.inset = insetCheck.checked;
      renderAll();
      emit();
    });
    const dotCheck = el("input", { type: "checkbox" });
    dotCheck.checked = (slide.background.dotGrid ?? 0) > 0;
    dotCheck.addEventListener("change", () => {
      pushUndo();
      slide.background.dotGrid = dotCheck.checked ? 0.42 : 0;
      renderAll();
      emit();
    });
    const notesArea = el(
      "textarea",
      { class: "cfos-insp-textarea", rows: "4" },
      speakerNotes[slide.id] ?? "",
    );
    notesArea.addEventListener("input", () => {
      speakerNotes[slide.id] = notesArea.value;
      emit();
    });

    wrap.appendChild(
      el("div", { class: "cfos-field" }, [
        el("span", {}, labels.slideBackground),
        bgColorInp,
      ]),
    );
    wrap.appendChild(
      el("label", { class: "cfos-insp-check" }, [coverCheck, el("span", {}, labels.slideCoverArt)]),
    );
    wrap.appendChild(
      el("label", { class: "cfos-insp-check" }, [insetCheck, el("span", {}, labels.slideInset)]),
    );
    wrap.appendChild(
      el("label", { class: "cfos-insp-check" }, [dotCheck, el("span", {}, labels.slideDotGrid)]),
    );
    wrap.appendChild(
      el("div", { class: "cfos-field" }, [el("span", {}, labels.fieldNotes), notesArea]),
    );
    return wrap;
  }

  function renderRightSidebar() {
    if (readOnly || presentMode || !editMode) return;
    rightBody.replaceChildren(
      rightTab === "palette" ? renderPalette() : renderInspector(),
    );
  }

  function renderAll() {
    renderStage();
    renderThumbRail();
    renderRightSidebar();
  }

  function duplicateSelectedBlock() {
    const slide = currentSlide();
    if (!slide || !selectedBlockId) return;
    const src = slide.blocks.find((b) => b.id === selectedBlockId);
    if (!src) return;
    pushUndo();
    const copy: CfosBlock = {
      ...src,
      id: newSlideUid("b"),
      x: (src.x ?? 0) + 20,
      y: (src.y ?? 0) + 20,
      props: { ...src.props },
    };
    slide.blocks.push(copy);
    selectedBlockId = copy.id;
    renderAll();
    emit();
  }

  function deleteSelectedBlock() {
    const slide = currentSlide();
    if (!slide || !selectedBlockId) return;
    pushUndo();
    slide.blocks = slide.blocks.filter((b) => b.id !== selectedBlockId);
    selectedBlockId = null;
    renderAll();
    emit();
  }

  // --- Global listeners ----------------------------------------------------
  const onSearchInput = () => {
    slideSearch = searchInput.value;
    renderThumbRail();
  };
  searchInput.addEventListener("input", onSearchInput);

  const onKeyDown = (e: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const typing =
      active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
    if (typing) return;

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "d" && editMode && selectedBlockId) {
      e.preventDefault();
      duplicateSelectedBlock();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && editMode && selectedBlockId) {
      e.preventDefault();
      deleteSelectedBlock();
      return;
    }
    if (editMode && selectedBlockId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      const slide = currentSlide();
      const blk = slide?.blocks.find((b) => b.id === selectedBlockId);
      if (blk) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowUp") blk.y -= step;
        if (e.key === "ArrowDown") blk.y += step;
        if (e.key === "ArrowLeft") blk.x -= step;
        if (e.key === "ArrowRight") blk.x += step;
        renderStage();
        emit();
        return;
      }
    }
    if (e.key === "Escape" && presentMode) {
      presentMode = false;
      syncModeClasses();
      fitStage();
      renderStage();
    } else if ((e.key === "f" || e.key === "F") && !mod) {
      togglePresent();
    } else if ((e.key === "e" || e.key === "E") && !mod && !readOnly) {
      toggleEdit();
    } else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && presentMode)) {
      e.preventDefault();
      stepSlide(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      stepSlide(-1);
    }
  };
  document.addEventListener("keydown", onKeyDown);

  const ro = new ResizeObserver(() => fitStage());
  ro.observe(stageArea);

  syncModeClasses();
  fitStage();
  updateUndoBtns();
  renderAll();

  return {
    updateExternal(incoming: readonly DeckSlide[], title?: string) {
      if (title !== undefined) deckTitle = title;
      const serialized = JSON.stringify(incoming);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      hydrated = worksDeckToCfos(incoming);
      deck = hydrated.deck;
      speakerNotes = hydrated.speakerNotes;
      currentIndex = Math.max(0, Math.min(currentIndex, deck.slides.length - 1));
      selectedBlockId = null;
      renderAll();
    },
    destroy() {
      searchInput.removeEventListener("input", onSearchInput);
      document.removeEventListener("keydown", onKeyDown);
      ro.disconnect();
      unbindAddSlide();
      host.replaceChildren();
    },
  };
}
