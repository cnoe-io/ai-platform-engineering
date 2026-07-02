/**
 * HTTP audit-service backend.
 *
 * Buffers events in the Next.js process and posts JSON batches to the
 * lightweight Python audit service. Parquet/S3 work stays out of caipe-ui-prod.
 */

import type { AuditBackend } from "../backend";

const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_FLUSH_BATCH_SIZE = 100;

export class ServiceBackend implements AuditBackend {
  private readonly baseUrl: string;
  private readonly flushBatchSize: number;
  private buffer: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    baseUrl: string,
    flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS,
    flushBatchSize: number = DEFAULT_FLUSH_BATCH_SIZE,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.flushBatchSize = flushBatchSize;
    this.flushTimer = setInterval(() => void this._flushBuffer(), flushIntervalMs);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  write(event: Record<string, unknown>): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.flushBatchSize) {
      void this._flushBuffer();
    }
  }

  private async _flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    try {
      const response = await fetch(`${this.baseUrl}/v1/audit/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        throw new Error(`audit-service returned HTTP ${response.status}`);
      }
      console.debug(`[audit/service] Flushed ${events.length} events`);
    } catch (err) {
      console.warn(`[audit/service] Failed to flush ${events.length} events:`, err);
    }
  }
}
