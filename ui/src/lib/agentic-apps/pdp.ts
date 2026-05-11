// assisted-by Codex Codex-sonnet-4-6

import { randomUUID } from "node:crypto";

import { evaluateAppAccess, type AgenticAppSessionLike } from "@/lib/agentic-apps/access";
import type {
  AgenticAppPdpDecisionRecord,
  AgenticAppPdpEffect,
  AgenticAppInstallationRecord,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

export type AgenticAppPdpRequest = {
  action: string;
  user: { email: string; name: string; role: string };
  session: AgenticAppSessionLike;
  pkg: AgenticAppPackageRecord | null;
  installation: AgenticAppInstallationRecord | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
  skipUserAccess?: boolean;
};

export type AgenticAppPdpDecision = {
  decisionId: string;
  effect: AgenticAppPdpEffect;
  reasonCode: string;
  scopes: string[];
  expiresAt: string;
  metadata?: Record<string, unknown>;
};

const DEFAULT_DECISION_TTL_SECONDS = 5 * 60;

export function decideAgenticAppPdp(input: AgenticAppPdpRequest): AgenticAppPdpDecision {
  const expiresAt = new Date(Date.now() + DEFAULT_DECISION_TTL_SECONDS * 1000).toISOString();
  const base = {
    decisionId: randomUUID(),
    expiresAt,
    metadata: input.metadata,
  };

  if (!input.pkg || !input.installation) {
    return { ...base, effect: "deny", reasonCode: "not_installed", scopes: [] };
  }

  const policyAction = input.pkg.manifest.access.policyActions?.find(
    (candidate) => candidate.action === input.action,
  );
  if (policyAction?.defaultEffect === "deny") {
    return { ...base, effect: "deny", reasonCode: policyAction.reasonCode ?? "policy_denied", scopes: [] };
  }

  if (!input.skipUserAccess) {
    const access = evaluateAppAccess({
      user: input.user,
      session: input.session,
      pkg: input.pkg,
      installation: input.installation,
    });
    if (!access.canLaunch) {
      return {
        ...base,
        effect: "deny",
        reasonCode: access.blockedReasons[0] ?? "policy_denied",
        scopes: [],
      };
    }
  }

  const declaredScopes = new Set(input.pkg.manifest.access.tokenScopes);
  const requestedScopes = input.scopes?.length ? input.scopes : input.pkg.manifest.access.tokenScopes;
  const scopes = requestedScopes.filter((scope) => declaredScopes.has(scope));
  return { ...base, effect: "allow", reasonCode: "allowed", scopes };
}

export function buildPdpDecisionRecord(input: {
  appId: string;
  userSubjectHash?: string;
  action: string;
  decision: AgenticAppPdpDecision;
  correlationId: string;
  route?: string;
  method?: string;
}): AgenticAppPdpDecisionRecord {
  return {
    decisionId: input.decision.decisionId,
    appId: input.appId,
    correlationId: input.correlationId,
    action: input.action,
    effect: input.decision.effect,
    reasonCode: input.decision.reasonCode,
    issuedAt: new Date().toISOString(),
    expiresAt: input.decision.expiresAt,
    ...(input.userSubjectHash !== undefined
      ? { subject: { subjectHash: input.userSubjectHash } }
      : {}),
    ...(input.route !== undefined ? { route: input.route } : {}),
    ...(input.method !== undefined ? { method: input.method } : {}),
    ...(input.decision.metadata !== undefined ? { safeMetadata: input.decision.metadata } : {}),
  };
}
