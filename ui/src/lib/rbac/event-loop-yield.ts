// Cooperative event-loop yielding for large synchronous loops.
//
// The directory-sync path (rule matching, planning, membership reconcile) runs
// in the same Node process that serves this pod's k8s liveness/readiness
// probes. A full-directory sync can iterate over hundreds of thousands of
// members/sources with no awaited I/O, and an unbroken CPU loop that long stops
// the event loop from ever running the probe handler — k8s then SIGKILLs the
// pod (exit 137). Handing control back via `setImmediate` every N iterations
// lets any pending probe callback run between chunks.

// Iterations of a purely-synchronous loop to run before yielding. Each covered
// iteration is a cheap in-memory op, so a small threshold costs almost nothing
// while keeping probes responsive. Tunable via env so tests can exercise the
// yield without a huge fixture.
const DEFAULT_LOOP_YIELD_EVERY = 500;

export function loopYieldEvery(): number {
  const fromEnv = Number(process.env.IDENTITY_SYNC_LOOP_YIELD_EVERY);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return Math.floor(fromEnv);
  return DEFAULT_LOOP_YIELD_EVERY;
}

export function yieldToEventLoop(): Promise<void> {
  // `setImmediate` is the cheapest macrotask yield in Node (the sync path's real
  // runtime) and lets a pending probe callback run before the next chunk. It is
  // NOT a browser/jsdom global, so fall back to `setTimeout(0)` where it's
  // absent (e.g. the jsdom test env) — both hand control back to the loop.
  const scheduleMacrotask =
    typeof setImmediate === "function"
      ? setImmediate
      : (cb: () => void) => setTimeout(cb, 0);
  return new Promise((resolve) => scheduleMacrotask(() => resolve()));
}

/**
 * Await a yield to the event loop every `every` calls. Increment a counter you
 * own and pass it in; when `count % every === 0` this hands the loop back.
 * Keeping the counter caller-side lets a single budget span nested loops.
 */
export async function maybeYield(count: number, every: number = loopYieldEvery()): Promise<void> {
  if (count > 0 && count % every === 0) {
    await yieldToEventLoop();
  }
}
