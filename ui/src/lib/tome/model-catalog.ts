/**
 * Curated model ids for the model-config admin picker. A UI convenience
 * only — `model-config-store.ts` accepts and persists any non-empty string,
 * so an admin can always fall through to "Custom" for an id not listed here
 * (e.g. a different LiteLLM/proxy route). Deployments can use the custom
 * option when their gateway exposes different identifiers.
 *
 * No client/server split needed here (no Mongo import) — safe to import from
 * both the admin UI component and server routes.
 */

export const MODEL_PROFILE_VERSION = 1;

// Capacity values follow the published provider limits. Capability ranks are a
// TOME policy used only to select a strictly stronger judge; bump the profile
// version whenever either the limits or ordering changes.

export interface TomeModelProfile {
  id: string;
  capability_rank: number;
  context_window_tokens: number;
  max_output_tokens: number;
  supports_structured_output: boolean;
  profile_version: typeof MODEL_PROFILE_VERSION;
}

export const MODEL_PROFILES: readonly TomeModelProfile[] = [
  {
    id: "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
    capability_rank: 100,
    context_window_tokens: 200_000,
    max_output_tokens: 64_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-sonnet-4-20250514-v1:0",
    capability_rank: 190,
    context_window_tokens: 200_000,
    max_output_tokens: 64_000,
    supports_structured_output: false,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
    capability_rank: 200,
    context_window_tokens: 200_000,
    max_output_tokens: 64_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-sonnet-4-6",
    capability_rank: 210,
    context_window_tokens: 1_000_000,
    max_output_tokens: 64_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-sonnet-5",
    capability_rank: 220,
    context_window_tokens: 1_000_000,
    max_output_tokens: 128_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-opus-4-8",
    capability_rank: 310,
    context_window_tokens: 1_000_000,
    max_output_tokens: 128_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
  {
    id: "bedrock/global.anthropic.claude-opus-5",
    capability_rank: 320,
    context_window_tokens: 1_000_000,
    max_output_tokens: 128_000,
    supports_structured_output: true,
    profile_version: MODEL_PROFILE_VERSION,
  },
];

export const MODEL_CATALOG: string[] = [
  "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "bedrock/global.anthropic.claude-sonnet-4-6",
  "bedrock/global.anthropic.claude-sonnet-5",
  "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "bedrock/global.anthropic.claude-sonnet-4-20250514-v1:0",
  "bedrock/global.anthropic.claude-opus-4-8",
  "bedrock/global.anthropic.claude-opus-5",
];

const PROFILE_BY_ID = new Map(MODEL_PROFILES.map((profile) => [profile.id, profile]));

/** Sentinel select value meaning "not one of the curated ids — show the raw text field". */
export const CUSTOM_MODEL_VALUE = "__custom__";

export function isCatalogModel(id: string): boolean {
  return PROFILE_BY_ID.has(id);
}

export function modelProfile(id: string): TomeModelProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

export function upperBoundEvaluatorError(
  modelA: string,
  modelB: string,
  evaluatorModel: string,
): string | null {
  const candidates = [modelProfile(modelA), modelProfile(modelB)];
  if (candidates.some((profile) => !profile)) {
    return "Candidate models must have verified TOME capability profiles.";
  }
  const evaluator = modelProfile(evaluatorModel);
  if (!evaluator) return "The evaluator must have a verified TOME capability profile.";
  if ([modelA, modelB].includes(evaluatorModel)) {
    return "The evaluator must be independent from both candidate models.";
  }
  if (!evaluator.supports_structured_output) {
    return "The evaluator must support schema-constrained output.";
  }
  const candidateUpperBound = Math.max(...candidates.map((profile) => profile!.capability_rank));
  if (evaluator.capability_rank <= candidateUpperBound) {
    return "The evaluator must be strictly more capable than the strongest candidate.";
  }
  return null;
}

export function recommendedUpperBoundEvaluator(modelA: string, modelB: string): string | null {
  const candidates = [modelProfile(modelA), modelProfile(modelB)];
  if (candidates.some((profile) => !profile)) return null;
  const candidateUpperBound = Math.max(...candidates.map((profile) => profile!.capability_rank));
  return [...MODEL_PROFILES]
    .filter((profile) => profile.supports_structured_output)
    .filter((profile) => ![modelA, modelB].includes(profile.id))
    .filter((profile) => profile.capability_rank > candidateUpperBound)
    .sort((left, right) => left.capability_rank - right.capability_rank)[0]?.id ?? null;
}
