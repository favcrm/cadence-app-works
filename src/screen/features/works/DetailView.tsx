import { ApiError, Button, ConfirmDialog, ErrorNotice, Loading, Notice } from "@cadence/screen-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { setUnsaved } from "../../bridge/leave";
import type { DisplayScope } from "../../bridge/scope";
import { SaveScheduler, type SaveStatus } from "../../cfos/sync/saveScheduler";
import {
  patchOperations,
  validateDraft,
  validId,
  type Content,
  type WorksItem,
} from "../../domain/works";
import {
  classify,
  exportSlot,
  getItem,
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
type Busy = "load" | "save" | "request" | "review" | "export" | "trash" | null;

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

  const editing = !canvas && props.canEdit && mode === "edit";

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

      {editing ? (
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
