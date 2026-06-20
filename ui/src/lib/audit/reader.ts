/**
 * Audit reader factory.
 *
 * Mirrors getAuditBackend() — reads AUDIT_LOG_BACKEND and returns a singleton
 * reader matched to the active backend. The UI no longer reads local, S3, or
 * Parquet storage directly; audit-service owns storage and readback.
 */

export interface AuditQueryOptions {
  /** Inclusive lower bound. Defaults to 24 h ago. */
  since?: Date;
  /** Inclusive upper bound. Defaults to now. */
  until?: Date;
  /** Filter by event type (e.g. "auth", "openfga_rebac"). */
  type?: string;
  outcome?: string;
  component?: string;
  correlationId?: string;
  tenantId?: string;
  source?: string;
  action?: string;
  capability?: string;
  resourceRef?: string;
  subjectHash?: string;
  reasonCode?: string;
  agentName?: string;
  toolName?: string;
  userEmail?: string;
  /** Maximum rows to return. Defaults to 1000. */
  limit?: number;
}

export interface AuditReader {
  /** Human-readable name of the active backend ("service" | "off"). */
  readonly backendName: string;
  /** Query stored audit events. Never throws; returns [] on error. */
  query(opts?: AuditQueryOptions): Promise<Record<string, unknown>[]>;
}

let _reader: AuditReader | null = null;

class NoopAuditReader implements AuditReader {
  readonly backendName: string;

  constructor(backendName: string) {
    // assisted-by Codex Codex-sonnet-4-6
    this.backendName = backendName;
  }

  async query(): Promise<Record<string, unknown>[]> {
    return [];
  }
}

export function getAuditReader(): AuditReader {
  if (_reader) return _reader;
  _reader = createReader();
  return _reader;
}

function createReader(): AuditReader {
  const backendName = (process.env.AUDIT_LOG_BACKEND ?? "service").trim().toLowerCase();

  if (["off", "disabled", "none"].includes(backendName)) {
    return new NoopAuditReader("off");
  }

  if (backendName === "service") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ServiceReader } = require("./readers/service-reader") as typeof import("./readers/service-reader");
    const serviceUrl = process.env.AUDIT_SERVICE_URL ?? process.env.AUDIT_LOG_SERVICE_URL ?? "http://audit-service:8010";
    return new ServiceReader(serviceUrl);
  }

  console.warn(
    `[audit/reader] unsupported AUDIT_LOG_BACKEND="${backendName}"; local/S3 reads moved to audit-service, returning no audit rows`,
  );
  return new NoopAuditReader(backendName);
}
