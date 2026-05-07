/**
 * SLI counter/gauge surface.
 */
import {
  __resetAgenticSdlcSlisForTests,
  decSseConnection,
  incSseConnection,
  recordProjectionLatency,
  recordWebhook,
  setWorkerQueueDepth,
  snapshotAgenticSdlcSlis,
} from "@/lib/agentic-sdlc/sli";

describe("Agentic SDLC SLIs", () => {
  beforeEach(() => __resetAgenticSdlcSlisForTests());

  it("records webhook outcomes by label", () => {
    recordWebhook("accepted");
    recordWebhook("accepted");
    recordWebhook("rejected_signature");
    expect(snapshotAgenticSdlcSlis().webhooks).toEqual({
      accepted: 2,
      rejected_signature: 1,
    });
  });

  it("setWorkerQueueDepth ignores invalid input", () => {
    setWorkerQueueDepth(5);
    setWorkerQueueDepth(-1);
    setWorkerQueueDepth(Number.NaN);
    expect(snapshotAgenticSdlcSlis().worker_queue_depth).toBe(5);
  });

  it("inc/decSseConnection clamps at zero", () => {
    incSseConnection();
    incSseConnection();
    decSseConnection();
    decSseConnection();
    decSseConnection();
    expect(snapshotAgenticSdlcSlis().sse_active_connections).toBe(0);
  });

  it("records projection latency into bucket histogram", () => {
    recordProjectionLatency(0.04);
    recordProjectionLatency(0.3);
    recordProjectionLatency(7);
    const snap = snapshotAgenticSdlcSlis().projection_latency;
    expect(snap.count).toBe(3);
    expect(snap.sum_seconds).toBeCloseTo(7.34, 5);
    // 0.04 ≤ 0.05 → first bucket+; 0.3 ≤ 0.5 → through 0.5 bucket; 7 ≤ 10 → through 10 bucket
    const counts = Object.fromEntries(snap.buckets.map((b) => [b.le, b.count]));
    expect(counts[0.05]).toBe(1);
    expect(counts[0.5]).toBe(2);
    expect(counts[10]).toBe(3);
  });

  it("ignores non-finite or negative latency", () => {
    recordProjectionLatency(Number.NaN);
    recordProjectionLatency(-1);
    expect(snapshotAgenticSdlcSlis().projection_latency.count).toBe(0);
  });
});
