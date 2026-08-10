import type { CredentialKeyProvider } from "./key-wrapper";

export type CredentialContractHealthStatus = "degraded" | "healthy" | "unavailable";

export interface CredentialDependencyCheck {
  name: string;
  ok: boolean;
  reason?: string;
}

export interface CredentialDependencyHealth {
  feature_enabled: boolean;
  credential_store: CredentialContractHealthStatus;
  key_wrapper: CredentialContractHealthStatus;
  policy_service: CredentialContractHealthStatus;
  checks: CredentialDependencyCheck[];
}

export interface CredentialHealthConfig {
  enabled: boolean;
  keyProvider: CredentialKeyProvider;
  cmkId: string | null;
  nodeEnv?: string;
}

export interface CredentialDependencyHealthInput {
  config: CredentialHealthConfig;
  pingMongo: () => Promise<{ ok: boolean }>;
  pingPolicyService: () => Promise<{ ok: boolean }>;
}

export async function getCredentialDependencyHealth(
  input: CredentialDependencyHealthInput,
): Promise<CredentialDependencyHealth> {
  if (!input.config.enabled) {
    return {
      feature_enabled: false,
      credential_store: "degraded",
      key_wrapper: "degraded",
      policy_service: "degraded",
      checks: [],
    };
  }

  const checks: CredentialDependencyCheck[] = [];
  let credentialStore: CredentialContractHealthStatus = "healthy";
  let keyWrapper: CredentialContractHealthStatus = "healthy";
  let policyService: CredentialContractHealthStatus = "healthy";

  try {
    const mongo = await input.pingMongo();
    checks.push({
      name: "mongodb",
      ok: mongo.ok,
      reason: mongo.ok ? undefined : "mongodb_ping_failed",
    });
    if (!mongo.ok) {
      credentialStore = "unavailable";
    }
  } catch {
    checks.push({ name: "mongodb", ok: false, reason: "mongodb_ping_failed" });
    credentialStore = "unavailable";
  }

  if (input.config.keyProvider === "aws-kms") {
    const cmkCheck = input.config.cmkId
      ? { name: "kms-cmk", ok: true }
      : { name: "kms-cmk", ok: false, reason: "missing_cmk_id" };
    checks.push(cmkCheck);
    if (!cmkCheck.ok) {
      keyWrapper = "unavailable";
    }
  }

  if (input.config.keyProvider === "local-cmk") {
    const cmkCheck = input.config.cmkId
      ? { name: "local-cmk", ok: true }
      : { name: "local-cmk", ok: false, reason: "missing_local_cmk_id" };
    checks.push(cmkCheck);
    if (!cmkCheck.ok) {
      keyWrapper = "unavailable";
    }
  }

  if (input.config.keyProvider === "local-cmk" && input.config.nodeEnv === "production") {
    checks.push({
      name: "key-wrapper",
      ok: false,
      reason: "local_cmk_forbidden_in_production",
    });
    keyWrapper = "unavailable";
  }

  if (input.config.keyProvider === "dev-local" && input.config.nodeEnv === "production") {
    checks.push({
      name: "key-wrapper",
      ok: false,
      reason: "dev_local_forbidden_in_production",
    });
    keyWrapper = "unavailable";
  }

  try {
    const policy = await input.pingPolicyService();
    checks.push({
      name: "policy-service",
      ok: policy.ok,
      reason: policy.ok ? undefined : "policy_service_unavailable",
    });
    if (!policy.ok) {
      policyService = "unavailable";
    }
  } catch {
    checks.push({
      name: "policy-service",
      ok: false,
      reason: "policy_service_unavailable",
    });
    policyService = "unavailable";
  }

  return {
    feature_enabled: true,
    credential_store: credentialStore,
    key_wrapper: keyWrapper,
    policy_service: policyService,
    checks,
  };
}
