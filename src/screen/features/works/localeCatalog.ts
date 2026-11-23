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
  "detail.revision": { en: "Revision {n}", "zh-TW": "第 {n} 版" },
  "detail.review_none": { en: "Not reviewed yet.", "zh-TW": "尚未審閱。" },
  "detail.review_pending": {
    en: "Review pending for revision {n}.",
    "zh-TW": "第 {n} 版正等待審閱。",
  },
  "detail.review_changes": {
    en: "Changes requested. Edit, then request review again.",
    "zh-TW": "審閱者要求修改。請編輯後再次要求審閱。",
  },
  "detail.review_approved": {
    en: "Reviewed: revision {n} is approved and current.",
    "zh-TW": "已審閱：第 {n} 版已核准，並且是最新版本。",
  },
  "detail.review_stale": {
    en: "Stale approval: revision {a} was approved; the current revision is {c}.",
    "zh-TW": "核准已過期：第 {a} 版曾獲核准，但目前版本為第 {c} 版。",
  },
  "detail.export_ready": { en: "Ready to export.", "zh-TW": "可以匯出。" },
  "detail.export_blocked": {
    en: "Export is blocked until the current revision is approved.",
    "zh-TW": "目前版本獲核准前無法匯出。",
  },

  "field.title": { en: "Title", "zh-TW": "標題" },
  "field.kind": { en: "Kind", "zh-TW": "類型" },
  "new.title": { en: "New item", "zh-TW": "新增項目" },
  "hint.save_first": { en: "Save your edits first.", "zh-TW": "請先儲存編輯。" },

  "notice.saved": { en: "Saved as revision {n}.", "zh-TW": "已儲存為第 {n} 版。" },
  "notice.nothing_to_save": { en: "Nothing to save.", "zh-TW": "沒有需要儲存的變更。" },
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

  "editor.up": { en: "Up", "zh-TW": "上移" },
  "editor.down": { en: "Down", "zh-TW": "下移" },
  "editor.remove": { en: "Remove", "zh-TW": "移除" },
  "editor.block_n": { en: "Block {n}", "zh-TW": "區塊 {n}" },
  "editor.block_type": { en: "Block {n} type", "zh-TW": "區塊 {n} 類型" },
  "editor.block_text": { en: "Block {n} text", "zh-TW": "區塊 {n} 文字" },
  "editor.type_heading": { en: "Heading", "zh-TW": "標題" },
  "editor.type_paragraph": { en: "Paragraph", "zh-TW": "段落" },
  "editor.type_callout": { en: "Callout", "zh-TW": "提示框" },
  "editor.callout_label": { en: "Callout label (optional)", "zh-TW": "提示框標籤（選填）" },
  "editor.add_block": { en: "Add block", "zh-TW": "新增區塊" },
  "editor.slide_title": { en: "Slide title", "zh-TW": "投影片標題" },
  "editor.slide_body": { en: "Slide body", "zh-TW": "投影片內文" },
  "editor.slide_notes": { en: "Speaker notes (optional)", "zh-TW": "講者備註（選填）" },
  "editor.add_slide": { en: "Add slide", "zh-TW": "新增投影片" },
  "editor.sheet_label": { en: "Sheet editor", "zh-TW": "試算表編輯器" },
  "editor.column_n": { en: "Column {n} name", "zh-TW": "第 {n} 欄名稱" },
  "editor.cell": { en: "Row {r}, column {c}", "zh-TW": "第 {r} 列，第 {c} 欄" },
  "editor.row_actions": { en: "Row actions", "zh-TW": "列操作" },
  "editor.add_row": { en: "Add row", "zh-TW": "新增列" },
  "editor.remove_row": { en: "Remove row", "zh-TW": "移除列" },
  "editor.add_column": { en: "Add column", "zh-TW": "新增欄" },
  "editor.remove_column": { en: "Remove last column", "zh-TW": "移除最後一欄" },

  "view.doc_empty": { en: "This doc has no content yet.", "zh-TW": "此文件尚無內容。" },
  "view.deck_empty": { en: "This deck has no slides yet.", "zh-TW": "此簡報尚無投影片。" },
  "view.sheet_empty": { en: "This sheet has no rows yet.", "zh-TW": "此試算表尚無資料列。" },
  "view.sheet_label": { en: "Sheet table", "zh-TW": "試算表內容" },
  "view.slide_no": { en: "Slide {n}", "zh-TW": "投影片 {n}" },
  "view.notes": { en: "Notes:", "zh-TW": "備註：" },
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
