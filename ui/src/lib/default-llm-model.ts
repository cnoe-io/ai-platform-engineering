/**
 * Derives a "default" LLM model entry from the same environment variables
 * the supervisor uses (LLM_PROVIDER + provider-specific model name vars).
 *
 * This lets the Custom Agent model picker reflect the LLM that is already
 * wired up in `.env` (including OpenAI-compatible proxies that front other
 * providers, e.g. an Anthropic Haiku model served via an OpenAI proxy),
 * with no extra MongoDB / app-config.yaml registration required.
 */

export interface DefaultLLMModel {
  model_id: string;
  name: string;
  provider: string;
  description: string;
}

/**
 * Map LLM_PROVIDER value to the env var that holds the model id, and to a
 * sensible fallback model id when that env var is unset.
 *
 * Provider strings match what dynamic_agents.models.DynamicAgentConfig
 * accepts (anthropic-claude, openai, azure-openai, aws-bedrock, ...) so
 * that LLMFactory(provider=...) on the runtime side instantiates the
 * correct client.
 */
const PROVIDER_MAP: Record<
  string,
  { modelEnvVar: string; fallbackModelId?: string }
> = {
  openai: { modelEnvVar: "OPENAI_MODEL_NAME", fallbackModelId: "gpt-4o" },
  "azure-openai": {
    modelEnvVar: "AZURE_OPENAI_DEPLOYMENT",
    fallbackModelId: "gpt-4o",
  },
  "aws-bedrock": { modelEnvVar: "AWS_BEDROCK_MODEL_ID" },
  "anthropic-claude": {
    modelEnvVar: "ANTHROPIC_MODEL_NAME",
    fallbackModelId: "claude-3-5-haiku-latest",
  },
};

const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1";

/**
 * Returns the supervisor's configured LLM as a model entry suitable for the
 * Custom Agent picker, or `null` if `LLM_PROVIDER` is unset / unrecognised
 * and no fallback is available.
 */
export function getDefaultLLMModelFromEnv(): DefaultLLMModel | null {
  const rawProvider = process.env.LLM_PROVIDER;
  if (!rawProvider) return null;

  const provider = rawProvider.trim().toLowerCase();
  const entry = PROVIDER_MAP[provider];
  if (!entry) return null;

  const envModelId = process.env[entry.modelEnvVar]?.trim();
  const modelId = envModelId || entry.fallbackModelId;
  if (!modelId) {
    return null;
  }

  let description = `Auto-derived from LLM_PROVIDER=${provider} (${entry.modelEnvVar}).`;

  if (provider === "openai") {
    const endpoint = process.env.OPENAI_ENDPOINT?.trim();
    if (endpoint && endpoint !== DEFAULT_OPENAI_ENDPOINT) {
      description += ` Routed via OPENAI_ENDPOINT=${endpoint}.`;
    }
  } else if (provider === "azure-openai") {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    if (endpoint) {
      description += ` Endpoint: ${endpoint}.`;
    }
  } else if (provider === "aws-bedrock") {
    const region = process.env.AWS_REGION?.trim();
    if (region) {
      description += ` Region: ${region}.`;
    }
  }

  return {
    model_id: modelId,
    name: `${modelId} (Default supervisor LLM)`,
    provider,
    description,
  };
}
