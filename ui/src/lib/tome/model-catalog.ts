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

export const MODEL_CATALOG: string[] = [
  "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "bedrock/global.anthropic.claude-sonnet-4-6",
  "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "bedrock/global.anthropic.claude-sonnet-4-20250514-v1:0",
  "bedrock/global.anthropic.claude-opus-4-8",
];

/** Sentinel select value meaning "not one of the curated ids — show the raw text field". */
export const CUSTOM_MODEL_VALUE = "__custom__";

export function isCatalogModel(id: string): boolean {
  return MODEL_CATALOG.includes(id);
}
