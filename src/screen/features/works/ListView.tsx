import { Button, DataTable, EmptyState, ErrorNotice, Loading, Notice, Select } from "@cadence/screen-ui";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import type { Kind } from "../../bridge/operations";
import type { DisplayScope } from "../../bridge/scope";
import type { WorksRow } from "../../domain/works";
import { classify, queryRows, restoreItem, type Failure } from "./api";
import { useLocale } from "./locale";
import { KindChip, ReviewChip } from "./StatusChip";

export interface ListProps {
  scope: DisplayScope;
  kind: Kind | undefined;
  canvas: boolean;
  canCreate: boolean;
  canRestore: boolean;
  creatingKind: Kind | null;
  importing: boolean;
  refreshKey: number;
  onOpen: (row: WorksRow) => void;
  onQuickCreate: (kind: Kind) => void;
  onNew: () => void;
  onImportFile: (file: File) => void;
}

export function ListView({
  scope,
  kind,
  canvas,
  canCreate,
  canRestore,
  creatingKind,
  importing,
  refreshKey,
  onOpen,
  onQuickCreate,
  onNew,
  onImportFile,
}: ListProps) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [rows, setRows] = useState<WorksRow[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const [showTrash, setShowTrash] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setRows(
        await queryRows(scope, {
          sort,
          ...(showTrash ? { trashed: true } : {}),
          ...(kind ? { kind } : {}),
          ...(text ? { text } : {}),
          ...(!showTrash && review !== "all" ? { review } : {}),
        }),
      );
    } catch (error) {
      setRows(null);
      setFailure(classify(error));
    }
  }, [scope, kind, text, review, sort, showTrash]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setText(draft.trim());
  };

  const reviewOptions = [
    { value: "all", label: t("filter.review_all") },
    { value: "draft", label: t("review.draft") },
    { value: "pending", label: t("review.pending") },
    { value: "changes_requested", label: t("review.changes") },
    { value: "reviewed", label: t("review.reviewed") },
    { value: "edited", label: t("review.edited") },
  ];
  const sortOptions = [
    { value: "updated", label: t("sort.updated") },
    { value: "name", label: t("sort.name") },
  ];

  const busy = creatingKind !== null || importing;

  const canImport = !canvas && canCreate;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportFile(file);
  };

  const handleDragEnter = (event: DragEvent) => {
    if (!canImport || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!canImport || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!canImport) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    if (!canImport) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) onImportFile(file);
  };

  return (
    <section
      className={`works-list${dragOver ? " is-drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver ? <div className="works-import-dropbanner">{t("import.drop_hint")}</div> : null}
      <div className="works-toolbar">
        <form className="works-search" role="search" onSubmit={submit}>
          <input
            className="field"
            type="search"
            aria-label={t("action.search")}
            placeholder={t("action.search")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button size="sm" type="submit">
            {t("action.search")}
          </Button>
        </form>
        <div className="works-chips">
          {!canvas && canRestore ? (
            <div className="works-chips" role="group" aria-label={t("list.table")}>
              <Button size="sm" aria-pressed={!showTrash} onClick={() => setShowTrash(false)}>
                {t("list.tab_active")}
              </Button>
              <Button size="sm" aria-pressed={showTrash} onClick={() => setShowTrash(true)}>
                {t("list.tab_trash")}
              </Button>
            </div>
          ) : null}
          {!showTrash ? (
            <Select
              size="sm"
              aria-label={t("filter.review")}
              value={review}
              options={reviewOptions}
              onChange={setReview}
            />
          ) : null}
          <Select
            size="sm"
            aria-label={t("filter.sort")}
            value={sort}
            options={sortOptions}
            onChange={(value) => setSort(value === "name" ? "name" : "updated")}
          />
          <Button size="sm" onClick={() => void load()}>
            {t("action.refresh")}
          </Button>
          {!canvas && canCreate && !showTrash ? (
            <>
              <Button
                size="sm"
                variant="primary"
                loading={creatingKind === "doc"}
                disabled={busy}
                onClick={() => onQuickCreate("doc")}
              >
                {t("action.new_doc")}
              </Button>
              <Button
                size="sm"
                loading={creatingKind === "sheet"}
                disabled={busy}
                onClick={() => onQuickCreate("sheet")}
              >
                {t("action.new_sheet")}
              </Button>
              <Button
                size="sm"
                loading={creatingKind === "deck"}
                disabled={busy}
                onClick={() => onQuickCreate("deck")}
              >
                {t("action.new_deck")}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={onNew}>
                {t("action.new")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={importing}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? t("import.busy") : t("action.import")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.xlsx,.pptx,.csv,.md,.txt"
                aria-label={t("action.import")}
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </>
          ) : null}
        </div>
      </div>

      {restoreNotice ? <Notice>{restoreNotice}</Notice> : null}
      {restoreError ? <ErrorNotice>{restoreError}</ErrorNotice> : null}
      {failure ? (
        <ErrorNotice onRetry={() => void load()} retryLabel={t("action.retry")}>
          {failure.kind === "unavailable"
            ? t(canvas ? "load.canvas_unavailable" : "load.unavailable")
            : failure.kind === "message"
              ? t(failure.key)
              : t("error.generic")}
        </ErrorNotice>
      ) : rows === null ? (
        <Loading>{t("list.loading")}</Loading>
      ) : rows.length === 0 ? (
        <EmptyState title={t(showTrash ? "list.trash_empty_title" : "list.empty_title")} name="works">
          {showTrash
            ? t(text ? "list.empty_filtered" : "list.trash_empty_body")
            : text || review !== "all"
              ? t("list.empty_filtered")
              : t("list.empty_body")}
        </EmptyState>
      ) : (
        <DataTable
          label={t("list.table")}
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "title",
              header: t("column.title"),
              cell: (row) =>
                showTrash ? (
                  <span>{row.title}</span>
                ) : (
                  <Button variant="ghost" size="sm" className="works-open" onClick={() => onOpen(row)}>
                    {row.title}
                  </Button>
                ),
            },
            { key: "kind", header: t("column.kind"), cell: (row) => <KindChip kind={row.kind} /> },
            { key: "rev", header: t("column.revision"), cell: (row) => `r${row.revision}`, cellClassName: "num" },
            {
              key: "review",
              header: t("column.review"),
              cell: (row) => <ReviewChip status={row.reviewStatus} state={row.reviewState} />,
            },
            { key: "updated", header: t("column.updated"), cell: (row) => row.updated },
            ...(showTrash
              ? [
                  {
                    key: "actions",
                    header: t("action.column_actions"),
                    cell: (row: WorksRow) => (
                      <Button
                        size="sm"
                        loading={restoringId === row.id}
                        disabled={restoringId !== null}
                        onClick={() => {
                          setRestoreError(null);
                          setRestoreNotice(null);
                          setRestoringId(row.id);
                          restoreItem(scope, row.id, row.revision).then(
                            (restored) => {
                              setRestoringId(null);
                              setRestoreNotice(t("list.restored_notice", { title: restored.title }));
                              void load();
                            },
                            (error: unknown) => {
                              setRestoringId(null);
                              const f = classify(error);
                              setRestoreError(f.kind === "message" ? t(f.key) : t("error.generic"));
                            },
                          );
                        }}
                      >
                        {t("action.restore")}
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </section>
  );
}
