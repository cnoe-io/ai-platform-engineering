// Lightweight, side-effect-free progress logging for the long phases of a
// directory sync (dedupe, member resolution, stamping, planning, applying).
//
// A full-directory sync spends minutes inside phases that otherwise emit no
// log lines, which makes "is it still working or wedged?" impossible to answer
// from the pod logs alone. `startStageProgress` emits one line with the total
// work count when a phase begins and then roughly one line every 5% (plus a
// final 100% line), so each stage shows steady movement.
//
// This is purely observational — it never changes what work runs, so adding or
// removing it can't affect the outcome of a sync.

// How many progress lines to emit across a stage (20 → ~every 5%).
const PROGRESS_INTERVALS = 20;

export interface StageProgress {
  /** Report cumulative items completed; logs when a ~5% boundary is crossed. */
  tick(done: number): void;
  /** Emit the final 100% line (idempotent). */
  done(): void;
}

/**
 * Begin a progress-logged stage. Logs a "<total> to process" header
 * immediately, returns a handle whose `tick(done)` logs at ~5% boundaries and
 * whose `done()` logs the closing 100% line. A `total` of 0 logs the header and
 * then no-ops, so an empty stage is visible but silent afterward.
 */
export function startStageProgress(
  stage: string,
  total: number,
  log: (message: string) => void = console.log
): StageProgress {
  log(`[IdpSync] ${stage}: ${total} to process`);
  const step = Math.max(1, Math.floor(total / PROGRESS_INTERVALS));
  let lastLogged = 0;
  let finished = false;
  return {
    tick(done: number) {
      if (total <= 0 || done <= 0) return;
      // Log only when we've advanced at least one 5% step since the last line,
      // and never emit a mid-stage line at/after the total (done() owns 100%).
      if (done < total && done - lastLogged >= step) {
        lastLogged = done;
        log(`[IdpSync] ${stage}: ${Math.floor((done / total) * 100)}% (${done}/${total})`);
      }
    },
    done() {
      if (finished) return;
      finished = true;
      if (total > 0) {
        log(`[IdpSync] ${stage}: 100% (${total}/${total}) complete`);
      }
    },
  };
}
