// assisted-by claude code claude-sonnet-4-6

import type { Action, AuthorizeRequest, AuthorizeResult, GrantIntent, ResourceType, Subject } from "./contract";

export interface PolicyEngine {
  check(req: AuthorizeRequest): Promise<AuthorizeResult>;
  batchCheck(
    subject: Subject,
    action: Action,
    resourceType: ResourceType,
    ids: string[],
  ): Promise<Map<string, AuthorizeResult>>;
}

export interface PolicyAdmin {
  grant(intent: GrantIntent): Promise<void>;
  revoke(intent: GrantIntent): Promise<void>;
}
