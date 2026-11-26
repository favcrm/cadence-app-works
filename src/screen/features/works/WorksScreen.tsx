import { ErrorNotice, Loading, Notice, Button } from "@cadence/screen-ui";
import { useEffect, useRef, useState } from "react";
import { withoutLeaveWarning } from "../../bridge/leave";
import type { Kind } from "../../bridge/operations";
import { patchRoute } from "../../bridge/route";
import { scopeError, useCanvasReadOnly, useScope } from "../../bridge/scope";
import { starterDraft } from "../../cfos/labels";
import { kindSection, sectionKind, type WorksRow } from "../../domain/works";
import { classify, createItem, restoreItem } from "./api";
import { DetailView } from "./DetailView";
import { ListView } from "./ListView";
import { WorksLocaleProvider, useLocale, type Locale } from "./locale";
import { NewView } from "./NewView";
import "./works.css";

const HOST_PUSH_TIMEOUT_MS = 15000;

function initialLocale(): Locale {
  return typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language ?? "") ? "zh-TW" : "en";
}

export default function WorksScreen() {
  const snapshot = useScope();
  const canvas = useCanvasReadOnly();
  const locale = useRef<Locale>(initialLocale());
  if (snapshot) locale.current = snapshot.presentationLocale;
  return (
    <WorksLocaleProvider locale={locale.current} canvas={canvas}>
      <Mounted />
    </WorksLocaleProvider>
  );
}

type Trashed = { id: string; title: string; revision: number };

function Mounted() {
  const { t } = useLocale();
  const snapshot = useScope();
  const canvas = useCanvasReadOnly();
  const [unreachable, setUnreachable] = useState(false);
  const [trashed, setTrashed] = useState<Trashed | null>(null);
  const [restoreFailure, setRestoreFailure] = useState<string | null>(null);
  const [navFailure, setNavFailure] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<Kind | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (snapshot) return;
    const timer = setTimeout(() => setUnreachable(true), HOST_PUSH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);

  if (!snapshot) {
    const lost = scopeError();
    if (lost !== null) return <ErrorNotice>{t("error.lost")}</ErrorNotice>;
    return unreachable ? <ErrorNotice>{t("screen.unreachable")}</ErrorNotice> : <Loading>{t("screen.opening")}</Loading>;
  }

  const { scope, route, actions } = snapshot;
  const can = (verb: string) => !canvas && actions.includes(verb);
  const kind = sectionKind(route.section);
  // A canvas opens straight to the document named by the `p.id` route param.
  const openId = route.record_id ?? route.params.id ?? null;
  const base = { section: route.section };

  const navigate = (patch: Parameters<typeof patchRoute>[0]) => {
    setNavFailure(null);
    patchRoute(patch).catch((error: unknown) => {
      const failure = classify(error);
      setNavFailure(
        failure.kind === "message"
          ? t(failure.key)
          : failure.kind === "unavailable"
            ? t("error.forbidden")
            : t("error.generic"),
      );
    });
  };

  const goList = () => navigate({ ...base, view: "list", record_id: null });
  const open = (row: Pick<WorksRow, "id">) => navigate({ ...base, view: "list", record_id: row.id });

  const quickCreate = (targetKind: Kind) => {
    if (creatingKind !== null || canvas) return;
    setNavFailure(null);
    setCreatingKind(targetKind);
    const seeded = starterDraft(targetKind, t);
    createItem(scope, targetKind, seeded.title, seeded.content).then(
      (item) => {
        setCreatingKind(null);
        setRefreshKey((n) => n + 1);
        void withoutLeaveWarning(() =>
          patchRoute({ section: kindSection(item.kind), view: "list", record_id: item.id }),
        ).catch((error: unknown) => {
          const failure = classify(error);
          setNavFailure(failure.kind === "message" ? t(failure.key) : t("error.generic"));
        });
      },
      (error: unknown) => {
        setCreatingKind(null);
        const failure = classify(error);
        setNavFailure(
          failure.kind === "message"
            ? t(failure.key)
            : failure.kind === "unavailable"
              ? t("error.forbidden")
              : t("error.generic"),
        );
      },
    );
  };

  return (
    <main className={`app-outlet works${canvas ? " works-canvas" : ""}`}>
      {navFailure ? <ErrorNotice>{navFailure}</ErrorNotice> : null}
      {route.view === "new" && !canvas ? (
        <NewView
          scope={scope}
          initialKind={kind ?? "doc"}
          onCancel={goList}
          onCreated={(item) => {
            setRefreshKey((n) => n + 1);
            void withoutLeaveWarning(() =>
              patchRoute({ section: kindSection(item.kind), view: "list", record_id: item.id }),
            ).catch((error: unknown) => {
              const failure = classify(error);
              setNavFailure(failure.kind === "message" ? t(failure.key) : t("error.generic"));
            });
          }}
        />
      ) : openId ? (
        <DetailView
          key={openId}
          scope={scope}
          id={openId}
          canvas={canvas}
          canEdit={can("works.patch")}
          canRequestReview={can("works.request_review")}
          canReview={can("works.review")}
          canExport={can("works.export")}
          canTrash={can("works.trash")}
          showBack={!(canvas && route.params.id)}
          onBack={goList}
          onTrashed={(next) => {
            setTrashed(next);
            setRestoreFailure(null);
            setRefreshKey((n) => n + 1);
            void withoutLeaveWarning(() =>
              patchRoute({ ...base, view: "list", record_id: null }),
            ).catch((error: unknown) => {
              const failure = classify(error);
              setNavFailure(failure.kind === "message" ? t(failure.key) : t("error.generic"));
            });
          }}
        />
      ) : (
        <>
          <h2 className="text-section works-heading" data-outlet-heading>
            {t("screen.title")}
          </h2>
          {trashed && !canvas ? (
            <Notice state="trashed">
              {t("trash.done", { title: trashed.title })}{" "}
              <Button
                size="sm"
                onClick={() => {
                  restoreItem(scope, trashed.id, trashed.revision).then(
                    () => {
                      setTrashed(null);
                      setRefreshKey((n) => n + 1);
                    },
                    (error: unknown) => {
                      const failure = classify(error);
                      setRestoreFailure(failure.kind === "message" ? t(failure.key) : t("error.generic"));
                    },
                  );
                }}
              >
                {t("action.restore")}
              </Button>
            </Notice>
          ) : null}
          {restoreFailure ? <ErrorNotice>{restoreFailure}</ErrorNotice> : null}
          <ListView
            scope={scope}
            kind={kind}
            canvas={canvas}
            canCreate={can("works.create")}
            creatingKind={creatingKind}
            refreshKey={refreshKey}
            onOpen={open}
            onQuickCreate={quickCreate}
            onNew={() => navigate({ ...base, view: "new", record_id: null })}
          />
        </>
      )}
    </main>
  );
}
