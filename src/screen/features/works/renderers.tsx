import type { Content } from "../../domain/works";
import { DocWorkbench } from "../../cfos/docs/DocWorkbench";
import { useDocLabels, useSheetLabels, useSlidesLabels } from "../../cfos/labels";
import { SheetWorkbench } from "../../cfos/sheets/SheetWorkbench";
import { SlidesWorkbench } from "../../cfos/slides/SlidesWorkbench";

const noop = () => undefined;

export function ContentView({
  title = "",
  content,
  resetKey = 0,
}: {
  title?: string;
  content: Content;
  resetKey?: number;
}) {
  const docLabels = useDocLabels();
  const sheetLabels = useSheetLabels();
  const slidesLabels = useSlidesLabels();

  if (content.kind === "doc") {
    return (
      <DocWorkbench
        documentTitle={title}
        blocks={content.blocks}
        readOnly={true}
        resetKey={resetKey}
        labels={docLabels}
        onChange={noop}
      />
    );
  }
  if (content.kind === "deck") {
    return (
      <SlidesWorkbench
        documentTitle={title}
        slides={content.slides}
        readOnly={true}
        resetKey={resetKey}
        labels={slidesLabels}
        onChange={noop}
      />
    );
  }
  return (
    <SheetWorkbench
      documentTitle={title}
      columns={content.columns}
      rows={content.rows}
      readOnly={true}
      resetKey={resetKey}
      labels={sheetLabels}
      onChange={noop}
    />
  );
}
