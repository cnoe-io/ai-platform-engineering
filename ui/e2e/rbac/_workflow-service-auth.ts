import { expect, test, type APIRequestContext } from "@playwright/test";

export type WorkflowServiceAuthEnv = {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  globalWorkflowId: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function workflowServiceAuthEnvOrSkip(): WorkflowServiceAuthEnv {
  if (process.env.RUN_RBAC_E2E !== "1") {
    test.skip(true, "RUN_RBAC_E2E not set; skipping workflow service-auth live e2e.");
    return null as unknown as WorkflowServiceAuthEnv;
  }

  const baseUrl = optionalEnv("CAIPE_UI_BASE_URL");
  if (!baseUrl) {
    test.skip(true, "CAIPE_UI_BASE_URL is required for workflow service-auth live e2e.");
    return null as unknown as WorkflowServiceAuthEnv;
  }

  const keycloakUrl = optionalEnv("KEYCLOAK_URL") ?? "http://localhost:7080";
  const realm = optionalEnv("KEYCLOAK_REALM") ?? "caipe";

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    tokenUrl:
      optionalEnv("OAUTH2_TOKEN_URL") ??
      `${keycloakUrl.replace(/\/$/, "")}/realms/${realm}/protocol/openid-connect/token`,
    clientId: optionalEnv("OAUTH2_CLIENT_ID") ?? "caipe-platform",
    clientSecret: optionalEnv("OAUTH2_CLIENT_SECRET") ?? "caipe-platform-dev-secret",
    scope: optionalEnv("OAUTH2_SCOPE"),
    audience: optionalEnv("OAUTH2_AUDIENCE"),
    globalWorkflowId: optionalEnv("WORKFLOW_AGENT_OAUTH_TEST_GLOBAL_ID") ?? "wf-movie-guessing",
  };
}

export async function fetchWorkflowServiceToken(
  request: APIRequestContext,
  env: WorkflowServiceAuthEnv,
): Promise<string> {
  const form: Record<string, string> = {
    grant_type: "client_credentials",
    client_id: env.clientId,
    client_secret: env.clientSecret,
  };
  if (env.scope) form.scope = env.scope;
  if (env.audience) form.audience = env.audience;

  const response = await request.post(env.tokenUrl, {
    form,
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string };

  expect(response.ok(), JSON.stringify(body)).toBe(true);
  expect(body.access_token, JSON.stringify(body)).toEqual(expect.any(String));
  return body.access_token!;
}
