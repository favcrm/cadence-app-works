// Ported from cloudflare-os libraries/sync/src/save-scheduler.ts

export type SaveStatus = "saved" | "saving" | "synced" | "conflict" | "offline";

export type SaveOutcome = "saved" | "conflict" | "pending";

export const DEBOUNCE_MS = 600;
export const RETRY_BASE_MS = 120;
export const RETRY_MAX_MS = 10_000;

export function retryDelay(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

export interface SaveSchedulerOptions {
  save(): Promise<SaveOutcome>;
  isDirty(): boolean;
  onStatus?(status: SaveStatus, message: string): void;
  debounceMs?: number;
  readOnly?: boolean;
}

export class SaveScheduler {
  readonly #options: SaveSchedulerOptions;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #shown: SaveStatus | null = null;
  #inFlight = false;
  #saveAgain = false;
  #failures = 0;
  #disposed = false;

  constructor(options: SaveSchedulerOptions) {
    this.#options = options;
  }

  get busy(): boolean {
    return this.#timer !== null || this.#inFlight;
  }

  get failures(): number {
    return this.#failures;
  }

  schedule(delay = this.#options.debounceMs ?? DEBOUNCE_MS): void {
    if (this.#disposed || this.#options.readOnly) return;
    this.#status("saving", "Saving…");
    this.#arm(delay);
  }

  #arm(delay: number): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      if (this.#disposed) return;
      if (this.#shown !== "saving") this.#status("saving", "Saving…");
      void this.flush();
    }, delay);
  }

  cancel(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  dispose(): void {
    this.#disposed = true;
    this.cancel();
  }

  async flush(): Promise<void> {
    this.cancel();
    if (this.#disposed || this.#options.readOnly) return;
    if (this.#inFlight) {
      this.#saveAgain = true;
      return;
    }
    this.#inFlight = true;
    let outcome: SaveOutcome | null = null;
    try {
      outcome = await this.#options.save();
      this.#failures = 0;
      if (outcome === "conflict") {
        this.#status("conflict", "Conflict");
      } else if (outcome === "pending") {
        this.#status("conflict", "Pending");
      } else {
        this.#status("saved", "Saved");
      }
    } catch {
      this.#failures++;
      this.#saveAgain = true;
      this.#status("offline", "Save failed");
    } finally {
      this.#inFlight = false;
      if (
        !this.#disposed &&
        outcome !== "conflict" &&
        (this.#saveAgain || (outcome !== "pending" && this.#options.isDirty()))
      ) {
        this.#saveAgain = false;
        if (this.#failures) {
          this.#arm(retryDelay(this.#failures));
        } else {
          this.schedule(RETRY_BASE_MS);
        }
      }
    }
  }

  #status(status: SaveStatus, message: string): void {
    this.#shown = status;
    this.#options.onStatus?.(status, message);
  }
}
