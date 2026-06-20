import { NextResponse } from "next/server";

export interface AuditConfigResponse {
  backend: string;
  readsAvailable: boolean;
  readsWarning?: string;
  serviceUrl?: string;
  storageBackend?: string;
  storageLabel?: string;
}

function storageLabelFor(backend: string, storageBackend?: string): string {
  if (["off", "disabled", "none"].includes(backend)) return "Storage: disabled";
  if (backend !== "service") return `Storage: ${backend} (unsupported)`;
  if (storageBackend === "s3") return "Storage: audit-service -> S3";
  if (storageBackend === "local") return "Storage: audit-service -> local disk";
  return "Storage: audit-service";
}

async function checkAuditService(
  serviceUrl: string,
): Promise<{ available: boolean; warning?: string; storageBackend?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, "")}/v1/audit/status`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { backend?: unknown };
      return {
        available: true,
        storageBackend: typeof body.backend === "string" ? body.backend : undefined,
      };
    }
    return { available: false, warning: `audit-service returned HTTP ${response.status}` };
  } catch (err) {
    return { available: false, warning: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(): Promise<NextResponse<AuditConfigResponse>> {
  const backend = (process.env.AUDIT_LOG_BACKEND ?? "service").trim().toLowerCase();
  const serviceUrl = process.env.AUDIT_SERVICE_URL ?? process.env.AUDIT_LOG_SERVICE_URL ?? "http://audit-service:8010";

  if (["off", "disabled", "none"].includes(backend)) {
    return NextResponse.json({
      backend: "off",
      readsAvailable: false,
      readsWarning: "Audit collection is disabled; audit events are dropped.",
      serviceUrl,
      storageBackend: "off",
      storageLabel: storageLabelFor("off"),
    });
  }

  if (backend !== "service") {
    return NextResponse.json({
      backend,
      readsAvailable: false,
      readsWarning:
        "UI audit storage only supports AUDIT_LOG_BACKEND=service; local/S3 access moved to audit-service, so audit events are dropped.",
      serviceUrl,
      storageBackend: backend,
      storageLabel: storageLabelFor(backend),
    });
  }

  const { available, warning, storageBackend } = await checkAuditService(serviceUrl);
  return NextResponse.json({
    backend,
    readsAvailable: available,
    ...(warning && { readsWarning: warning }),
    serviceUrl,
    storageBackend,
    storageLabel: available ? storageLabelFor(backend, storageBackend) : "Storage: audit-service unavailable",
  });
}
