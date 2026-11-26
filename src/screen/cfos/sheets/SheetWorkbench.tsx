// Ported from cloudflare-os workspace-sheets/files/client.ts

import { useEffect, useRef } from "react";
import type { Cell } from "../../domain/works";
import { el, icon } from "../ui/dom";
import { ICONS } from "../ui/icons";
import { promptInline } from "../ui/prompt";
import { group, iconBtn } from "../ui/toolbar";
import {
  MIN_VISUAL_ROWS,
  coerceCellInput,
  compactSheetRows,
  normalizeSheetInput,
  parseTsv,
  sheetToCsv,
} from "./codec";
import {
  buildSheetEngine,
  columnHeaderLabel,
  displayCell,
  formatSelectionRef,
  parseRangeText,
  rcToRef,
} from "./formula";

export interface SheetLabels {
  undo: string;
  redo: string;
  autoSum: string;
  sortAsc: string;
  sortDesc: string;
  addRow: string;
  delRow: string;
  addCol: string;
  delCol: string;
  copyCsv: string;
  renameColPrompt: string;
  newColDefault: string;
  nameBoxTitle: string;
  formulaPlaceholder: string;
}

interface Snapshot {
  columns: string[];
  rows: Cell[][];
}

export function SheetWorkbench({
  columns,
  rows,
  readOnly,
  resetKey,
  labels,
  onChange,
}: {
  columns: readonly string[];
  rows: readonly (readonly Cell[])[];
  readOnly: boolean;
  resetKey: number;
  labels: SheetLabels;
  onChange: (next: { columns: string[]; rows: Cell[][] }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initialRef = useRef<Snapshot>(normalizeSheetInput(columns, rows));
  initialRef.current = normalizeSheetInput(columns, rows);

  useEffect(() => {
    const mount = hostRef.current;
    if (!mount) return;
    mount.innerHTML = "";

    let model: Snapshot = {
      columns: [...initialRef.current.columns],
      rows: initialRef.current.rows.map((r) => [...r]),
    };
    const colWidths = new Map<number, number>();
    const undoStack: Snapshot[] = [];
    const redoStack: Snapshot[] = [];

    let anchorR = 0;
    let anchorC = 0;
    let focusR = 0;
    let focusC = 0;
    let dragging = false;
    let editing: { r: number; c: number; initial: string } | null = null;

    const visualRowCount = () => Math.max(MIN_VISUAL_ROWS, model.rows.length + 4);
    const getCell = (r: number, c: number): Cell => model.rows[r]?.[c] ?? "";

    const cloneSnap = (s: Snapshot): Snapshot => ({
      columns: [...s.columns],
      rows: s.rows.map((r) => [...r]),
    });

    const emit = () => {
      onChangeRef.current({
        columns: model.columns.map((c, idx) => c.trim() || `${labels.newColDefault} ${idx + 1}`),
        rows: compactSheetRows(model.columns.length, model.rows),
      });
    };

    const pushUndo = () => {
      undoStack.push(cloneSnap(model));
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
      updateUndoBtns();
    };

    const ensureRow = (r: number) => {
      while (model.rows.length <= r) {
        model.rows.push(Array.from({ length: model.columns.length }, () => ""));
      }
    };

    const setCell = (r: number, c: number, val: Cell) => {
      if (c < 0 || c >= model.columns.length || r < 0) return;
      ensureRow(r);
      model.rows[r]![c] = val;
    };

    const app = el("div", { class: "cfos-sheet-app" });
    const toolbar = el("div", { class: "cfos-toolbar" });
    const fbar = el("div", { class: "cfos-fbar" });
    const namebox = el("input", {
      class: "cfos-namebox",
      title: labels.nameBoxTitle,
      "aria-label": labels.nameBoxTitle,
      value: "A1",
    });
    const fx = el("div", { class: "cfos-fx", text: "fx" });
    const finput = el("input", {
      class: "cfos-finput",
      placeholder: labels.formulaPlaceholder,
      "aria-label": labels.formulaPlaceholder,
      readOnly: readOnly ? true : undefined,
    });
    fbar.append(namebox, fx, finput);

    const gridScroll = el("div", { class: "cfos-grid-scroll", tabindex: "0" });
    const table = el("table", { class: "cfos-grid" });
    const cellEditor = el("textarea", {
      class: "cfos-cell-editor",
      rows: "1",
      spellcheck: "false",
    });
    gridScroll.append(table, cellEditor);

    const undoBtn = iconBtn(ICONS.undo, labels.undo, () => doUndo());
    const redoBtn = iconBtn(ICONS.redo, labels.redo, () => doRedo());

    function updateUndoBtns() {
      undoBtn.disabled = undoStack.length === 0;
      redoBtn.disabled = redoStack.length === 0;
    }

    function doUndo() {
      if (readOnly || !undoStack.length) return;
      redoStack.push(cloneSnap(model));
      model = undoStack.pop()!;
      updateUndoBtns();
      renderGrid();
      syncFormulaBar();
      emit();
    }

    function doRedo() {
      if (readOnly || !redoStack.length) return;
      undoStack.push(cloneSnap(model));
      model = redoStack.pop()!;
      updateUndoBtns();
      renderGrid();
      syncFormulaBar();
      emit();
    }

    function selBounds() {
      return {
        r1: Math.min(anchorR, focusR),
        c1: Math.min(anchorC, focusC),
        r2: Math.max(anchorR, focusR),
        c2: Math.max(anchorC, focusC),
      };
    }

    function syncFormulaBar() {
      const b = selBounds();
      namebox.value = formatSelectionRef(b.r1, b.c1, b.r2, b.c2);
      const raw = getCell(anchorR, anchorC);
      finput.value = raw === "" ? "" : String(raw);
    }

    function selectRange(r1: number, c1: number, r2 = r1, c2 = c1) {
      const maxR = visualRowCount() - 1;
      const maxC = model.columns.length - 1;
      anchorR = Math.max(0, Math.min(maxR, r1));
      anchorC = Math.max(0, Math.min(maxC, c1));
      focusR = Math.max(0, Math.min(maxR, r2));
      focusC = Math.max(0, Math.min(maxC, c2));
      paintSelection();
      syncFormulaBar();
    }

    function startEdit(r: number, c: number, seed?: string) {
      if (readOnly) return;
      const td = table.querySelector<HTMLTableCellElement>(
        `td[data-r="${r}"][data-c="${c}"]`,
      );
      if (!td) return;
      const raw = getCell(r, c);
      const text = seed !== undefined ? seed : raw === "" ? "" : String(raw);
      editing = { r, c, initial: String(raw) };
      cellEditor.style.display = "block";
      cellEditor.style.left = td.offsetLeft + "px";
      cellEditor.style.top = td.offsetTop + "px";
      cellEditor.style.width = Math.max(td.offsetWidth, 88) + "px";
      cellEditor.style.height = Math.max(td.offsetHeight, 26) + "px";
      cellEditor.value = text;
      cellEditor.focus();
      if (seed === undefined) cellEditor.select();
      else cellEditor.setSelectionRange(text.length, text.length);
    }

    function commitEdit(moveDir?: [number, number]) {
      if (!editing) return;
      const { r, c, initial } = editing;
      const nextText = cellEditor.value;
      editing = null;
      cellEditor.style.display = "none";
      if (nextText !== initial) {
        pushUndo();
        setCell(r, c, coerceCellInput(nextText));
        renderGrid();
        emit();
      }
      if (moveDir) {
        selectRange(r + moveDir[0], c + moveDir[1]);
      } else {
        syncFormulaBar();
      }
      gridScroll.focus();
    }

    function cancelEdit() {
      editing = null;
      cellEditor.style.display = "none";
      gridScroll.focus();
      syncFormulaBar();
    }

    function paintSelection() {
      const b = selBounds();
      for (const td of Array.from(table.querySelectorAll<HTMLTableCellElement>("td.cell"))) {
        const r = Number(td.dataset.r);
        const c = Number(td.dataset.c);
        const inSel = r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
        const isActive = r === anchorR && c === anchorC;
        td.classList.toggle("sel", inSel && !isActive);
        td.classList.toggle("active", isActive);
      }
      for (const th of Array.from(table.querySelectorAll<HTMLTableCellElement>("th.colhead"))) {
        const c = Number(th.dataset.c);
        th.classList.toggle("hl", c >= b.c1 && c <= b.c2);
      }
      for (const th of Array.from(table.querySelectorAll<HTMLTableCellElement>("th.rowhead"))) {
        const r = Number(th.dataset.r);
        th.classList.toggle("hl", r >= b.r1 && r <= b.r2);
      }
    }

    function renderGrid() {
      const engine = buildSheetEngine(model.columns, model.rows);
      const rowCount = visualRowCount();
      table.innerHTML = "";

      const colgroup = el("colgroup");
      colgroup.appendChild(el("col", { style: { width: "44px" } }));
      for (let c = 0; c < model.columns.length; c++) {
        const w = colWidths.get(c) ?? 132;
        colgroup.appendChild(el("col", { style: { width: `${w}px` } }));
      }
      table.appendChild(colgroup);

      const thead = el("thead");
      const htr = el("tr");
      htr.appendChild(el("th", { class: "corner", text: "" }));
      for (let c = 0; c < model.columns.length; c++) {
        const th = el("th", {
          class: "colhead",
          "data-c": String(c),
          title: model.columns[c],
        });
        th.appendChild(
          el("span", { class: "cfos-colhead-text", text: columnHeaderLabel(c, model.columns[c]) }),
        );
        if (!readOnly) {
          th.addEventListener("dblclick", async () => {
            const next = await promptInline(labels.renameColPrompt, model.columns[c]);
            if (next === null) return;
            const trimmed = next.trim();
            if (!trimmed || trimmed === model.columns[c]) return;
            pushUndo();
            model.columns[c] = trimmed;
            renderGrid();
            emit();
          });
          const resizer = el("div", { class: "cfos-col-resize" });
          resizer.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startW = colWidths.get(c) ?? 132;
            const onMove = (ev: MouseEvent) => {
              const nextW = Math.max(64, Math.min(480, startW + (ev.clientX - startX)));
              colWidths.set(c, nextW);
              const colEl = colgroup.children[c + 1] as HTMLElement | undefined;
              if (colEl) colEl.style.width = `${nextW}px`;
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          });
          th.appendChild(resizer);
        }
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = el("tbody");
      for (let r = 0; r < rowCount; r++) {
        const tr = el("tr");
        const rhead = el("th", { class: "rowhead", "data-r": String(r), text: String(r + 1) });
        rhead.addEventListener("click", () => {
          commitEdit();
          selectRange(r, 0, r, model.columns.length - 1);
        });
        tr.appendChild(rhead);

        for (let c = 0; c < model.columns.length; c++) {
          const raw = getCell(r, c);
          const disp = displayCell(engine, raw, r, c);
          const td = el("td", {
            class:
              "cell" +
              (disp.numeric ? " num" : "") +
              (disp.err ? " err" : "") +
              (disp.center ? " center" : ""),
            "data-r": String(r),
            "data-c": String(c),
          });
          td.appendChild(el("span", { class: "cv", text: disp.text }));
          td.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            commitEdit();
            if (e.shiftKey) {
              focusR = r;
              focusC = c;
              paintSelection();
              syncFormulaBar();
            } else {
              dragging = true;
              selectRange(r, c, r, c);
            }
          });
          td.addEventListener("mouseenter", () => {
            if (!dragging) return;
            focusR = r;
            focusC = c;
            paintSelection();
            syncFormulaBar();
          });
          td.addEventListener("dblclick", () => {
            startEdit(r, c);
          });
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      paintSelection();
    }

    const doAutoSum = () => {
      if (readOnly) return;
      const b = selBounds();
      pushUndo();
      if (b.r1 === b.r2 && b.c1 === b.c2) {
        // Scan upwards for numeric range
        let top = anchorR - 1;
        while (top >= 0 && typeof getCell(top, anchorC) === "number") top--;
        const startR = top + 1;
        if (startR < anchorR) {
          setCell(
            anchorR,
            anchorC,
            `=SUM(${rcToRef(startR, anchorC)}:${rcToRef(anchorR - 1, anchorC)})`,
          );
        }
      } else {
        const targetR = Math.min(visualRowCount() - 1, b.r2 + 1);
        for (let c = b.c1; c <= b.c2; c++) {
          setCell(targetR, c, `=SUM(${rcToRef(b.r1, c)}:${rcToRef(b.r2, c)})`);
        }
      }
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const sortByColumn = (asc: boolean) => {
      if (readOnly) return;
      pushUndo();
      const col = anchorC;
      const filled = compactSheetRows(model.columns.length, model.rows);
      filled.sort((a, b) => {
        const va = a[col] ?? "";
        const vb = b[col] ?? "";
        if (va === "" && vb === "") return 0;
        if (va === "") return 1;
        if (vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") return asc ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return asc ? cmp : -cmp;
      });
      model.rows = filled;
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const insertRowAt = () => {
      if (readOnly) return;
      pushUndo();
      ensureRow(anchorR);
      model.rows.splice(
        anchorR,
        0,
        Array.from({ length: model.columns.length }, () => ""),
      );
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const removeRowAt = () => {
      if (readOnly || anchorR >= model.rows.length) return;
      pushUndo();
      model.rows.splice(anchorR, 1);
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const addColumnAt = async () => {
      if (readOnly) return;
      const defaultName = `${labels.newColDefault} ${model.columns.length + 1}`;
      const name = await promptInline(labels.renameColPrompt, defaultName);
      if (name === null) return;
      const clean = name.trim() || defaultName;
      pushUndo();
      model.columns.push(clean);
      for (const row of model.rows) row.push("");
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const removeLastCol = () => {
      if (readOnly || model.columns.length <= 1) return;
      pushUndo();
      model.columns.pop();
      for (const row of model.rows) row.pop();
      anchorC = Math.min(anchorC, model.columns.length - 1);
      focusC = Math.min(focusC, model.columns.length - 1);
      renderGrid();
      syncFormulaBar();
      emit();
    };

    const copyCsvBtn = iconBtn(ICONS.copy, labels.copyCsv, () => {
      const csv = sheetToCsv(model.columns, compactSheetRows(model.columns.length, model.rows));
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(csv);
      copyCsvBtn.innerHTML = icon(ICONS.check);
      copyCsvBtn.classList.add("active");
      setTimeout(() => {
        copyCsvBtn.innerHTML = icon(ICONS.copy);
        copyCsvBtn.classList.remove("active");
      }, 1200);
    });

    if (!readOnly) {
      toolbar.append(
        group(null, [undoBtn, redoBtn], true),
        group(null, [
          iconBtn(ICONS.sigma, labels.autoSum, doAutoSum),
          iconBtn(ICONS.sortAsc, labels.sortAsc, () => sortByColumn(true)),
          iconBtn(ICONS.sortDesc, labels.sortDesc, () => sortByColumn(false)),
        ]),
        group("p1", [
          iconBtn(ICONS.insRow, labels.addRow, insertRowAt),
          iconBtn(ICONS.trash, labels.delRow, removeRowAt),
          iconBtn(ICONS.insCol, labels.addCol, () => void addColumnAt()),
          iconBtn(null, labels.delCol, removeLastCol, "-Col"),
        ]),
        group("p2", [copyCsvBtn]),
      );
      app.appendChild(toolbar);
    }

    app.append(fbar, gridScroll);
    mount.appendChild(app);

    namebox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const parsed = parseRangeText(namebox.value);
        if (parsed) selectRange(parsed.r1, parsed.c1, parsed.r2, parsed.c2);
        gridScroll.focus();
      } else if (e.key === "Escape") {
        syncFormulaBar();
        gridScroll.focus();
      }
    });

    finput.addEventListener("keydown", (e) => {
      if (readOnly) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const nextVal = coerceCellInput(finput.value);
        if (nextVal !== getCell(anchorR, anchorC)) {
          pushUndo();
          setCell(anchorR, anchorC, nextVal);
          renderGrid();
          emit();
        }
        selectRange(anchorR + 1, anchorC);
        gridScroll.focus();
      } else if (e.key === "Escape") {
        syncFormulaBar();
        gridScroll.focus();
      }
    });

    cellEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.altKey) {
        e.preventDefault();
        commitEdit([e.shiftKey ? -1 : 1, 0]);
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit([0, e.shiftKey ? -1 : 1]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    });
    cellEditor.addEventListener("blur", () => {
      if (editing) commitEdit();
    });

    const onMouseUp = () => {
      dragging = false;
    };
    document.addEventListener("mouseup", onMouseUp);

    gridScroll.addEventListener("keydown", (e) => {
      if (editing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        const b = selBounds();
        const lines: string[] = [];
        for (let r = b.r1; r <= b.r2; r++) {
          const cols: string[] = [];
          for (let c = b.c1; c <= b.c2; c++) cols.push(String(getCell(r, c)));
          lines.push(cols.join("\t"));
        }
        if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(lines.join("\n"));
        return;
      }
      if (!readOnly && mod && e.key.toLowerCase() === "v") {
        if (navigator.clipboard?.readText) {
          e.preventDefault();
          void navigator.clipboard.readText().then((txt) => {
            if (!txt) return;
            const grid = parseTsv(txt);
            pushUndo();
            for (let dr = 0; dr < grid.length; dr++) {
              for (let dc = 0; dc < grid[dr]!.length; dc++) {
                setCell(anchorR + dr, anchorC + dc, coerceCellInput(grid[dr]![dc]!));
              }
            }
            renderGrid();
            syncFormulaBar();
            emit();
          });
        }
        return;
      }

      const move = (dr: number, dc: number) => {
        if (e.shiftKey) {
          focusR = Math.max(0, Math.min(visualRowCount() - 1, focusR + dr));
          focusC = Math.max(0, Math.min(model.columns.length - 1, focusC + dc));
          paintSelection();
          syncFormulaBar();
        } else {
          selectRange(anchorR + dr, anchorC + dc);
        }
      };

      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1, 0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1, 0);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(0, -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        move(0, 1);
      } else if (e.key === "Tab") {
        e.preventDefault();
        selectRange(anchorR, anchorC + (e.shiftKey ? -1 : 1));
      } else if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        startEdit(anchorR, anchorC);
      } else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly) {
        e.preventDefault();
        const b = selBounds();
        pushUndo();
        for (let r = b.r1; r <= b.r2; r++) {
          for (let c = b.c1; c <= b.c2; c++) {
            if (r < model.rows.length) setCell(r, c, "");
          }
        }
        renderGrid();
        syncFormulaBar();
        emit();
      } else if (!readOnly && !mod && !e.altKey && e.key.length === 1) {
        e.preventDefault();
        startEdit(anchorR, anchorC, e.key);
      }
    });

    updateUndoBtns();
    renderGrid();
    syncFormulaBar();

    return () => {
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [readOnly, resetKey, labels]);

  return <div ref={hostRef} className="cfos-workbench-host" />;
}
