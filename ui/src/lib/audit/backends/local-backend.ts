// assisted-by claude code claude-sonnet-4-6
/**
 * Local-disk audit log backend.
 *
 * Appends one JSON event per line (NDJSON) to:
 *   <path>/YYYY/MM/DD/<event_type>-<YYYYMMDD>-<uuid>.ndjson
 *
 * Files are opened in append mode. The UUID suffix is stable for the
 * lifetime of the process instance, keeping one file per (process × type × day).
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { AuditBackend } from "../backend";

function toIsoDate(ts: unknown): string {
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string") return ts;
  return new Date().toISOString();
}

function zeroPad(n: number): string {
  return String(n).padStart(2, "0");
}

export class LocalBackend implements AuditBackend {
  private readonly root: string;
  private readonly fileUuid: string;

  constructor(rootPath: string) {
    this.root = rootPath;
    this.fileUuid = randomUUID().replace(/-/g, "").slice(0, 12);
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
      const yyyymmdd = `${yyyy}${mm}${dd}`;

      const eventType = String(event["type"] ?? "audit");
      const dateDir = path.join(this.root, yyyy, mm, dd);
      await fs.mkdir(dateDir, { recursive: true });

      const filename = `${eventType}-${yyyymmdd}-${this.fileUuid}.ndjson`;
      const filepath = path.join(dateDir, filename);

      const serialized = JSON.stringify(event, (_k, v) =>
        v instanceof Date ? v.toISOString() : v
      );
      await fs.appendFile(filepath, serialized + "\n", "utf-8");
    } catch (err) {
      console.warn("[audit/local] Failed to write audit event:", err);
    }
  }
}
