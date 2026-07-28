import type {
  BootstrapSecretInput,
  BootstrapSecretResult,
  SecretService,
} from "./secret-service";
import type { CredentialSecretType } from "./types";

type Env = Record<string, string | undefined>;
type ConfiguredSecret = Record<string, unknown>;

const CONFIGURED_SECRETS_ENV = "CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON";
const SECRET_TYPES = new Set<CredentialSecretType>([
  "api_key",
  "basic_auth",
  "bearer_token",
  "custom",
]);

function envValue(env: Env, key: string): string | null {
  const candidate = env[key]?.trim();
  return candidate ? candidate : null;
}

function configuredString(
  secret: ConfiguredSecret,
  field: string,
  index: number,
  required = true,
): string | null {
  const candidate = secret[field];
  if (candidate === undefined || candidate === null || candidate === "") {
    if (required) throw new Error(`Credential secret at index ${index} requires ${field}`);
    return null;
  }
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`Credential secret at index ${index} has an invalid ${field}`);
  }
  return candidate.trim();
}

function configuredTeams(secret: ConfiguredSecret, index: number): string[] {
  const value = secret.sharedWithTeams;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Credential secret at index ${index} has invalid sharedWithTeams`);
  }
  return Array.from(new Set(value.map((team, teamIndex) => {
    if (typeof team !== "string" || !team.trim()) {
      throw new Error(
        `Credential secret at index ${index} has an invalid sharedWithTeams entry at index ${teamIndex}`,
      );
    }
    return team.trim();
  }))).sort();
}

export function buildSecretBootstrapInputs(env: Env = process.env): BootstrapSecretInput[] {
  const serialized = envValue(env, CONFIGURED_SECRETS_ENV);
  if (!serialized) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`${CONFIGURED_SECRETS_ENV} must contain valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${CONFIGURED_SECRETS_ENV} must contain a JSON array`);
  }

  const ids = new Set<string>();
  return parsed.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Credential secret at index ${index} must be an object`);
    }
    const secret = candidate as ConfiguredSecret;
    if ("value" in secret || "plaintext" in secret) {
      throw new Error(
        `Credential secret at index ${index} must use valueEnv; inline secret values are not allowed`,
      );
    }
    const id = configuredString(secret, "id", index)!;
    if (ids.has(id)) throw new Error(`Credential secret id ${id} is configured more than once`);
    ids.add(id);

    const type = configuredString(secret, "type", index)! as CredentialSecretType;
    if (!SECRET_TYPES.has(type)) {
      throw new Error(`Credential secret at index ${index} has unsupported type ${type}`);
    }
    const valueEnv = configuredString(secret, "valueEnv", index)!;
    const plaintext = envValue(env, valueEnv);
    if (!plaintext) {
      throw new Error(
        `Credential secret at index ${index} references missing environment variable ${valueEnv}`,
      );
    }
    const ownerCandidate = secret.owner;
    if (!ownerCandidate || typeof ownerCandidate !== "object" || Array.isArray(ownerCandidate)) {
      throw new Error(`Credential secret at index ${index} requires owner`);
    }
    const owner = ownerCandidate as ConfiguredSecret;
    const ownerType = configuredString(owner, "type", index)!;
    if (ownerType !== "team" && ownerType !== "user") {
      throw new Error(`Credential secret at index ${index} owner.type must be team or user`);
    }

    return {
      id,
      name: configuredString(secret, "name", index)!,
      type,
      plaintext,
      description: configuredString(secret, "description", index, false) ?? undefined,
      owner: {
        type: ownerType,
        id: configuredString(owner, "id", index)!,
      },
      sharedWithTeams: configuredTeams(secret, index),
    };
  });
}

export async function bootstrapSecretsFromEnv(options?: {
  env?: Env;
  service?: Pick<SecretService, "upsertBootstrapSecret">;
}): Promise<Record<BootstrapSecretResult, number>> {
  const env = options?.env ?? process.env;
  const inputs = buildSecretBootstrapInputs(env);
  const counts: Record<BootstrapSecretResult, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
  };
  if (inputs.length === 0) return counts;

  const service = options?.service ?? await (async () => {
    const { getCredentialSecretService } = await import("./secret-service-factory");
    return getCredentialSecretService();
  })();
  for (const input of inputs) {
    try {
      counts[await service.upsertBootstrapSecret(input)]++;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[credentials] Skipped secret bootstrap for ${input.id}: ${message}`);
    }
  }
  console.log(
    `[credentials] Secret bootstrap: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
  );
  return counts;
}
