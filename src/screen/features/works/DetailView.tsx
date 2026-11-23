import { ApiError, Button, ConfirmDialog, ErrorNotice, Field, Loading, Notice } from "@cadence/screen-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { setUnsaved } from "../../bridge/leave";
import type { DisplayScope } from "../../bridge/scope";
import {
  numericColumns,
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
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState<Busy>("load");
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const version = useRef(0);
  const owner = useRef(Symbol("works-detail"));
  const numeric = useRef<boolean[]>([]);

  const adopt = useCallback((next: WorksItem) => {
    setItem(next);
    setTitle(next.title);
    setContent(next.content);
    numeric.current = numericColumns(next.content);
    version.current += 1;
  }, []);

  const load = useCallback(async () => {
    setBusy("load");
    setLoadFailure(null);
    try {
      if (!validId(id)) throw new ApiError("Not found", 404, { code: "not_found" });
      const next = await getItem(scope, id);
      adopt(next);
      setStale(false);
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

  const message = (failure: Failure): string =>
    failure.kind === "message"
      ? t(failure.key)
      : failure.kind === "unavailable"
        ? t("error.forbidden")
        : t("error.generic");

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      const failure = classify(error);
      if (failure.kind === "stale") {
        // A stale revision never overwrites: the screen stops saving and offers a reload.
        setStale(true);
        setNotice(null);
      } else if (failure.kind !== "cancelled") {
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

  const editing = !canvas && props.canEdit && mode === "edit";
  const locked = busy !== null;

  const save = () =>
    run("save", async () => {
      const problem = validateDraft(title, content);
      if (problem) {
        setNotice({ tone: "error", text: t(PROBLEM_KEY[problem]) });
        return;
      }
      const operations = patchOperations(item, title, content);
      if (!operations.length) {
        setNotice({ tone: "ok", text: t("notice.nothing_to_save") });
        return;
      }
      const sent = version.current;
      const next = await patchItem(scope, item, operations);
      if (sent === version.current) adopt(next);
      else setItem(next);
      setNotice({ tone: "ok", text: t("notice.saved", { n: next.revision }) });
    });

  // Reload replaces the draft with the host copy, so a dirty draft needs an explicit yes.
  const requestReload = () => (dirty ? setConfirmReload(true) : void load());

  const review = item.reviewStatus === "pending" ? (
    t("detail.review_pending", { n: item.revision })
  ) : item.reviewStatus === "changes_requested" ? (
    t("detail.review_changes")
  ) : item.reviewState === "reviewed" && item.exportState === "ready" ? (
    t("detail.review_approved", { n: item.revision })
  ) : item.reviewState === "edited" && item.reviewedRevision > 0 ? (
    t("detail.review_stale", { a: item.reviewedRevision, c: item.revision })
  ) : (
    t("detail.review_none")
  );

  return (
    <section className="works-detail">
      <header className="works-detail-head">
        <div className="works-titlebar">
          {props.showBack ? (
            <Button size="sm" variant="ghost" onClick={props.onBack}>
              {t("action.back")}
            </Button>
          ) : null}
          <h2 className="text-section works-title" data-outlet-heading>
            {item.title}
          </h2>
        </div>
        <div className="works-chips">
          <KindChip kind={item.kind} />
          <span className="works-rev">{t("detail.revision", { n: item.revision })}</span>
          <ReviewChip status={item.reviewStatus} state={item.reviewState} />
        </div>
        <p className="works-muted">{review}</p>
        {!canvas ? (
          <p className="works-muted">
            {item.exportState === "ready" ? t("detail.export_ready") : t("detail.export_blocked")}
          </p>
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
      {notice ? (
        notice.tone === "error" ? (
          <ErrorNotice>{notice.text}</ErrorNotice>
        ) : (
          <Notice>{notice.text}</Notice>
        )
      ) : null}

      {!canvas && props.canEdit ? (
        <div className="works-toolbar">
          <div className="works-chips" role="group" aria-label={t("detail.mode")}>
            <Button size="sm" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
              {t("action.edit")}
            </Button>
            <Button size="sm" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>
              {t("action.preview")}
            </Button>
          </div>
          <div className="works-chips">
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
            {props.canRequestReview ? (
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
            {props.canReview ? (
              <Button
                size="sm"
                loading={busy === "review"}
                disabled={locked || dirty || stale || item.reviewStatus !== "pending"}
                onClick={() =>
                  void run("review", async () => {
                    await reviewSlot(scope, item);
                    const next = await getItem(scope, item.id);
                    adopt(next);
                    setNotice({ tone: "ok", text: t("notice.review_recorded") });
                  })
                }
              >
                {t("action.review")}
              </Button>
            ) : null}
            {props.canExport ? (
              <Button
                size="sm"
                loading={busy === "export"}
                disabled={locked || dirty || item.exportState !== "ready"}
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
        </div>
      ) : null}

      {editing ? (
        <form
          className="works-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="works-fieldset" disabled={stale}>
          <Field label={t("field.title")}>
            {(control) => (
              <input
                {...control}
                className="field"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  version.current += 1;
                }}
              />
            )}
          </Field>
          <ContentEditor
            content={content}
            numeric={numeric.current}
            onChange={(next) => { setContent(next); version.current += 1; }}
          />
          </fieldset>
        </form>
      ) : (
        <ContentView content={content} />
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
          onCancel={() => { setConfirmTrash(false); setTrashError(null); }}
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
