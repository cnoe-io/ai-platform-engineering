/**
 * Audit backend factory.
 *
 * Reads AUDIT_LOG_BACKEND once at first call and returns a module-level
 * singleton used by all audit write-paths. Supported values:
 *   - "local"  (default) — writes NDJSON files to AUDIT_LOG_LOCAL_PATH
 *   - "s3"     — writes gzip-compressed NDJSON objects to S3
 *
 * AuditBackend.write() must never throw; implementations log errors internally.
 */

export interface AuditBackend {
  /** Fire-and-forget write. Must never throw; log errors internally. */
  write(event: Record<string, unknown>): void;
}

let _backend: AuditBackend | null = null;

export function getAuditBackend(): AuditBackend {
  if (_backend) return _backend;
  _backend = createBackend();
  return _backend;
}

function createBackend(): AuditBackend {
  const backendName = (process.env.AUDIT_LOG_BACKEND ?? "local").trim().toLowerCase();

  if (backendName === "local") {
    const { LocalBackend } = require("./backends/local-backend") as typeof import("./backends/local-backend");
    const path = process.env.AUDIT_LOG_LOCAL_PATH ?? "./audit-logs";
    console.info(`[audit] backend=local path=${path}`);
    return new LocalBackend(path);
  }

  if (backendName === "s3") {
    const { S3Backend } = require("./backends/s3-backend") as typeof import("./backends/s3-backend");
    const bucket = (process.env.AUDIT_LOG_S3_BUCKET ?? "").trim();
    if (!bucket) {
      throw new Error("AUDIT_LOG_S3_BUCKET must be set when AUDIT_LOG_BACKEND=s3");
    }
    const prefix = process.env.AUDIT_LOG_S3_PREFIX ?? "audit";
    const region = process.env.AUDIT_LOG_S3_REGION ?? "us-east-1";
    const endpointUrl = process.env.AUDIT_LOG_S3_ENDPOINT_URL || undefined;
    console.info(`[audit] backend=s3 bucket=${bucket} prefix=${prefix}`);
    return new S3Backend(bucket, prefix, region, endpointUrl);
  }

  throw new Error(
    `Unknown AUDIT_LOG_BACKEND value: "${backendName}". Must be one of: local, s3`
  );
}
