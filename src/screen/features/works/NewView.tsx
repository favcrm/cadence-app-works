import { Button, ErrorNotice, Field, Select } from "@cadence/screen-ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { setUnsaved } from "../../bridge/leave";
import type { Kind } from "../../bridge/operations";
import type { DisplayScope } from "../../bridge/scope";
import { emptyContent, KINDS, validateDraft, type Content, type WorksItem } from "../../domain/works";
import { classify, createItem } from "./api";
import { ContentEditor } from "./editors";
import { useLocale } from "./locale";
import { PROBLEM_KEY } from "./problems";

export function NewView({
  scope,
  initialKind,
  onCreated,
  onCancel,
}: {
  scope: DisplayScope;
  initialKind: Kind;
  onCreated: (item: WorksItem) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Content>(() => emptyContent(initialKind));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        outcome.kind === "message" ? t(outcome.key) : outcome.kind === "unavailable" ? t("error.forbidden") : t("error.generic"),
      );
      setBusy(false);
    }
  };

  return (
    <form className="works-form works-new" noValidate onSubmit={(event) => void submit(event)}>
      <h2 className="text-section" data-outlet-heading>
        {t("new.title")}
      </h2>
      <Field label={t("field.kind")}>
        {(control) => (
          <Select
            {...control}
            value={kind}
            options={kindOptions}
            onChange={(value) => {
              const next = KINDS.find((k) => k === value);
              if (!next || next === kind) return;
              setKind(next);
              setContent(emptyContent(next));
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
      <ContentEditor
        content={content}
        onChange={(next) => {
          setContent(next);
          setTouched(true);
        }}
      />
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      <div className="works-chips">
        <Button variant="primary" type="submit" loading={busy}>
          {t("action.create")}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t("action.cancel")}
        </Button>
      </div>
    </form>
  );
}
