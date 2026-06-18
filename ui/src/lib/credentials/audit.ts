import { redactCredentialDetails } from "./masking";
import { getAuditBackend } from "@/lib/audit";

export type CredentialAuditResult = "denied" | "failure" | "success";

export interface CredentialAuditActor {
  type: "service" | "system" | "user";
  id: string;
}

export interface CredentialAuditResource {
  type: "provider_connection" | "secret_ref";
  id: string;
}

export interface CredentialAuditEventInput {
  action: string;
  actor: CredentialAuditActor;
  resource: CredentialAuditResource;
  result: CredentialAuditResult;
  details?: Record<string, unknown>;
  correlationId?: string;
}

export function writeCredentialAuditEvent(
  input: CredentialAuditEventInput,
): void {
  getAuditBackend().write({
    type: "credential_action",
    ts: new Date().toISOString(),
    action: input.action,
    actor: input.actor,
    resource: input.resource,
    result: input.result,
    correlationId: input.correlationId,
    details: input.details ? redactCredentialDetails(input.details) : {},
  });
}
