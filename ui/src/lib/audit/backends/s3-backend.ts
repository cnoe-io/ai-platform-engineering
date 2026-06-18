// assisted-by claude code claude-sonnet-4-6
/**
 * S3-compatible audit log backend.
 *
 * Writes each event as a gzip-compressed single-line NDJSON object to:
 *   s3://<bucket>/<prefix>/YYYY/MM/DD/<type>-<YYYYMMDDTHHMMSSZ>-<uuid>.ndjson.gz
 *
 * Credential chain (handled automatically by the AWS SDK):
 *   1. Env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
 *   2. IRSA / web-identity token (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE)
 *   3. EC2/ECS instance metadata
 *
 * Set endpointUrl to target MinIO or GCS S3-compatible endpoints.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { gzip } from "zlib";
import { promisify } from "util";
import { randomUUID } from "crypto";
import type { AuditBackend } from "../backend";

const gzipAsync = promisify(gzip);

function zeroPad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(ts: unknown): string {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string") return ts;
  return new Date().toISOString();
}

export class S3Backend implements AuditBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(
    bucket: string,
    prefix: string = "audit",
    region: string = "us-east-1",
    endpointUrl?: string,
  ) {
    this.bucket = bucket;
    this.prefix = prefix.replace(/\/$/, "");
    this.client = new S3Client({
      region,
      ...(endpointUrl ? { endpoint: endpointUrl, forcePathStyle: true } : {}),
    });
  }

  write(event: Record<string, unknown>): void {
    void this._writeAsync(event);
  }

  private async _writeAsync(event: Record<string, unknown>): Promise<void> {
    try {
      const isoTs = toIsoDate(event["ts"]);
      const d = new Date(isoTs);
      const yyyy = String(d.getUTCFullYear());
      const mm = zeroPad(d.getUTCMonth() + 1);
      const dd = zeroPad(d.getUTCDate());
      const hh = zeroPad(d.getUTCHours());
      const min = zeroPad(d.getUTCMinutes());
      const sec = zeroPad(d.getUTCSeconds());
      const tsCompact = `${yyyy}${mm}${dd}T${hh}${min}${sec}Z`;

      const eventType = String(event["type"] ?? "audit");
      const keyUuid = randomUUID().replace(/-/g, "").slice(0, 12);
      const key = `${this.prefix}/${yyyy}/${mm}/${dd}/${eventType}-${tsCompact}-${keyUuid}.ndjson.gz`;

      const serialized = JSON.stringify(event, (_k, v) =>
        v instanceof Date ? v.toISOString() : v
      );
      const body = await gzipAsync(Buffer.from(serialized + "\n", "utf-8"));

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: "application/x-ndjson",
          ContentEncoding: "gzip",
        }),
      );
    } catch (err) {
      console.warn("[audit/s3] Failed to write audit event:", err);
    }
  }
}
