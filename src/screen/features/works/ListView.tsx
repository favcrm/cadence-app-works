import { Button, DataTable, EmptyState, ErrorNotice, Loading, Select } from "@cadence/screen-ui";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Kind } from "../../bridge/operations";
import type { DisplayScope } from "../../bridge/scope";
import type { WorksRow } from "../../domain/works";
import { classify, queryRows, type Failure } from "./api";
import { useLocale } from "./locale";
import { KindChip, ReviewChip } from "./StatusChip";

export interface ListProps {
  scope: DisplayScope;
  kind: Kind | undefined;
  canvas: boolean;
  canCreate: boolean;
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
  const [rows, setRows] = useState<WorksRow[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [review, setReview] = useState("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setRows(
        await queryRows(scope, {
          sort,
          ...(kind ? { kind } : {}),
          ...(text ? { text } : {}),
          ...(review !== "all" ? { review } : {}),
        }),
      );
    } catch (error) {
      setRows(null);
      setFailure(classify(error));
    }
  }, [scope, kind, text, review, sort]);

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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportFile(file);
  };

  return (
    <section className="works-list">
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
          <Select
            size="sm"
            aria-label={t("filter.review")}
            value={review}
            options={reviewOptions}
            onChange={setReview}
          />
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
          {!canvas && canCreate ? (
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
        <EmptyState title={t("list.empty_title")} name="works">
          {text || review !== "all" ? t("list.empty_filtered") : t("list.empty_body")}
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
              cell: (row) => (
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
          ]}
        />
      )}
    </section>
  );
}
