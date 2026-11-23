import type { ReactNode } from "react";
import type { Kind } from "../../bridge/operations";
import type { ReviewState, ReviewStatus } from "../../domain/works";
import { useLocale } from "./locale";

type Tone = "neutral" | "ok" | "warn";

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="works-chip" data-tone={tone}>
      {children}
    </span>
  );
}

export function KindChip({ kind }: { kind: Kind }) {
  const { t } = useLocale();
  return <Chip>{kind === "doc" ? t("kind.doc") : kind === "deck" ? t("kind.deck") : t("kind.sheet")}</Chip>;
}

// The label comes only from host results: reviewStatus and reviewState.
export function ReviewChip({ status, state }: { status: ReviewStatus; state: ReviewState }) {
  const { t } = useLocale();
  if (status === "pending") return <Chip tone="warn">{t("review.pending")}</Chip>;
  if (status === "changes_requested") return <Chip tone="warn">{t("review.changes")}</Chip>;
  if (state === "reviewed") return <Chip tone="ok">{t("review.reviewed")}</Chip>;
  if (state === "edited") return <Chip tone="warn">{t("review.edited")}</Chip>;
  return <Chip>{t("review.draft")}</Chip>;
}
