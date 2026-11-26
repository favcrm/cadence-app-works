import type { Dispatch } from "react";
import type { Content } from "../../domain/works";
import { DocWorkbench } from "../../cfos/docs/DocWorkbench";
import { useDocLabels, useSheetLabels, useSlidesLabels } from "../../cfos/labels";
import { SheetWorkbench } from "../../cfos/sheets/SheetWorkbench";
import { SlidesWorkbench } from "../../cfos/slides/SlidesWorkbench";

export function ContentEditor({
  title = "",
  content,
  resetKey = 0,
  onChange,
}: {
  title?: string;
  content: Content;
  numeric?: readonly boolean[];
  resetKey?: number;
  onChange: Dispatch<Content>;
}) {
  const docLabels = useDocLabels();
  const sheetLabels = useSheetLabels();
  const slidesLabels = useSlidesLabels();

  if (content.kind === "doc") {
    return (
      <DocWorkbench
        documentTitle={title}
        blocks={content.blocks}
        readOnly={false}
        resetKey={resetKey}
        labels={docLabels}
        onChange={(blocks) => onChange({ kind: "doc", blocks })}
      />
    );
  }
  if (content.kind === "deck") {
    return (
      <SlidesWorkbench
        documentTitle={title}
        slides={content.slides}
        readOnly={false}
        resetKey={resetKey}
        labels={slidesLabels}
        onChange={(slides) => onChange({ kind: "deck", slides })}
      />
    );
  }
  return (
    <SheetWorkbench
      documentTitle={title}
      columns={content.columns}
      rows={content.rows}
      readOnly={false}
      resetKey={resetKey}
      labels={sheetLabels}
      onChange={({ columns, rows }) => onChange({ kind: "sheet", columns, rows })}
    />
  );
}
