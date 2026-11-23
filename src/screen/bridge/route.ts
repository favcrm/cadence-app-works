import { ApiError } from "@cadence/screen-ui";
import { channel } from "./channel";
import { withoutLeaveWarning } from "./leave";
import { getScope } from "./scope";
import type { CallArgs } from "./operations";

export function patchRoute(patch: CallArgs["screen.route.patch"]): Promise<unknown> {
  const s = getScope();
  if (!s) return Promise.reject(new ApiError("Works route is unavailable", 403));
  return withoutLeaveWarning(() =>
    channel.call(s.scope, "screen.route.patch", patch as Record<string, unknown>),
  );
}
