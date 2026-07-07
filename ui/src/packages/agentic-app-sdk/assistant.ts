// assisted-by Codex Codex-sonnet-4-6

export const ASSISTANT_CONTEXT_MESSAGE_TYPE = "caipe.agenticApp.context.v1";
export const ASSISTANT_CONTEXT_SCHEMA_VERSION = "1.0";

export type AssistantContextPayload = {
  route: string;
  title?: string;
  summary?: string;
  selection?: string;
  resourceRefs?: Array<Record<string, string>>;
  suggestedPrompts?: string[];
};

export type PublishAssistantContextInput = {
  appId: string;
  context: AssistantContextPayload;
  targetOrigin?: string;
  targetWindow?: Pick<Window, "postMessage">;
};

export function publishAssistantContext(input: PublishAssistantContextInput): void {
  validateAssistantContextInput(input);
  const target = input.targetWindow ?? window.parent;
  target.postMessage(
    {
      type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
      version: ASSISTANT_CONTEXT_SCHEMA_VERSION,
      appId: input.appId,
      context: input.context,
    },
    input.targetOrigin ?? "*",
  );
}

export function clearAssistantContext(input: {
  appId: string;
  targetOrigin?: string;
  targetWindow?: Pick<Window, "postMessage">;
}): void {
  const target = input.targetWindow ?? window.parent;
  target.postMessage(
    {
      type: ASSISTANT_CONTEXT_MESSAGE_TYPE,
      version: ASSISTANT_CONTEXT_SCHEMA_VERSION,
      appId: input.appId,
      context: { route: "/", title: "Context cleared", summary: "" },
    },
    input.targetOrigin ?? "*",
  );
}

export function validateAssistantContextInput(input: PublishAssistantContextInput): void {
  if (!input.appId || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(input.appId)) {
    throw new Error("appId must be a valid Agentic App id");
  }
  if (!input.context || typeof input.context.route !== "string" || !input.context.route.startsWith("/")) {
    throw new Error("context.route must start with /");
  }
  if (
    input.context.suggestedPrompts !== undefined &&
    !input.context.suggestedPrompts.every((prompt) => typeof prompt === "string")
  ) {
    throw new Error("context.suggestedPrompts must be strings");
  }
}
