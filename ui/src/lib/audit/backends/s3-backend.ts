// assisted-by claude code claude-sonnet-4-6
/**
 * S3-compatible audit log backend (TypeScript / Next.js).
 *
 * Buffers events in memory and flushes them as a single gzip-compressed
 * NDJSON file per batch to S3 on a configurable interval or count threshold:
 *   s3://<bucket>/<prefix>/YYYY/MM/DD/audit-<YYYYMMDDTHHMMSSZ>-<uuid>.ndjson.gz
 *
 * Note: Parquet output is deferred to a follow-up; no mature server-side
 * Parquet writer exists for Node.js without heavy native dependencies.
 * The Python S3 backend writes Parquet. Align on one format once a
 * lightweight TS Parquet library is available.
 *
 * Credential chain (handled automatically by the AWS SDK):
 *   1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 *   2. IRSA / web-identity token (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE)
 *   3. EC2/ECS instance metadata
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gzip } from "zlib";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type { AuditBackend } from "../backend";

const gzipAsync = promisify(gzip);

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_FLUSH_BATCH_SIZE = 100;

function zeroPad(n: number): string {
  return String(n).padStart(2, "0");
}

export class S3Backend implements AuditBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly flushBatchSize: number;
  private buffer: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    bucket: string,
    prefix: string = "audit",
    region: string = "us-east-1",
    endpointUrl?: string,
    flushIntervalMs: number = DEFAULT_FLUSH_INTERVAL_MS,
    flushBatchSize: number = DEFAULT_FLUSH_BATCH_SIZE,
  ) {
    this.bucket = bucket;
    this.prefix = prefix.replace(/\/$/, "");
    this.flushBatchSize = flushBatchSize;
    this.client = new S3Client({
      region,
      ...(endpointUrl ? { endpoint: endpointUrl, forcePathStyle: true } : {}),
    });
    this.flushTimer = setInterval(() => void this._flushBuffer(), flushIntervalMs);
    // Don't hold the Node.js process open just for audit flushes
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
    await this._uploadBatch(events);
  }

  private async _uploadBatch(events: Record<string, unknown>[]): Promise<void> {
    try {
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = zeroPad(now.getUTCMonth() + 1);
      const dd = zeroPad(now.getUTCDate());
      const hh = zeroPad(now.getUTCHours());
      const min = zeroPad(now.getUTCMinutes());
      const sec = zeroPad(now.getUTCSeconds());
      const tsCompact = `${yyyy}${mm}${dd}T${hh}${min}${sec}Z`;
      const keyUuid = randomUUID().replace(/-/g, "").slice(0, 12);
      const key = `${this.prefix}/${yyyy}/${mm}/${dd}/audit-${tsCompact}-${keyUuid}.ndjson.gz`;

      const ndjson = events
        .map((e) => JSON.stringify(e, (_k, v) => (v instanceof Date ? v.toISOString() : v)))
        .join("\n") + "\n";
      const body = await gzipAsync(Buffer.from(ndjson, "utf-8"));

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          // ContentType=application/gzip (no ContentEncoding) — consumers see
          // the object as an opaque gzip file and must decompress explicitly.
          // Avoid ContentEncoding:gzip which triggers transparent auto-decompression
          // in Athena / S3 SDKs, making the .gz extension misleading.
          ContentType: "application/gzip",
        }),
      );
      console.debug(`[audit/s3] Flushed ${events.length} events → s3://${this.bucket}/${key}`);
    } catch (err) {
      console.warn(`[audit/s3] Failed to flush ${events.length} events:`, err);
    }
  }
}
