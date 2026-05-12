import type { RbacResource } from "./types";

interface DeniedFeedback {
  message: string;
  capability: string;
}

/**
 * Format a denied-action message for the Admin UI (toast/banner).
 * Does not expose internal policy details.
 */
export function formatUiDenial(
  resource: RbacResource,
  scope: string,
): DeniedFeedback {
  const action = humanReadableAction(resource, scope);
  return {
    message: `You do not have permission to ${action}. Contact your admin for access.`,
    capability: `${resource}#${scope}`,
  };
}

/**
 * Build a NextResponse JSON body for a 403 from the BFF.
 */
export function deniedApiResponse(resource: RbacResource, scope: string) {
  return {
    error: "access_denied",
    message: `You do not have permission to perform this action.`,
    capability: `${resource}#${scope}`,
  };
}

/**
 * Map resource#scope to a human-readable action phrase.
 */
function humanReadableAction(resource: RbacResource, scope: string): string {
  const labels: Record<string, string> = {
    "admin_ui#view": "view the admin dashboard",
    "admin_ui#configure": "change platform settings",
    "admin_ui#admin": "perform admin operations",
    "admin_ui#audit.view": "view audit logs",
    "rag#tool.create": "create RAG tools",
    "rag#tool.update": "update RAG tools",
    "rag#tool.delete": "delete RAG tools",
    "rag#kb.admin": "administer knowledge bases",
    "rag#kb.ingest": "ingest data",
    "rag#query": "query knowledge bases",
    "supervisor#invoke": "use the assistant",
    "tool#invoke": "invoke tools",
    "mcp#invoke": "invoke MCP tools",
    "skill#invoke": "execute skills",
    "a2a#create": "create agent tasks",
  };

  return labels[`${resource}#${scope}`] || `access ${resource} (${scope})`;
}
