// Works screen copy for `screen-locale.v1`. Every key carries both locales;
// "zh-TW" is the host's locale key and is written as Traditional Chinese.
// `{name}` placeholders must appear in both locales (tests/locale_catalog.test.mjs).

export const messages = {
  "screen.title": { en: "Works", "zh-TW": "文件工作台" },
  "screen.opening": { en: "Opening Works…", "zh-TW": "正在開啟文件工作台…" },
  "screen.unreachable": {
    en: "The workspace is not answering. Reload the page to try again.",
    "zh-TW": "工作區未回應，請重新整理頁面再試。",
  },

  "kind.doc": { en: "Doc", "zh-TW": "文件" },
  "kind.deck": { en: "Deck", "zh-TW": "簡報" },
  "kind.sheet": { en: "Sheet", "zh-TW": "試算表" },

  "action.back": { en: "Back to Works", "zh-TW": "返回列表" },
  "action.new": { en: "New", "zh-TW": "新增" },
  "action.new_doc": { en: "+ Doc", "zh-TW": "+ 文件" },
  "action.new_sheet": { en: "+ Sheet", "zh-TW": "+ 試算表" },
  "action.new_deck": { en: "+ Deck", "zh-TW": "+ 簡報" },
  "action.create": { en: "Create", "zh-TW": "建立" },
  "action.cancel": { en: "Cancel", "zh-TW": "取消" },
  "action.edit": { en: "Edit", "zh-TW": "編輯" },
  "action.preview": { en: "Preview", "zh-TW": "預覽" },
  "action.save": { en: "Save", "zh-TW": "儲存" },
  "action.reload": { en: "Reload", "zh-TW": "重新載入" },
  "action.refresh": { en: "Refresh", "zh-TW": "重新整理" },
  "action.retry": { en: "Retry", "zh-TW": "重試" },
  "action.search": { en: "Search", "zh-TW": "搜尋" },
  "action.request_review": { en: "Request review", "zh-TW": "要求審閱" },
  "action.review": { en: "Review", "zh-TW": "審閱" },
  "action.export": { en: "Export", "zh-TW": "匯出" },
  "action.trash": { en: "Move to trash", "zh-TW": "移至垃圾桶" },
  "action.discard_reload": { en: "Discard edits and reload", "zh-TW": "捨棄編輯並重新載入" },
  "action.restore": { en: "Restore", "zh-TW": "還原" },

  "list.loading": { en: "Loading Works…", "zh-TW": "正在載入…" },
  "list.table": { en: "Works table", "zh-TW": "文件列表" },
  "list.empty_title": { en: "Nothing here yet", "zh-TW": "目前沒有內容" },
  "list.empty_body": {
    en: "Create a doc, deck or sheet to get started.",
    "zh-TW": "建立文件、簡報或試算表即可開始。",
  },
  "list.empty_filtered": {
    en: "No items match this search or filter.",
    "zh-TW": "沒有符合此搜尋或篩選的項目。",
  },
  "column.title": { en: "Title", "zh-TW": "標題" },
  "column.kind": { en: "Kind", "zh-TW": "類型" },
  "column.revision": { en: "Revision", "zh-TW": "版本" },
  "column.review": { en: "Review", "zh-TW": "審閱" },
  "column.updated": { en: "Updated", "zh-TW": "更新時間" },
  "filter.review": { en: "Review filter", "zh-TW": "審閱篩選" },
  "filter.review_all": { en: "All reviews", "zh-TW": "全部審閱狀態" },
  "filter.sort": { en: "Sort order", "zh-TW": "排序方式" },
  "sort.updated": { en: "Recently updated", "zh-TW": "最近更新" },
  "sort.name": { en: "Name", "zh-TW": "名稱" },

  "review.draft": { en: "Draft", "zh-TW": "草稿" },
  "review.pending": { en: "Review pending", "zh-TW": "待審閱" },
  "review.changes": { en: "Changes requested", "zh-TW": "需要修改" },
  "review.reviewed": { en: "Reviewed", "zh-TW": "已審閱" },
  "review.edited": { en: "Edited since review", "zh-TW": "審閱後已編輯" },

  "detail.loading": { en: "Opening…", "zh-TW": "正在開啟…" },
  "detail.mode": { en: "View mode", "zh-TW": "檢視模式" },
  "detail.revision": { en: "r{n}", "zh-TW": "r{n}" },

  "status.saved": { en: "Saved", "zh-TW": "已儲存" },
  "status.saving": { en: "Saving…", "zh-TW": "儲存中…" },
  "status.unsaved": { en: "Unsaved", "zh-TW": "未儲存" },
  "status.conflict": { en: "Conflict", "zh-TW": "版本衝突" },
  "status.offline": { en: "Save failed", "zh-TW": "儲存失敗" },

  "field.title": { en: "Title", "zh-TW": "標題" },
  "field.kind": { en: "Kind", "zh-TW": "類型" },
  "new.title": { en: "New item", "zh-TW": "新增項目" },
  "hint.save_first": { en: "Save your edits first.", "zh-TW": "請先儲存編輯。" },

  "notice.saved": { en: "Saved as revision {n}.", "zh-TW": "已儲存為第 {n} 版。" },
  "notice.review_requested": {
    en: "Review requested for revision {n}.",
    "zh-TW": "已要求審閱第 {n} 版。",
  },
  "notice.review_recorded": { en: "Review recorded.", "zh-TW": "已記錄審閱結果。" },
  "notice.exported": {
    en: "Export receipt: revision {n}, format {format}, digest {digest}.",
    "zh-TW": "匯出收據：第 {n} 版，格式 {format}，摘要 {digest}。",
  },

  "stale.title": { en: "This item changed elsewhere.", "zh-TW": "此項目已在別處變更。" },
  "stale.body": {
    en: "Your edits were not saved and nothing was overwritten. Reload to see the latest revision.",
    "zh-TW": "你的編輯未儲存，也沒有覆寫任何內容。請重新載入以查看最新版本。",
  },

  "reload.title": { en: "Discard your edits?", "zh-TW": "要捨棄你的編輯嗎？" },
  "reload.body": {
    en: "Reloading replaces your unsaved edits with the latest saved revision.",
    "zh-TW": "重新載入會以最新已儲存的版本取代你尚未儲存的編輯。",
  },

  "trash.title": { en: "Move to trash?", "zh-TW": "移至垃圾桶？" },
  "trash.body": {
    en: "“{title}” leaves the list. You can restore it right after.",
    "zh-TW": "「{title}」會從列表中移除，之後可立即還原。",
  },
  "trash.done": { en: "Moved “{title}” to trash.", "zh-TW": "已將「{title}」移至垃圾桶。" },

  "load.unavailable": {
    en: "This workspace does not allow Works to be read right now.",
    "zh-TW": "此工作區目前不允許讀取文件。",
  },
  "load.canvas_unavailable": {
    en: "This chat view cannot read Works yet. Open Works to view it.",
    "zh-TW": "對話檢視尚未支援讀取文件，請開啟文件工作台查看。",
  },

  "problem.title_required": { en: "Give it a title.", "zh-TW": "請輸入標題。" },
  "problem.title_long": { en: "The title is too long.", "zh-TW": "標題太長。" },
  "problem.block_text": { en: "Every block needs text.", "zh-TW": "每個區塊都需要文字。" },
  "problem.slide_text": {
    en: "Every slide needs a title and a body.",
    "zh-TW": "每張投影片都需要標題和內文。",
  },
  "problem.column_name": {
    en: "A sheet needs at least one column, and every column needs a name.",
    "zh-TW": "試算表至少需要一欄，而且每欄都要有名稱。",
  },
  "problem.sheet_shape": { en: "Every row must match the columns.", "zh-TW": "每一列都必須與欄位數目一致。" },
  "problem.content_large": {
    en: "This is too large to save. Shorten the content.",
    "zh-TW": "內容太大，無法儲存。請縮減內容。",
  },

  "error.generic": { en: "Something went wrong. Try again.", "zh-TW": "發生錯誤，請再試一次。" },
  "error.malformed": {
    en: "The workspace sent an unexpected reply, so nothing was changed on screen. Reload and try again.",
    "zh-TW": "工作區傳回了無法辨識的回應，畫面沒有任何變更。請重新載入後再試。",
  },
  "error.lost": {
    en: "The connection to the workspace was lost. Reload the page to continue.",
    "zh-TW": "與工作區的連線已中斷，請重新整理頁面繼續。",
  },
  "error.forbidden": {
    en: "Your role cannot perform this action.",
    "zh-TW": "你的角色無法執行此操作。",
  },
  "error.invalid": { en: "The workspace refused this as invalid.", "zh-TW": "工作區拒絕了此請求，內容無效。" },
  "error.not_found": { en: "This item was not found.", "zh-TW": "找不到此項目。" },
  "error.needs_review": {
    en: "Export needs an approved current revision.",
    "zh-TW": "匯出需要已核准的最新版本。",
  },
  "error.facts_changed": {
    en: "That changed in the meantime. Reload before trying again.",
    "zh-TW": "內容在此期間已變更，請重新載入後再試。",
  },
  "error.unauthorized": {
    en: "This app's access is no longer available.",
    "zh-TW": "此應用程式的存取權已失效。",
  },
  "error.expired": { en: "This confirmation has expired.", "zh-TW": "此確認已過期。" },
  "error.rejected": { en: "The workspace refused this request.", "zh-TW": "工作區拒絕了此請求。" },
  "error.timeout": {
    en: "The workspace did not answer in time. Check the latest state before trying again.",
    "zh-TW": "工作區未能及時回應。請先確認最新狀態再重試。",
  },
  "error.busy": {
    en: "Works is busy. Wait for the current request to finish.",
    "zh-TW": "系統忙碌中，請等待目前的請求完成。",
  },
  "error.review_unavailable": {
    en: "Review and export are not available in this workspace yet.",
    "zh-TW": "此工作區尚未支援審閱與匯出。",
  },

  "editor.remove": { en: "Delete", "zh-TW": "刪除" },
  "editor.type_heading": { en: "Heading", "zh-TW": "標題" },
  "editor.type_paragraph": { en: "Paragraph", "zh-TW": "段落" },
  "editor.type_callout": { en: "Callout", "zh-TW": "提示框" },
  "editor.callout_label": { en: "Callout label (optional)", "zh-TW": "提示框標籤（選填）" },
  "editor.slide_title": { en: "Slide title", "zh-TW": "投影片標題" },
  "editor.slide_body": { en: "Slide body", "zh-TW": "投影片內文" },
  "editor.slide_notes": { en: "Speaker notes (optional)", "zh-TW": "講者備註（選填）" },
  "editor.add_slide": { en: "Add slide", "zh-TW": "新增投影片" },
  "editor.add_row": { en: "Insert row", "zh-TW": "插入列" },
  "editor.remove_row": { en: "Delete row", "zh-TW": "刪除列" },
  "editor.add_column": { en: "Add column", "zh-TW": "新增欄" },
  "editor.remove_column": { en: "Remove last column", "zh-TW": "移除最後一欄" },

  "cfos.undo": { en: "Undo", "zh-TW": "復原" },
  "cfos.redo": { en: "Redo", "zh-TW": "重做" },
  "cfos.copied": { en: "Copied", "zh-TW": "已複製" },
  "cfos.doc_block_style": { en: "Block style", "zh-TW": "區塊樣式" },
  "cfos.doc_callout_placeholder": { en: "Note or Risk", "zh-TW": "備註或風險" },
  "cfos.doc_bold": { en: "Bold", "zh-TW": "粗體" },
  "cfos.doc_italic": { en: "Italic", "zh-TW": "斜體" },
  "cfos.doc_underline": { en: "Underline", "zh-TW": "底線" },
  "cfos.doc_strike": { en: "Strikethrough", "zh-TW": "刪除線" },
  "cfos.doc_code": { en: "Inline code", "zh-TW": "行內程式碼" },
  "cfos.doc_bullets": { en: "Bullet list", "zh-TW": "項目符號清單" },
  "cfos.doc_numbered": { en: "Numbered list", "zh-TW": "編號清單" },
  "cfos.doc_link": { en: "Insert link", "zh-TW": "插入連結" },
  "cfos.doc_link_prompt": { en: "Link URL", "zh-TW": "連結網址" },
  "cfos.doc_clear_format": { en: "Clear formatting", "zh-TW": "清除格式" },
  "cfos.doc_copy_md": { en: "Copy Markdown", "zh-TW": "複製 Markdown" },
  "cfos.doc_empty_placeholder": { en: "Start writing…", "zh-TW": "開始撰寫…" },

  "cfos.sheet_autosum": { en: "AutoSum (=SUM)", "zh-TW": "自動加總 (=SUM)" },
  "cfos.sheet_sort_asc": { en: "Sort A→Z", "zh-TW": "遞增排序" },
  "cfos.sheet_sort_desc": { en: "Sort Z→A", "zh-TW": "遞減排序" },
  "cfos.sheet_copy_csv": { en: "Copy CSV", "zh-TW": "複製 CSV" },
  "cfos.sheet_rename_col": { en: "Column name", "zh-TW": "欄位名稱" },
  "cfos.sheet_col_default": { en: "Column", "zh-TW": "欄位" },
  "cfos.sheet_name_box": { en: "Cell reference", "zh-TW": "儲存格參照" },
  "cfos.sheet_formula_hint": { en: "Value or =FORMULA(A1:B2)", "zh-TW": "輸入數值或 =FORMULA(A1:B2)" },

  "cfos.slides_search": { en: "Search slides", "zh-TW": "搜尋投影片" },
  "cfos.slides_choose_layout": { en: "Choose slide layout", "zh-TW": "選擇投影片版面" },
  "cfos.slides_tpl_cover": { en: "Cover slide", "zh-TW": "封面投影片" },
  "cfos.slides_tpl_cover_desc": { en: "Branded title cover", "zh-TW": "品牌封面樣式" },
  "cfos.slides_tpl_content": { en: "Narrative", "zh-TW": "敘述投影片" },
  "cfos.slides_tpl_content_desc": { en: "Standard content slide", "zh-TW": "標準內容版面" },
  "cfos.slides_tpl_bullets": { en: "Bullet points", "zh-TW": "重點清單" },
  "cfos.slides_tpl_bullets_desc": { en: "Structured key takeaways", "zh-TW": "條列重點版面" },
  "cfos.slides_prev": { en: "Previous slide", "zh-TW": "上一張投影片" },
  "cfos.slides_next": { en: "Next slide", "zh-TW": "下一張投影片" },
  "cfos.slides_jump": { en: "Jump to slide", "zh-TW": "跳至投影片" },
  "cfos.slides_present": { en: "Present (F)", "zh-TW": "簡報模式 (F)" },
  "cfos.slides_exit_present": { en: "Exit presentation (Esc)", "zh-TW": "結束簡報 (Esc)" },
  "cfos.slides_duplicate": { en: "Duplicate slide", "zh-TW": "複製投影片" },
  "cfos.slides_inspector": { en: "Slide inspector", "zh-TW": "投影片屬性" },
  "cfos.slides_format_bullets": { en: "Format body as bullets", "zh-TW": "將內文轉為項目清單" },
  "cfos.slides_eyebrow": { en: "SLIDE", "zh-TW": "投影片" },

  "starter.doc_title": { en: "Untitled doc", "zh-TW": "未命名文件" },
  "starter.doc_heading": { en: "Overview", "zh-TW": "概覽" },
  "starter.doc_body": {
    en: "Write your notes, decisions, and action items here.",
    "zh-TW": "在此撰寫筆記、決策與待辦事項。",
  },
  "starter.sheet_title": { en: "Untitled sheet", "zh-TW": "未命名試算表" },
  "starter.sheet_col_a": { en: "Item", "zh-TW": "項目" },
  "starter.sheet_col_b": { en: "Amount", "zh-TW": "金額" },
  "starter.sheet_col_c": { en: "With tax", "zh-TW": "含稅" },
  "starter.deck_title": { en: "Untitled deck", "zh-TW": "未命名簡報" },
  "starter.deck_cover_title": { en: "Presentation title", "zh-TW": "簡報標題" },
  "starter.deck_cover_body": { en: "Prepared in Cadence Works", "zh-TW": "於 Cadence Works 建立" },
  "starter.deck_points_title": { en: "Key points", "zh-TW": "重點摘要" },
  "starter.deck_points_body": {
    en: "- First point\n- Second point\n- Next steps",
    "zh-TW": "- 重點一\n- 重點二\n- 下一步",
  },
} as const;

export type MessageKey = keyof typeof messages;

// Shared controls (`@cadence/screen-ui`) translate their own English copy
// through the provider. These are every string the pinned SDK passes it.
export const uiZhTW: Readonly<Record<string, string>> = {
  Cancel: "取消",
  Close: "關閉",
  "More actions": "更多操作",
  "No matches": "沒有符合的項目",
  Reload: "重新載入",
  Save: "儲存",
  "Saving…": "儲存中…",
  Search: "搜尋",
  "Search options": "搜尋選項",
  Select: "選擇",
  Type: "輸入",
};
