export function sanitizeLiteLlmModelInfo(payload) {
  const upstreamModels = Array.isArray(payload?.data) ? payload.data : [];
  const maxModels = 100;
  const models = upstreamModels.slice(0, maxModels).map((entry) => {
    const modelInfo = isRecord(entry?.model_info) ? entry.model_info : {};
    const parameters = isRecord(entry?.litellm_params) ? entry.litellm_params : {};

    return compactObject({
      name: safeString(entry?.model_name),
      id: safeString(modelInfo.id),
      provider: safeString(modelInfo.litellm_provider ?? parameters.custom_llm_provider),
      upstreamModel: safeString(parameters.model),
      mode: safeString(modelInfo.mode),
      supportsFunctionCalling: safeBoolean(modelInfo.supports_function_calling),
      supportsVision: safeBoolean(modelInfo.supports_vision),
    });
  });

  return {
    source: "litellm-model-info",
    totalModels: upstreamModels.length,
    returnedModels: models.length,
    truncated: upstreamModels.length > models.length,
    models,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
