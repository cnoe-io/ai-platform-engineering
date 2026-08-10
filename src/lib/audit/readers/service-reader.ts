/**
 * AuditReader implementation backed by the lightweight audit service.
 */

import type { AuditQueryOptions, AuditReader } from "../reader";

export class ServiceReader implements AuditReader {
  readonly backendName = "service";
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async query(opts: AuditQueryOptions = {}): Promise<Record<string, unknown>[]> {
    const limit = opts.limit ?? 1000;
    const until = opts.until ?? new Date();
    const since = opts.since ?? new Date(until.getTime() - 24 * 60 * 60 * 1000);
    const controller =
      typeof AbortController !== "undefined" && opts.timeoutMs && opts.timeoutMs > 0
        ? new AbortController()
        : undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (controller && opts.timeoutMs) {
      // assisted-by Codex Codex-sonnet-4-6
      timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
      if (timeout.unref) timeout.unref();
    }

    const params = new URLSearchParams({
      since: since.toISOString(),
      until: until.toISOString(),
      limit: String(limit),
    });
    if (opts.type) params.set("type", opts.type);
    if (opts.outcome) params.set("outcome", opts.outcome);
    if (opts.component) params.set("component", opts.component);
    if (opts.correlationId) params.set("correlation_id", opts.correlationId);
    if (opts.tenantId) params.set("tenant_id", opts.tenantId);
    if (opts.source) params.set("source", opts.source);
    if (opts.action) params.set("action", opts.action);
    if (opts.capability) params.set("capability", opts.capability);
    if (opts.resourceRef) params.set("resource_ref", opts.resourceRef);
    if (opts.subjectHash) params.set("subject_hash", opts.subjectHash);
    if (opts.reasonCode) params.set("reason_code", opts.reasonCode);
    if (opts.agentName) params.set("agent_name", opts.agentName);
    if (opts.toolName) params.set("tool_name", opts.toolName);
    if (opts.userEmail) params.set("user_email", opts.userEmail);

    try {
      const response = await fetch(`${this.baseUrl}/v1/audit/events?${params.toString()}`, {
        cache: "no-store",
        signal: controller?.signal,
      });
      if (!response.ok) {
        throw new Error(`audit-service returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as { records?: Record<string, unknown>[] };
      return body.records ?? [];
    } catch (err) {
      console.warn("[audit/service-reader] query error:", err);
      return [];
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
