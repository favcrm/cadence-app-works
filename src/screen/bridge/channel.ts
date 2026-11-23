import { ApiError } from "@cadence/screen-ui";
import {
  createScreenBridge,
  type ScreenBridge,
  type ScreenBridgeRuntimeOverrides,
  type ScreenLeaveHandle,
} from "@cadence/app-kit";
import { bindBridgeScope, type DisplayScope } from "./scope";
import {
  CALL_FIELDS,
  OPERATIONS,
  SECTIONS,
  SLOT_FIELDS,
  WRITES,
  requestBudget,
  type Section,
  type WorksView,
} from "./operations";

export const CONNECTION_LOST_TEXT =
  "The connection to the workspace was lost. Reload the page to continue.";

const lost = (status = 502) =>
  new ApiError(CONNECTION_LOST_TEXT, status, { code: "connection_lost" });

export type WorksBridge = ScreenBridge<Section, WorksView, ApiError>;

function createWorksBridge(): WorksBridge {
  return createScreenBridge<Section, WorksView, ApiError>({
    tag: "works",
    appName: "works",
    records: true,
    locale: true,
    surfaces: true,
    canvas: true,
    routeParams: true,
    calls: CALL_FIELDS,
    slots: SLOT_FIELDS,
    argBytes: Object.fromEntries(OPERATIONS.map((verb) => [verb, requestBudget(verb)])),
    writeVerbs: WRITES,
    route: { sections: SECTIONS, defaultSection: "all", views: ["list", "new"] },
    maxInFlight: 8,
    timeoutMs: 65000,
    createError: (message, status, options) => {
      if (status === 502 || status === 504 || options?.code === "gone") {
        return lost(status === 504 ? 504 : 502);
      }
      if (status === 429) return new ApiError("Works is busy; wait for the current request", 429);
      return new ApiError(message, status, options);
    },
  });
}

class Channel {
  private instance: WorksBridge | null = null;

  get bridge(): WorksBridge {
    this.instance ??= createWorksBridge();
    return this.instance;
  }

  start(runtime: ScreenBridgeRuntimeOverrides = {}): void {
    bindBridgeScope(this.bridge);
    this.bridge.start(runtime);
    if (this.bridge.getState().status === "error") throw lost();
  }

  // Reads keep the mount alive on a 403: a read-only canvas may refuse
  // operations the primary screen is allowed, and that must not tear the
  // whole screen down.
  call<T = unknown>(scope: DisplayScope, verb: string, args: Record<string, unknown>): Promise<T> {
    if (this.bridge.getState().status === "error" || !this.bridge.getSnapshot()) {
      return Promise.reject(lost());
    }
    return this.bridge.call<T>(scope, verb, args, { keepAliveOnForbidden: true });
  }

  slot<T = unknown>(scope: DisplayScope, verb: string, args: Record<string, unknown>): Promise<T> {
    if (this.bridge.getState().status === "error" || !this.bridge.getSnapshot()) {
      return Promise.reject(lost());
    }
    return this.bridge.slot<T>(scope, verb, args, "footer");
  }

  ownLeaveState(): ScreenLeaveHandle | null {
    return this.bridge.ownLeaveState();
  }

  retire(): void {
    this.bridge.retire(lost());
  }
}

export const channel = new Channel();
