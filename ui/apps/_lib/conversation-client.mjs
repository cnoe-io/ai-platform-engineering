export const agenticAppConversationClientSource = String.raw`
async function readAgenticAppJsonResponse(response, fallbackMessage) {
  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(fallbackMessage + " (invalid JSON response)");
    }
  }

  if (!response.ok || payload.success === false) {
    const message = payload.error || payload.message || fallbackMessage;
    const code = payload.code ? " [" + payload.code + "]" : "";
    throw new Error(message + code);
  }

  return payload;
}

function requiredAgenticAppText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(label + " is required");
  return normalized;
}

async function createAgenticAppConversation({ agentId, appId, title, metadata = {} }) {
  const normalizedAgentId = requiredAgenticAppText(agentId, "agentId");
  const normalizedAppId = requiredAgenticAppText(appId, "appId");
  const normalizedTitle = String(title || normalizedAppId + " dashboard").trim().slice(0, 120);
  const response = await fetch("/api/chat/conversations", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      title: normalizedTitle,
      client_type: "webui",
      agent_id: normalizedAgentId,
      metadata: { ...metadata, source: "agentic-app", appId: normalizedAppId },
      tags: ["agentic-app", normalizedAppId],
    }),
  });
  const payload = await readAgenticAppJsonResponse(response, "Could not create dashboard conversation");
  const conversationId = payload.data?.conversation?._id || payload.conversation?._id;
  if (!conversationId) {
    throw new Error("Conversation creation returned no conversation ID");
  }
  return conversationId;
}

async function invokeAgenticApp({ agentId, appId, title, message, clientContext = {} }) {
  const normalizedAgentId = requiredAgenticAppText(agentId, "agentId");
  const normalizedAppId = requiredAgenticAppText(appId, "appId");
  const conversationId = await createAgenticAppConversation({
    agentId: normalizedAgentId,
    appId: normalizedAppId,
    title,
    metadata: { dashboardKind: clientContext.dashboardKind },
  });
  const response = await fetch("/api/v1/chat/invoke", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      agent_id: normalizedAgentId,
      message,
      conversation_id: conversationId,
      client_context: { ...clientContext, source: "agentic-app", appId: normalizedAppId },
    }),
  });
  return readAgenticAppJsonResponse(response, "Dashboard agent invocation failed");
}
`;

export function renderAgenticAppConversationClient() {
  return `<script>${agenticAppConversationClientSource}</script>`;
}
