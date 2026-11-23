import type { ScreenScopeSnapshot } from "@cadence/app-kit";
import { useSyncExternalStore } from "react";
import { channel, CONNECTION_LOST_TEXT, type WorksBridge } from "./channel";
import type { Section, WorksView } from "./operations";

export interface DisplayScope {
  installId: string;
  digest: string;
}

export interface Route {
  section: Section;
  view: WorksView;
  record_id: string | null;
  segment_id: string | null;
  params: Readonly<Record<string, string>>;
}

export interface ScopeSnapshot {
  presentationLocale: "en" | "zh-TW";
  scope: DisplayScope;
  actions: string[];
  route: Route;
}

type Pushed = ScreenScopeSnapshot<Section, WorksView>;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

let active: WorksBridge | null = null;
let unsubscribe: (() => void) | null = null;
let pushed: Pushed | null = null;
let snapshot: ScopeSnapshot | null = null;

export function bindBridgeScope(bridge: WorksBridge): void {
  if (active === bridge) return;
  unsubscribe?.();
  active = bridge;
  unsubscribe = bridge.subscribe(notify);
  notify();
}

const current = (): WorksBridge => {
  if (active === null) bindBridgeScope(channel.bridge);
  return active!;
};

function project(next: Pushed | null): ScopeSnapshot | null {
  if (next === pushed) return snapshot;
  pushed = next;
  snapshot =
    next === null
      ? null
      : {
          presentationLocale: next.presentationLocale,
          scope: { installId: next.scope.installId, digest: next.digest },
          actions: [...next.actions],
          route: next.route
            ? { ...next.route, params: next.route.params ?? {} }
            : { section: "all", view: "list", record_id: null, segment_id: null, params: {} },
        };
  return snapshot;
}

const subscribeScope = (f: () => void) => {
  current();
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export const getScope = (): ScopeSnapshot | null => project(current().getSnapshot());
const getCanvasReadOnly = (): boolean => current().getState().surface.readOnly === true;

export function useCanvasReadOnly(): boolean {
  return useSyncExternalStore(subscribeScope, getCanvasReadOnly);
}
export function useScope(): ScopeSnapshot | null {
  return useSyncExternalStore(subscribeScope, getScope);
}
export function scopeError(): string | null {
  return current().getState().status === "error" ? CONNECTION_LOST_TEXT : null;
}
