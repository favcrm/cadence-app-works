import { Button, ErrorNotice, Field, Select } from "@cadence/screen-ui";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { setUnsaved } from "../../bridge/leave";
import type { Kind } from "../../bridge/operations";
import type { DisplayScope } from "../../bridge/scope";
import { starterDraft } from "../../cfos/labels";
import { KINDS, validateDraft, type Content, type WorksItem } from "../../domain/works";
import { classify, createItem } from "./api";
import { ContentEditor } from "./editors";
import { useLocale } from "./locale";
import { PROBLEM_KEY } from "./problems";

export function NewView({
  scope,
  initialKind,
  importing,
  onImportFile,
  onCreated,
  onCancel,
}: {
  scope: DisplayScope;
  initialKind: Kind;
  importing: boolean;
  onImportFile: (file: File) => void;
  onCreated: (item: WorksItem) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [kind, setKind] = useState<Kind>(initialKind);
  const initial = starterDraft(initialKind, t);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState<Content>(initial.content);
  const [resetKey, setResetKey] = useState(0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const owner = useRef(Symbol("works-new"));

  useEffect(() => {
    const token = owner.current;
    setUnsaved(token, touched);
    return () => setUnsaved(token, false);
  }, [touched]);

  const kindOptions = KINDS.map((value) => ({
    value,
    label: value === "doc" ? t("kind.doc") : value === "deck" ? t("kind.deck") : t("kind.sheet"),
  }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateDraft(title, content);
    if (problem) {
      setError(t(PROBLEM_KEY[problem]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await createItem(scope, kind, title, content));
    } catch (failure) {
      const outcome = classify(failure);
      setError(
        outcome.kind === "message"
          ? t(outcome.key)
          : outcome.kind === "unavailable"
            ? t("error.forbidden")
            : t("error.generic"),
      );
      setBusy(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportFile(file);
  };

  const handleDragEnter = (event: DragEvent) => {
    if (busy || importing || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (event: DragEvent) => {
    if (busy || importing || !event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const handleDrop = (event: DragEvent) => {
    if (busy || importing) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) onImportFile(file);
  };

  return (
    <form
      className="works-form works-new-shell"
      noValidate
      onSubmit={(event) => void submit(event)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="works-toolbar">
        <h2 className="text-section works-heading" data-outlet-heading>
          {t("new.title")}
        </h2>
        <div className="works-chips">
          <Button
            size="sm"
            variant="ghost"
            loading={importing}
            disabled={busy || importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? t("import.busy") : t("import.choose_file")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.xlsx,.pptx,.csv,.md,.txt"
            aria-label={t("import.choose_file")}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <Button variant="primary" size="sm" type="submit" loading={busy} disabled={importing}>
            {t("action.create")}
          </Button>
          <Button size="sm" disabled={busy || importing} onClick={onCancel}>
            {t("action.cancel")}
          </Button>
        </div>
      </div>
      {dragOver ? <div className="works-import-dropbanner">{t("import.drop_hint")}</div> : null}
      <div className="works-import-dropzone">
        <p className="works-muted">{t("import.view_body")}</p>
      </div>
      <div className="works-new-meta">
        <Field label={t("field.kind")}>
          {(control) => (
            <Select
              {...control}
              value={kind}
              options={kindOptions}
              onChange={(value) => {
                const next = KINDS.find((k) => k === value);
                if (!next || next === kind) return;
                const seeded = starterDraft(next, t);
                setKind(next);
                if (!touched) setTitle(seeded.title);
                setContent(seeded.content);
                setResetKey((k) => k + 1);
              }}
            />
          )}
        </Field>
        <Field label={t("field.title")}>
          {(control) => (
            <input
              {...control}
              className="field"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTouched(true);
              }}
            />
          )}
        </Field>
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="works-workbench-frame">
        <ContentEditor
          title={title}
          content={content}
          resetKey={resetKey}
          onChange={(next) => {
            setContent(next);
            setTouched(true);
          }}
        />
      </div>
    </form>
  );
}
