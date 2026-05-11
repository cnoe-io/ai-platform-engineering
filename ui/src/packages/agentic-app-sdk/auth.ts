// assisted-by Codex Codex-sonnet-4-6

export type AppScopedTokenClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  app_id?: string;
  scope?: string;
  scp?: string[];
  decision_id?: string;
  correlation_id?: string;
  exp?: number;
  iat?: number;
  jti?: string;
  [key: string]: unknown;
};

export type AuthorizeAppResourceInput = {
  appId: string;
  action: string;
  scopes?: string[];
  resource?: Record<string, unknown>;
  correlationId?: string;
  fetcher?: typeof fetch;
};

export type AuthorizeAppResourceResult = {
  decisionId: string;
  correlationId: string;
  token: string;
  expiresAt: string;
  scopes: string[];
};

export function parseAppScopedTokenClaims(token: string): AppScopedTokenClaims {
  const [, payload] = token.split(".");
  if (!payload) {
    throw new Error("invalid app-scoped token format");
  }
  return JSON.parse(base64UrlDecode(payload)) as AppScopedTokenClaims;
}

export async function authorizeAppResource(
  input: AuthorizeAppResourceInput,
): Promise<AuthorizeAppResourceResult> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`/api/agentic-apps/${encodeURIComponent(input.appId)}/authorize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.correlationId ? { "x-correlation-id": input.correlationId } : {}),
    },
    body: JSON.stringify({
      action: input.action,
      scopes: input.scopes,
      resource: input.resource,
    }),
  });
  if (!response.ok) {
    throw new Error(`authorization failed: ${response.status}`);
  }
  return (await response.json()) as AuthorizeAppResourceResult;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  if (typeof atob === "function") {
    return atob(padded);
  }
  return Buffer.from(padded, "base64").toString("utf8");
}
