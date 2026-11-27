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
      titleStyle: t("cfos.doc_title_style"),
      heading1: t("cfos.doc_heading_one"),
      heading: t("editor.type_heading"),
      heading3: t("cfos.doc_heading_three"),
      quote: t("cfos.doc_quote"),
      codeBlock: t("cfos.doc_code_block"),
      callout: t("editor.type_callout"),
      calloutPrompt: t("editor.callout_label"),
      calloutPlaceholder: t("cfos.doc_callout_placeholder"),
      fontLabel: t("cfos.doc_font"),
      fontSizeLabel: t("cfos.doc_font_size"),
      undo: t("cfos.undo"),
      redo: t("cfos.redo"),
      bold: t("cfos.doc_bold"),
      italic: t("cfos.doc_italic"),
      underline: t("cfos.doc_underline"),
      strike: t("cfos.doc_strike"),
      code: t("cfos.doc_code"),
      textColor: t("cfos.text_color"),
      highlightColor: t("cfos.highlight_color"),
      alignLeft: t("cfos.align_left"),
      alignCenter: t("cfos.align_center"),
      alignRight: t("cfos.align_right"),
      alignJustify: t("cfos.align_justify"),
      outdent: t("cfos.doc_outdent"),
      indent: t("cfos.doc_indent"),
      bullets: t("cfos.doc_bullets"),
      numbered: t("cfos.doc_numbered"),
      link: t("cfos.doc_link"),
      linkPrompt: t("cfos.doc_link_prompt"),
      linkEdit: t("action.edit"),
      linkRemove: t("cfos.doc_link_remove"),
      insertImage: t("cfos.insert_image"),
      horizontalRule: t("cfos.doc_hr"),
      clearFormat: t("cfos.doc_clear_format"),
      exportMenu: t("action.export"),
      copyMarkdown: t("cfos.doc_copy_md"),
      downloadDocx: t("cfos.download_docx"),
      downloadMarkdown: t("cfos.download_md"),
      downloadHtml: t("cfos.download_html"),
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
      insertFunction: t("cfos.sheet_insert_fn"),
      numberFormat: t("cfos.sheet_num_format"),
      currency: t("cfos.sheet_currency"),
      percent: t("cfos.sheet_percent"),
      decDec: t("cfos.sheet_dec_dec"),
      incDec: t("cfos.sheet_inc_dec"),
      bold: t("cfos.doc_bold"),
      italic: t("cfos.doc_italic"),
      underline: t("cfos.doc_underline"),
      strike: t("cfos.doc_strike"),
      textColor: t("cfos.text_color"),
      fillColor: t("cfos.sheet_fill_color"),
      alignLeft: t("cfos.align_left"),
      alignCenter: t("cfos.align_center"),
      alignRight: t("cfos.align_right"),
      wrapText: t("cfos.sheet_wrap"),
      sortAsc: t("cfos.sheet_sort_asc"),
      sortDesc: t("cfos.sheet_sort_desc"),
      addRow: t("editor.add_row"),
      delRow: t("editor.remove_row"),
      addCol: t("editor.add_column"),
      delCol: t("editor.remove_column"),
      freezeRow: t("cfos.sheet_freeze"),
      clearFormat: t("cfos.doc_clear_format"),
      exportMenu: t("action.export"),
      downloadXlsx: t("cfos.sheet_dl_xlsx"),
      downloadCsv: t("cfos.sheet_dl_csv"),
      copyCsv: t("cfos.sheet_copy_csv"),
      renameColPrompt: t("cfos.sheet_rename_col"),
      newColDefault: t("cfos.sheet_col_default"),
      nameBoxTitle: t("cfos.sheet_name_box"),
      formulaPlaceholder: t("cfos.sheet_formula_hint"),
      addSheet: t("cfos.sheet_add_tab"),
      renameSheet: t("cfos.sheet_rename_tab"),
      duplicateSheet: t("cfos.sheet_dup_tab"),
      deleteSheet: t("cfos.sheet_del_tab"),
      ctxCut: t("cfos.ctx_cut"),
      ctxCopy: t("cfos.ctx_copy"),
      ctxPaste: t("cfos.ctx_paste"),
      ctxClear: t("cfos.ctx_clear"),
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
      tplTwoCol: t("cfos.slides_tpl_twocol"),
      tplTwoColDesc: t("cfos.slides_tpl_twocol_desc"),
      tplFourCol: t("cfos.slides_tpl_fourcol"),
      tplFourColDesc: t("cfos.slides_tpl_fourcol_desc"),
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
      componentsTab: t("cfos.slides_components_tab"),
      inspectorTab: t("cfos.slides_inspector_tab"),
      slideBackground: t("cfos.slides_bg"),
      slideInset: t("cfos.slides_inset"),
      slideDotGrid: t("cfos.slides_dotgrid"),
      slideCoverArt: t("cfos.slides_cover_art"),
      fieldX: t("cfos.slides_x"),
      fieldY: t("cfos.slides_y"),
      fieldW: t("cfos.slides_w"),
      fieldH: t("cfos.slides_h"),
      bringForward: t("cfos.slides_bring_forward"),
      sendBackward: t("cfos.slides_send_backward"),
      deleteBlock: t("editor.remove"),
      duplicateBlock: t("cfos.slides_duplicate_block"),
      uploadImage: t("cfos.insert_image"),
      exportMenu: t("action.export"),
      exportPptx: t("cfos.download_pptx"),
      exportHtml: t("cfos.download_html"),
      fieldNotes: t("editor.slide_notes"),
      toggleSlidesRail: t("cfos.slides_toggle_rail"),
      toggleInspector: t("cfos.slides_toggle_inspector"),
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
