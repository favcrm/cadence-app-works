import { Button, Field, Select } from "@cadence/screen-ui";
import type { Dispatch } from "react";
import {
  DOC_BLOCK_TYPES,
  editCell,
  type Cell,
  type Content,
  type DeckSlide,
  type DocBlock,
  type DocBlockType,
} from "../../domain/works";
import { useLocale } from "./locale";

type Edit<T extends Content["kind"]> = Dispatch<Extract<Content, { kind: T }>>;

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
const replaceAt = <T,>(list: T[], index: number, value: T): T[] =>
  list.map((entry, i) => (i === index ? value : entry));

function RowTools({
  index,
  count,
  onMove,
  onRemove,
  noun,
}: {
  index: number;
  count: number;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  noun: string;
}) {
  const { t } = useLocale();
  return (
    <div className="works-row-tools" role="group" aria-label={noun}>
      <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>
        {t("editor.up")}
      </Button>
      <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)}>
        {t("editor.down")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onRemove}>
        {t("editor.remove")}
      </Button>
    </div>
  );
}

export function ContentEditor({
  content,
  numeric = [],
  onChange,
}: {
  content: Content;
  numeric?: readonly boolean[];
  onChange: Dispatch<Content>;
}) {
  if (content.kind === "doc") return <DocEditor content={content} onChange={onChange} />;
  if (content.kind === "deck") return <DeckEditor content={content} onChange={onChange} />;
  return <SheetEditor content={content} numeric={numeric} onChange={onChange} />;
}

function DocEditor({ content, onChange }: { content: Extract<Content, { kind: "doc" }>; onChange: Edit<"doc"> }) {
  const { t } = useLocale();
  const set = (blocks: DocBlock[]) => onChange({ kind: "doc", blocks });
  const typeOptions = DOC_BLOCK_TYPES.map((value) => ({
    value,
    label: value === "h2" ? t("editor.type_heading") : value === "p" ? t("editor.type_paragraph") : t("editor.type_callout"),
  }));
  return (
    <div className="works-editor">
      {content.blocks.map((block, index) => (
        <div key={index} className="works-edit-card">
          <div className="works-edit-head">
            <Field label={t("editor.block_type", { n: index + 1 })}>
              {(control) => (
                <Select
                  {...control}
                  size="sm"
                  value={block.type}
                  options={typeOptions}
                  onChange={(value) => {
                    const type = value as DocBlockType;
                    const next: DocBlock = { type, text: block.text };
                    if (type === "callout" && block.label) next.label = block.label;
                    set(replaceAt(content.blocks, index, next));
                  }}
                />
              )}
            </Field>
            <RowTools
              index={index}
              count={content.blocks.length}
              noun={t("editor.block_n", { n: index + 1 })}
              onMove={(by) => set(move(content.blocks, index, by))}
              onRemove={() => set(content.blocks.filter((_, i) => i !== index))}
            />
          </div>
          {block.type === "callout" ? (
            <Field label={t("editor.callout_label")}>
              {(control) => (
                <input
                  {...control}
                  className="field"
                  value={block.label ?? ""}
                  onChange={(e) => set(replaceAt(content.blocks, index, { ...block, label: e.target.value }))}
                />
              )}
            </Field>
          ) : null}
          <Field label={t("editor.block_text", { n: index + 1 })}>
            {(control) => (
              <textarea
                {...control}
                className="field works-textarea"
                rows={block.type === "h2" ? 1 : 3}
                value={block.text}
                onChange={(e) => set(replaceAt(content.blocks, index, { ...block, text: e.target.value }))}
              />
            )}
          </Field>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => set([...content.blocks, { type: "p", text: "" }])}>
          {t("editor.add_block")}
        </Button>
      </div>
    </div>
  );
}

function DeckEditor({ content, onChange }: { content: Extract<Content, { kind: "deck" }>; onChange: Edit<"deck"> }) {
  const { t } = useLocale();
  const set = (slides: DeckSlide[]) => onChange({ kind: "deck", slides });
  return (
    <div className="works-editor">
      {content.slides.map((slide, index) => (
        <div key={index} className="works-edit-card">
          <div className="works-edit-head">
            <strong>{t("view.slide_no", { n: index + 1 })}</strong>
            <RowTools
              index={index}
              count={content.slides.length}
              noun={t("view.slide_no", { n: index + 1 })}
              onMove={(by) => set(move(content.slides, index, by))}
              onRemove={() => set(content.slides.filter((_, i) => i !== index))}
            />
          </div>
          <Field label={t("editor.slide_title")}>
            {(control) => (
              <input
                {...control}
                className="field"
                value={slide.title}
                onChange={(e) => set(replaceAt(content.slides, index, { ...slide, title: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t("editor.slide_body")}>
            {(control) => (
              <textarea
                {...control}
                className="field works-textarea"
                rows={3}
                value={slide.body}
                onChange={(e) => set(replaceAt(content.slides, index, { ...slide, body: e.target.value }))}
              />
            )}
          </Field>
          <Field label={t("editor.slide_notes")}>
            {(control) => (
              <textarea
                {...control}
                className="field works-textarea"
                rows={2}
                value={slide.notes ?? ""}
                onChange={(e) => set(replaceAt(content.slides, index, { ...slide, notes: e.target.value }))}
              />
            )}
          </Field>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => set([...content.slides, { title: "", body: "" }])}>
          {t("editor.add_slide")}
        </Button>
      </div>
    </div>
  );
}

function SheetEditor({
  content,
  numeric,
  onChange,
}: {
  content: Extract<Content, { kind: "sheet" }>;
  numeric: readonly boolean[];
  onChange: Edit<"sheet">;
}) {
  const { t } = useLocale();
  const { columns, rows } = content;
  const set = (next: { columns?: string[]; rows?: Cell[][] }) =>
    onChange({ kind: "sheet", columns: next.columns ?? columns, rows: next.rows ?? rows });
  return (
    <div className="works-editor">
      <div className="works-sheet-scroll" role="region" tabIndex={0} aria-label={t("editor.sheet_label")}>
        <table className="stable works-sheet-edit">
          <thead>
            <tr>
              {columns.map((column, c) => (
                <th key={c} scope="col">
                  <Field label={t("editor.column_n", { n: c + 1 })}>
                    {(control) => (
                      <input
                        {...control}
                        className="field"
                        value={column}
                        onChange={(e) => set({ columns: replaceAt(columns, c, e.target.value) })}
                      />
                    )}
                  </Field>
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">{t("editor.row_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <input
                      className="field"
                      aria-label={t("editor.cell", { r: r + 1, c: c + 1 })}
                      value={String(cell)}
                      onChange={(e) =>
                        set({ rows: replaceAt(rows, r, replaceAt(row, c, editCell(numeric[c] === true, e.target.value))) })
                      }
                    />
                  </td>
                ))}
                <td>
                  <Button size="sm" variant="ghost" onClick={() => set({ rows: rows.filter((_, i) => i !== r) })}>
                    {t("editor.remove_row")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="works-row-tools">
        <Button size="sm" onClick={() => set({ rows: [...rows, columns.map(() => "")] })}>
          {t("editor.add_row")}
        </Button>
        <Button size="sm" onClick={() => set({ columns: [...columns, ""], rows: rows.map((row) => [...row, ""]) })}>
          {t("editor.add_column")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={columns.length <= 1}
          onClick={() =>
            set({ columns: columns.slice(0, -1), rows: rows.map((row) => row.slice(0, -1)) })
          }
        >
          {t("editor.remove_column")}
        </Button>
      </div>
    </div>
  );
}
