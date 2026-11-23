import { DataTable } from "@cadence/screen-ui";
import type { Cell, Content } from "../../domain/works";
import { useLocale } from "./locale";

// Read-only renderers for the v0 grammar. They are the whole canvas surface
// and the Preview tab of the editor.

export function ContentView({ content }: { content: Content }) {
  if (content.kind === "doc") return <DocView blocks={content.blocks} />;
  if (content.kind === "deck") return <DeckView slides={content.slides} />;
  return <SheetView columns={content.columns} rows={content.rows} />;
}

function DocView({ blocks }: { blocks: Extract<Content, { kind: "doc" }>["blocks"] }) {
  const { t } = useLocale();
  if (!blocks.length) return <p className="works-muted">{t("view.doc_empty")}</p>;
  return (
    <article className="works-doc">
      {blocks.map((block, index) =>
        block.type === "h2" ? (
          <h3 key={index} className="works-doc-heading">
            {block.text}
          </h3>
        ) : block.type === "callout" ? (
          <aside key={index} className="works-callout">
            {block.label ? <strong className="works-callout-label">{block.label}</strong> : null}
            <p>{block.text}</p>
          </aside>
        ) : (
          <p key={index} className="works-doc-p">
            {block.text}
          </p>
        ),
      )}
    </article>
  );
}

function DeckView({ slides }: { slides: Extract<Content, { kind: "deck" }>["slides"] }) {
  const { t } = useLocale();
  if (!slides.length) return <p className="works-muted">{t("view.deck_empty")}</p>;
  return (
    <ol className="works-deck">
      {slides.map((slide, index) => (
        <li key={index} className="works-slide">
          <span className="works-slide-no">{t("view.slide_no", { n: index + 1 })}</span>
          <h3 className="works-slide-title">{slide.title}</h3>
          <p className="works-slide-body">{slide.body}</p>
          {slide.notes ? (
            <p className="works-slide-notes">
              <strong>{t("view.notes")}</strong> {slide.notes}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SheetView({ columns, rows }: { columns: string[]; rows: Cell[][] }) {
  const { t } = useLocale();
  if (!rows.length) return <p className="works-muted">{t("view.sheet_empty")}</p>;
  return (
    <DataTable
      label={t("view.sheet_label")}
      rows={rows}
      rowKey={(_, index) => index}
      columns={columns.map((header, column) => ({
        key: String(column),
        header,
        cellClassName: typeof rows[0]?.[column] === "number" ? "num" : undefined,
        cell: (row: Cell[]) => String(row[column] ?? ""),
      }))}
    />
  );
}
