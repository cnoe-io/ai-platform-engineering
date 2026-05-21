import { redactCredentialDetails } from "./masking";

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

interface AuditCollection {
  insertOne(document: Record<string, unknown>): Promise<unknown>;
}

export async function writeCredentialAuditEvent(
  collection: AuditCollection,
  input: CredentialAuditEventInput,
): Promise<void> {
  await collection.insertOne({
    action: input.action,
    actor: input.actor,
    resource: input.resource,
    result: input.result,
    correlationId: input.correlationId,
    details: input.details ? redactCredentialDetails(input.details) : {},
    createdAt: new Date(),
  });
}
