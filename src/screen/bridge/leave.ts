import type { ScreenLeaveHandle } from "@cadence/app-kit";
import { useEffect, useState } from "react";
import { channel } from "./channel";

const owners = new Set<symbol>();
let holds = 0;
let handle: ScreenLeaveHandle | null = null;

function publish(): void {
  const unsaved = holds === 0 && owners.size > 0;
  if (handle?.publish(unsaved)) return;
  handle = channel.ownLeaveState();
  handle?.publish(unsaved);
}

export function setUnsaved(owner: symbol, unsaved: boolean): void {
  if (unsaved === owners.has(owner)) return;
  if (unsaved) owners.add(owner);
  else owners.delete(owner);
  publish();
}

export async function withoutLeaveWarning<T>(navigate: () => Promise<T>): Promise<T> {
  holds += 1;
  if (owners.size > 0) publish();
  try {
    return await navigate();
  } finally {
    holds -= 1;
    if (owners.size > 0) publish();
  }
}

export function useUnsavedEdits<T>(initial: T, fields: T): void {
  const [owner] = useState(() => Symbol("form"));
  const [opened] = useState(() => JSON.stringify(initial));
  const unsaved = JSON.stringify(fields) !== opened;
  useEffect(() => {
    setUnsaved(owner, unsaved);
  }, [owner, unsaved]);
  useEffect(
    () => () => {
      setUnsaved(owner, false);
    },
    [owner],
  );
}
