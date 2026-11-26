import { useMemo } from "react";
import type { Kind } from "../bridge/operations";
import type { Content } from "../domain/works";
import { useLocale } from "../features/works/locale";
import type { DocLabels } from "./docs/DocWorkbench";
import type { SheetLabels } from "./sheets/SheetWorkbench";
import type { SlidesLabels } from "./slides/SlidesWorkbench";

export function useDocLabels(): DocLabels {
  const { t } = useLocale();
  return useMemo(
    () => ({
      blockStyle: t("cfos.doc_block_style"),
      paragraph: t("editor.type_paragraph"),
      heading: t("editor.type_heading"),
      callout: t("editor.type_callout"),
      calloutPrompt: t("editor.callout_label"),
      calloutPlaceholder: t("cfos.doc_callout_placeholder"),
      undo: t("cfos.undo"),
      redo: t("cfos.redo"),
      bold: t("cfos.doc_bold"),
      italic: t("cfos.doc_italic"),
      underline: t("cfos.doc_underline"),
      strike: t("cfos.doc_strike"),
      code: t("cfos.doc_code"),
      bullets: t("cfos.doc_bullets"),
      numbered: t("cfos.doc_numbered"),
      link: t("cfos.doc_link"),
      linkPrompt: t("cfos.doc_link_prompt"),
      clearFormat: t("cfos.doc_clear_format"),
      copyMarkdown: t("cfos.doc_copy_md"),
      copied: t("cfos.copied"),
      emptyPlaceholder: t("cfos.doc_empty_placeholder"),
    }),
    [t],
  );
}

export function useSheetLabels(): SheetLabels {
  const { t } = useLocale();
  return useMemo(
    () => ({
      undo: t("cfos.undo"),
      redo: t("cfos.redo"),
      autoSum: t("cfos.sheet_autosum"),
      sortAsc: t("cfos.sheet_sort_asc"),
      sortDesc: t("cfos.sheet_sort_desc"),
      addRow: t("editor.add_row"),
      delRow: t("editor.remove_row"),
      addCol: t("editor.add_column"),
      delCol: t("editor.remove_column"),
      copyCsv: t("cfos.sheet_copy_csv"),
      renameColPrompt: t("cfos.sheet_rename_col"),
      newColDefault: t("cfos.sheet_col_default"),
      nameBoxTitle: t("cfos.sheet_name_box"),
      formulaPlaceholder: t("cfos.sheet_formula_hint"),
    }),
    [t],
  );
}

export function useSlidesLabels(): SlidesLabels {
  const { t } = useLocale();
  return useMemo(
    () => ({
      searchSlides: t("cfos.slides_search"),
      addSlide: t("editor.add_slide"),
      addLayoutTitle: t("cfos.slides_choose_layout"),
      tplCover: t("cfos.slides_tpl_cover"),
      tplCoverDesc: t("cfos.slides_tpl_cover_desc"),
      tplContent: t("cfos.slides_tpl_content"),
      tplContentDesc: t("cfos.slides_tpl_content_desc"),
      tplBullets: t("cfos.slides_tpl_bullets"),
      tplBulletsDesc: t("cfos.slides_tpl_bullets_desc"),
      prevSlide: t("cfos.slides_prev"),
      nextSlide: t("cfos.slides_next"),
      jumpToSlide: t("cfos.slides_jump"),
      undo: t("cfos.undo"),
      redo: t("cfos.redo"),
      editMode: t("action.edit"),
      presentMode: t("cfos.slides_present"),
      exitPresent: t("cfos.slides_exit_present"),
      duplicateSlide: t("cfos.slides_duplicate"),
      deleteSlide: t("editor.remove"),
      inspectorTitle: t("cfos.slides_inspector"),
      fieldTitle: t("editor.slide_title"),
      fieldBody: t("editor.slide_body"),
      fieldNotes: t("editor.slide_notes"),
      formatBullets: t("cfos.slides_format_bullets"),
      slideSection: t("kind.deck"),
      slideEyebrow: t("cfos.slides_eyebrow"),
    }),
    [t],
  );
}

export function starterDraft(
  kind: Kind,
  t: ReturnType<typeof useLocale>["t"],
): { title: string; content: Content } {
  if (kind === "doc") {
    return {
      title: t("starter.doc_title"),
      content: {
        kind: "doc",
        blocks: [
          { type: "h2", text: t("starter.doc_heading") },
          { type: "p", text: t("starter.doc_body") },
        ],
      },
    };
  }
  if (kind === "sheet") {
    return {
      title: t("starter.sheet_title"),
      content: {
        kind: "sheet",
        columns: [t("starter.sheet_col_a"), t("starter.sheet_col_b"), t("starter.sheet_col_c")],
        rows: [
          ["Item A", 1200, "=B1*1.1"],
          ["Item B", 800, "=B2*1.1"],
          ["Total", "=SUM(B1:B2)", "=SUM(C1:C2)"],
        ],
      },
    };
  }
  return {
    title: t("starter.deck_title"),
    content: {
      kind: "deck",
      slides: [
        { title: t("starter.deck_cover_title"), body: t("starter.deck_cover_body") },
        { title: t("starter.deck_points_title"), body: t("starter.deck_points_body") },
      ],
    },
  };
}
