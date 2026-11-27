import { ApiError, Button, ConfirmDialog, ErrorNotice, Loading, Notice } from "@cadence/screen-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { setUnsaved } from "../../bridge/leave";
import type { DisplayScope } from "../../bridge/scope";
import { exportDocPdfHtml, worksDocToCfos } from "../../cfos/docs/codec";
import { buildDocxBytes } from "../../cfos/docs/docx";
import { worksSheetToCfos } from "../../cfos/sheets/codec";
import { exportSheetHtml } from "../../cfos/sheets/formula";
import { buildXlsxBytes } from "../../cfos/sheets/xlsx";
import { exportDeckPdfHtml, worksDeckToCfos } from "../../cfos/slides/codec";
import { buildPptxBytes } from "../../cfos/slides/pptx";
import { SaveScheduler, type SaveStatus } from "../../cfos/sync/saveScheduler";
import { triggerSubmitDocument } from "../../cfos/ui/download";
import {
  patchOperations,
  validateDraft,
  validId,
  type Content,
  type HistoricalWorksItem,
  type RevisionSummary,
  type WorksItem,
} from "../../domain/works";
import {
  classify,
  exportSlot,
  getItem,
  getItemRevision,
  getItemWithRevisions,
  patchItem,
  requestReview,
  reviewSlot,
  trashItem,
  type Failure,
} from "./api";
import { ContentEditor } from "./editors";
import { useLocale } from "./locale";
import { PROBLEM_KEY } from "./problems";
import { ContentView } from "./renderers";
import { KindChip, ReviewChip } from "./StatusChip";

type NoticeState = { tone: "ok" | "error"; text: string } | null;
type Busy = "load" | "save" | "request" | "review" | "export" | "trash" | "restore_rev" | "submit_doc" | null;

export interface DetailProps {
  scope: DisplayScope;
  id: string;
  canvas: boolean;
  canEdit: boolean;
  canRequestReview: boolean;
  canReview: boolean;
  canExport: boolean;
  canTrash: boolean;
  showBack: boolean;
  importWarnings?: readonly string[];
  onDismissImportWarnings?: () => void;
  onBack: () => void;
  onTrashed: (trashed: { id: string; title: string; revision: number }) => void;
}

export function DetailView(props: DetailProps) {
  const { scope, id, canvas } = props;
  const { t } = useLocale();
  const [item, setItem] = useState<WorksItem | null>(null);
  const [loadFailure, setLoadFailure] = useState<Failure | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Content | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<Busy>("load");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [reviewUnsupported, setReviewUnsupported] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [viewingRev, setViewingRev] = useState<HistoricalWorksItem | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitLabel, setSubmitLabel] = useState("report");
  const [submitFormat, setSubmitFormat] = useState<"pdf" | "office">("pdf");

  const version = useRef(0);
  const owner = useRef(Symbol("works-detail"));
  const itemRef = useRef<WorksItem | null>(null);
  const titleRef = useRef("");
  const contentRef = useRef<Content | null>(null);
  const schedulerRef = useRef<SaveScheduler | null>(null);

  itemRef.current = item;
  titleRef.current = title;
  contentRef.current = content;

  const adopt = useCallback((next: WorksItem, resetEditor: boolean) => {
    itemRef.current = next;
    titleRef.current = next.title;
    contentRef.current = next.content;
    setItem(next);
    setTitle(next.title);
    setContent(next.content);
    version.current += 1;
    if (resetEditor) setResetKey((k) => k + 1);
  }, []);

  const load = useCallback(async () => {
    schedulerRef.current?.cancel();
    setBusy("load");
    setLoadFailure(null);
    try {
      if (!validId(id)) throw new ApiError("Not found", 404, { code: "not_found" });
      const next = await getItem(scope, id);
      adopt(next, true);
      setStale(false);
      setSaveStatus("saved");
      setNotice(null);
    } catch (error) {
      setLoadFailure(classify(error));
    } finally {
      setBusy(null);
    }
  }, [scope, id, adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    !canvas && item !== null && content !== null && patchOperations(item, title, content).length > 0;

  useEffect(() => {
    const token = owner.current;
    setUnsaved(token, dirty);
    return () => setUnsaved(token, false);
  }, [dirty]);

  const message = useCallback(
    (failure: Failure): string =>
      failure.kind === "message"
        ? t(failure.key)
        : failure.kind === "unavailable"
          ? t("error.forbidden")
          : t("error.generic"),
    [t],
  );

  const editing = !canvas && props.canEdit && mode === "edit" && viewingRev === null;

  useEffect(() => {
    const scheduler = new SaveScheduler({
      readOnly: !editing || stale,
      isDirty: () => {
        const curItem = itemRef.current;
        const curContent = contentRef.current;
        if (!curItem || !curContent) return false;
        return patchOperations(curItem, titleRef.current, curContent).length > 0;
      },
      onStatus: (status) => {
        setSaveStatus(status);
      },
      save: async () => {
        const curItem = itemRef.current;
        const curContent = contentRef.current;
        const curTitle = titleRef.current;
        if (!curItem || !curContent) return "saved";
        const operations = patchOperations(curItem, curTitle, curContent);
        if (!operations.length) return "saved";
        const problem = validateDraft(curTitle, curContent);
        if (problem) {
          setNotice({ tone: "error", text: t(PROBLEM_KEY[problem]) });
          return "pending";
        }
        const sent = version.current;
        try {
          const next = await patchItem(scope, curItem, operations);
          if (sent === version.current) adopt(next, false);
          else {
            itemRef.current = next;
            setItem(next);
          }
          setNotice(null);
          return "saved";
        } catch (error) {
          const failure = classify(error);
          if (failure.kind === "stale") {
            setStale(true);
            setNotice(null);
            return "conflict";
          }
          if (failure.kind !== "cancelled") {
            setNotice({ tone: "error", text: message(failure) });
          }
          throw error;
        }
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [editing, stale, scope, adopt, message, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (editing && !stale) void schedulerRef.current?.flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, stale]);

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      const failure = classify(error);
      if (failure.kind === "stale") {
        setStale(true);
        setNotice(null);
      } else if (failure.kind !== "cancelled") {
        if (failure.kind === "message" && failure.key === "error.review_unavailable") {
          setReviewUnsupported(true);
        }
        setNotice({ tone: "error", text: message(failure) });
      }
    } finally {
      setBusy(null);
    }
  };

  if (busy === "load" && !item) return <Loading>{t("detail.loading")}</Loading>;
  if (loadFailure && !item) {
    if (loadFailure.kind === "unavailable") {
      return <Notice>{canvas ? t("load.canvas_unavailable") : t("load.unavailable")}</Notice>;
    }
    return (
      <ErrorNotice onRetry={() => void load()} retryLabel={t("action.reload")}>
        {loadFailure.kind === "stale" ? t("error.generic") : message(loadFailure)}
      </ErrorNotice>
    );
  }
  if (!item || !content) return <Loading>{t("detail.loading")}</Loading>;

  const locked = busy !== null;

  const save = () =>
    run("save", async () => {
      schedulerRef.current?.cancel();
      const problem = validateDraft(title, content);
      if (problem) {
        setNotice({ tone: "error", text: t(PROBLEM_KEY[problem]) });
        return;
      }
      const operations = patchOperations(item, title, content);
      if (!operations.length) {
        setSaveStatus("saved");
        return;
      }
      const sent = version.current;
      const next = await patchItem(scope, item, operations);
      if (sent === version.current) adopt(next, false);
      else setItem(next);
      setSaveStatus("saved");
      setNotice({ tone: "ok", text: t("notice.saved", { n: next.revision }) });
    });

  // Reload replaces the draft with the host copy, so a dirty draft needs an explicit yes.
  const requestReload = () => (dirty ? setConfirmReload(true) : void load());

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const full = await getItemWithRevisions(scope, item.id);
      setRevisions(full.revisions);
    } catch (error) {
      setNotice({ tone: "error", text: message(classify(error)) });
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setSubmitOpen(false);
    setHistoryOpen(true);
    void loadHistory();
  };

  const viewHistoricalRevision = async (rev: number) => {
    if (rev === item.revision) {
      setViewingRev(null);
      return;
    }
    try {
      const snap = await getItemRevision(scope, item.id, rev);
      setViewingRev(snap);
    } catch (error) {
      setNotice({ tone: "error", text: message(classify(error)) });
    }
  };

  const restoreHistoricalRevision = async (snap: HistoricalWorksItem) => {
    await run("restore_rev", async () => {
      schedulerRef.current?.cancel();
      const ops = patchOperations(item, snap.title, snap.content);
      if (!ops.length) {
        setViewingRev(null);
        return;
      }
      const next = await patchItem(scope, item, ops);
      adopt(next, true);
      setViewingRev(null);
      setSaveStatus("saved");
      setNotice({ tone: "ok", text: t("history.restored_notice", { from: snap.revision, n: next.revision }) });
      void loadHistory();
    });
  };

  const officeExtForKind = item.kind === "doc" ? "docx" : item.kind === "sheet" ? "xlsx" : "pptx";

  const submitDeliverable = async (submitForReview: boolean) => {
    const trimmedLabel = submitLabel.trim();
    if (!trimmedLabel || trimmedLabel.length > 40 || /[/\\]/.test(trimmedLabel) || /^\.+$/.test(trimmedLabel)) {
      setNotice({ tone: "error", text: t("submit_doc.invalid_label") });
      return;
    }
    const cleanTitle = title.trim() || item.title;
    await run("submit_doc", async () => {
      let receipt: { ok: true; id: string; stage: string } | { ok: false; error: string };
      if (submitFormat === "pdf") {
        let html = "";
        if (content.kind === "doc") {
          html = exportDocPdfHtml(cleanTitle, worksDocToCfos(content.blocks));
        } else if (content.kind === "sheet") {
          const wb = worksSheetToCfos(
            { columns: [...content.columns], rows: content.rows.map((r) => [...r]) },
            cleanTitle,
          );
          html = exportSheetHtml(wb, wb.sheetOrder[0] || "s_1");
        } else {
          html = exportDeckPdfHtml(cleanTitle, worksDeckToCfos(content.slides).deck);
        }
        receipt = await triggerSubmitDocument({
          title: cleanTitle,
          label: trimmedLabel,
          kind: "pdf",
          html,
          ...(content.kind === "doc" ? { paper: "a4" as const } : {}),
          submit: submitForReview,
        });
      } else {
        let bytes: Uint8Array;
        let outKind: "docx" | "xlsx" | "pptx";
        if (content.kind === "doc") {
          outKind = "docx";
          bytes = await buildDocxBytes(cleanTitle, worksDocToCfos(content.blocks));
        } else if (content.kind === "sheet") {
          outKind = "xlsx";
          const wb = worksSheetToCfos(
            { columns: [...content.columns], rows: content.rows.map((r) => [...r]) },
            cleanTitle,
          );
          bytes = await buildXlsxBytes(wb);
        } else {
          outKind = "pptx";
          const hydratedDeck = worksDeckToCfos(content.slides);
          bytes = await buildPptxBytes(hydratedDeck.deck, hydratedDeck.speakerNotes);
        }
        receipt = await triggerSubmitDocument({
          title: cleanTitle,
          label: trimmedLabel,
          kind: outKind,
          bytes,
          submit: submitForReview,
        });
      }
      if (!receipt.ok) {
        setNotice({ tone: "error", text: receipt.error });
        return;
      }
      setSubmitOpen(false);
      setNotice({
        tone: "ok",
        text: t(submitForReview ? "submit_doc.done_review" : "submit_doc.done_draft", { id: receipt.id }),
      });
    });
  };

  const statusText =
    saveStatus === "saving"
      ? t("status.saving")
      : saveStatus === "conflict" || stale
        ? t("status.conflict")
        : saveStatus === "offline"
          ? t("status.offline")
          : dirty
            ? t("status.unsaved")
            : t("status.saved");
  const statusDot =
    saveStatus === "saving"
      ? "saving"
      : saveStatus === "conflict" || stale
        ? "conflict"
        : saveStatus === "offline"
          ? "offline"
          : dirty
            ? "saving"
            : "saved";

  const showReviewControls = !canvas && !reviewUnsupported;

  return (
    <section className="works-detail works-detail-workbench">
      <header className="works-detail-topbar">
        <div className="works-titlebar">
          {props.showBack ? (
            <Button size="sm" variant="ghost" onClick={props.onBack}>
              {t("action.back")}
            </Button>
          ) : null}
          {editing ? (
            <input
              className="cfos-title-input"
              aria-label={t("field.title")}
              value={title}
              disabled={stale}
              onChange={(e) => {
                const val = e.target.value;
                titleRef.current = val;
                setTitle(val);
                version.current += 1;
                schedulerRef.current?.schedule();
              }}
            />
          ) : (
            <h2 className="text-section works-title" data-outlet-heading>
              {item.title}
            </h2>
          )}
          <div className="works-chips">
            <KindChip kind={item.kind} />
            <span className="works-rev">{t("detail.revision", { n: item.revision })}</span>
            {item.reviewStatus !== "none" || item.reviewedRevision > 0 ? (
              <ReviewChip status={item.reviewStatus} state={item.reviewState} />
            ) : null}
            {editing ? (
              <span className="cfos-status">
                <span className={`cfos-dot ${statusDot}`} />
                <span>{statusText}</span>
              </span>
            ) : null}
          </div>
        </div>

        {!canvas && props.canEdit ? (
          <div className="works-chips">
            <div className="works-chips" role="group" aria-label={t("detail.mode")}>
              <Button size="sm" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
                {t("action.edit")}
              </Button>
              <Button size="sm" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
                {t("action.preview")}
              </Button>
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={busy === "save"}
              disabled={locked || stale || !dirty}
              onClick={() => void save()}
            >
              {t("action.save")}
            </Button>
            <Button size="sm" disabled={locked} onClick={requestReload}>
              {t("action.reload")}
            </Button>
            <Button size="sm" aria-pressed={historyOpen} disabled={locked} onClick={toggleHistory}>
              {t("history.button")}
            </Button>
            <Button
              size="sm"
              aria-pressed={submitOpen}
              disabled={locked || dirty}
              title={dirty ? t("hint.save_first") : undefined}
              onClick={() => {
                setHistoryOpen(false);
                setSubmitOpen((was) => !was);
              }}
            >
              {t("submit_doc.button")}
            </Button>
            {showReviewControls && props.canRequestReview && item.reviewStatus === "none" ? (
              <Button
                size="sm"
                loading={busy === "request"}
                disabled={locked || dirty || stale}
                title={dirty ? t("hint.save_first") : undefined}
                onClick={() =>
                  void run("request", async () => {
                    const next = await requestReview(scope, item);
                    setItem(next);
                    setNotice({ tone: "ok", text: t("notice.review_requested", { n: next.revision }) });
                  })
                }
              >
                {t("action.request_review")}
              </Button>
            ) : null}
            {showReviewControls && props.canReview && item.reviewStatus === "pending" ? (
              <Button
                size="sm"
                loading={busy === "review"}
                disabled={locked || dirty || stale}
                onClick={() =>
                  void run("review", async () => {
                    await reviewSlot(scope, item);
                    const next = await getItem(scope, item.id);
                    adopt(next, true);
                    setNotice({ tone: "ok", text: t("notice.review_recorded") });
                  })
                }
              >
                {t("action.review")}
              </Button>
            ) : null}
            {showReviewControls && props.canExport && item.exportState === "ready" ? (
              <Button
                size="sm"
                loading={busy === "export"}
                disabled={locked || dirty}
                onClick={() =>
                  void run("export", async () => {
                    const receipt = await exportSlot(scope, item);
                    setNotice({
                      tone: "ok",
                      text: t("notice.exported", {
                        n: receipt.revision,
                        format: receipt.format,
                        digest: receipt.digest,
                      }),
                    });
                  })
                }
              >
                {t("action.export")}
              </Button>
            ) : null}
            {props.canTrash ? (
              <Button size="sm" variant="danger" disabled={locked} onClick={() => setConfirmTrash(true)}>
                {t("action.trash")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      {stale ? (
        <Notice state="stale">
          <strong>{t("stale.title")}</strong> {t("stale.body")}{" "}
          <Button size="sm" variant="primary" disabled={locked} onClick={requestReload}>
            {t("action.reload")}
          </Button>
        </Notice>
      ) : null}
      {props.importWarnings && props.importWarnings.length > 0 ? (
        <Notice state="warn">
          {props.importWarnings.join(" ")}{" "}
          {props.onDismissImportWarnings ? (
            <Button size="sm" variant="ghost" onClick={props.onDismissImportWarnings}>
              {t("action.dismiss")}
            </Button>
          ) : null}
        </Notice>
      ) : null}
      {notice ? (
        notice.tone === "error" ? (
          <ErrorNotice>{notice.text}</ErrorNotice>
        ) : (
          <Notice>{notice.text}</Notice>
        )
      ) : null}

      {historyOpen && !canvas ? (
        <div className="works-panel-card" data-works-history>
          <div className="works-panel-head">
            <strong>{t("history.title")}</strong>
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(false)}>
              {t("action.dismiss")}
            </Button>
          </div>
          {historyLoading ? (
            <p className="text-micro">{t("history.loading")}</p>
          ) : (
            <div className="works-history-list">
              {(revisions ?? []).map((rev) => (
                <div key={rev.revision} className="works-history-row">
                  <span>
                    <strong>r{rev.revision}</strong> · {rev.title}
                    {rev.revision === item.revision ? ` (${t("history.current")})` : ""}
                    {" · "}
                    <span className="num">{rev.updatedAt.slice(0, 16).replace("T", " ")}</span>
                  </span>
                  <div className="works-chips">
                    <Button
                      size="sm"
                      variant={viewingRev?.revision === rev.revision ? "primary" : "ghost"}
                      onClick={() => void viewHistoricalRevision(rev.revision)}
                    >
                      {rev.revision === item.revision ? t("history.back_current") : t("action.preview")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {submitOpen && !canvas && props.canEdit ? (
        <div className="works-panel-card" data-works-submit-doc>
          <div className="works-panel-head">
            <strong>{t("submit_doc.heading")}</strong>
            <Button size="sm" variant="ghost" onClick={() => setSubmitOpen(false)}>
              {t("action.cancel")}
            </Button>
          </div>
          <div className="works-submit-grid">
            <label style={{ display: "grid", gap: "4px" }}>
              <span>{t("submit_doc.label")}</span>
              <input
                className="field"
                value={submitLabel}
                maxLength={40}
                onChange={(e) => setSubmitLabel(e.target.value)}
              />
            </label>
            <div style={{ display: "grid", gap: "4px" }}>
              <span>{t("submit_doc.format")}</span>
              <div style={{ display: "flex", gap: "6px" }} role="group" aria-label={t("submit_doc.format")}>
                <Button
                  size="sm"
                  variant={submitFormat === "pdf" ? "primary" : undefined}
                  aria-pressed={submitFormat === "pdf"}
                  onClick={() => setSubmitFormat("pdf")}
                >
                  PDF (.pdf)
                </Button>
                <Button
                  size="sm"
                  variant={submitFormat === "office" ? "primary" : undefined}
                  aria-pressed={submitFormat === "office"}
                  onClick={() => setSubmitFormat("office")}
                >
                  {`Office (.${officeExtForKind})`}
                </Button>
              </div>
            </div>
            <Button
              size="sm"
              loading={busy === "submit_doc"}
              disabled={locked}
              onClick={() => void submitDeliverable(false)}
            >
              {busy === "submit_doc" ? t("submit_doc.busy") : t("submit_doc.save_draft")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === "submit_doc"}
              disabled={locked}
              onClick={() => void submitDeliverable(true)}
            >
              {busy === "submit_doc" ? t("submit_doc.busy") : t("submit_doc.submit_review")}
            </Button>
          </div>
        </div>
      ) : null}

      {viewingRev ? (
        <Notice>
          {t("history.viewing", { n: viewingRev.revision })}{" "}
          <Button size="sm" onClick={() => setViewingRev(null)}>
            {t("history.back_current")}
          </Button>{" "}
          {props.canEdit ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy === "restore_rev"}
              disabled={locked}
              onClick={() => void restoreHistoricalRevision(viewingRev)}
            >
              {t("history.restore_rev", { n: viewingRev.revision })}
            </Button>
          ) : null}
        </Notice>
      ) : null}

      {viewingRev ? (
        <div className="works-workbench-frame">
          <ContentView title={viewingRev.title} content={viewingRev.content} resetKey={viewingRev.revision} />
        </div>
      ) : editing ? (
        <div className="works-workbench-frame">
          <fieldset className="works-fieldset" disabled={stale}>
            <ContentEditor
              title={title}
              content={content}
              resetKey={resetKey}
              onChange={(next) => {
                contentRef.current = next;
                setContent(next);
                version.current += 1;
                schedulerRef.current?.schedule();
              }}
            />
          </fieldset>
        </div>
      ) : (
        <div className="works-workbench-frame">
          <ContentView title={item.title} content={content} resetKey={resetKey} />
        </div>
      )}

      {confirmReload ? (
        <ConfirmDialog
          title={t("reload.title")}
          body={t("reload.body")}
          confirmLabel={t("action.discard_reload")}
          pending={false}
          error={null}
          onCancel={() => setConfirmReload(false)}
          onConfirm={() => {
            setConfirmReload(false);
            void load();
          }}
        />
      ) : null}

      {confirmTrash ? (
        <ConfirmDialog
          title={t("trash.title")}
          body={t("trash.body", { title: item.title })}
          confirmLabel={t("action.trash")}
          pending={busy === "trash"}
          error={trashError}
          onCancel={() => {
            setConfirmTrash(false);
            setTrashError(null);
          }}
          onConfirm={() => {
            setTrashError(null);
            setBusy("trash");
            trashItem(scope, item).then(
              (revision) => {
                setBusy(null);
                setConfirmTrash(false);
                props.onTrashed({ id: item.id, title: item.title, revision });
              },
              (error: unknown) => {
                setBusy(null);
                const failure = classify(error);
                if (failure.kind === "stale") {
                  setConfirmTrash(false);
                  setStale(true);
                } else {
                  setTrashError(message(failure));
                }
              },
            );
          }}
        />
      ) : null}
    </section>
  );
}
