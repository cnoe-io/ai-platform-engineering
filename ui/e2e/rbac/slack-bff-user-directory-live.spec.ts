// assisted-by Codex Codex-sonnet-4-6

import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

type SlackBffEnv = {
  baseUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  audience?: string;
  userId: string;
  userEmail?: string;
  attributeName?: string;
  attributeValue?: string;
};

type ApiResult<T = unknown> = {
  status: number;
  body: T;
};

type ResolveBody = {
  success?: boolean;
  data?: null | {
    sub?: string;
    enabled?: boolean;
    attributes?: Record<string, string[]>;
    federatedIdentities?: Array<Record<string, unknown>>;
  };
  code?: string;
};

type IdentityProvidersBody = {
  success?: boolean;
  data?: {
    hasEnabledBroker?: boolean;
    identityProviders?: Array<{
      alias?: string;
      displayName?: string;
      providerId?: string;
      enabled?: boolean;
    }>;
  };
  code?: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireSlackBffEnvOrSkip(): SlackBffEnv {
  if (process.env.RUN_RBAC_E2E !== "1") {
    test.skip(true, "RUN_RBAC_E2E not set; skipping Slack BFF live e2e.");
    return null as unknown as SlackBffEnv;
  }

  const required = [
    "CAIPE_UI_BASE_URL",
    "SLACK_INTEGRATION_AUTH_TOKEN_URL",
    "SLACK_INTEGRATION_AUTH_CLIENT_ID",
    "SLACK_INTEGRATION_AUTH_CLIENT_SECRET",
    "SLACK_BFF_TEST_USER_ID",
  ] as const;
  const missing = required.filter((key) => !optionalEnv(key));
  if (missing.length > 0) {
    test.skip(
      true,
      `Slack BFF live e2e env vars missing: ${missing.join(", ")}`,
    );
    return null as unknown as SlackBffEnv;
  }

  return {
    baseUrl: optionalEnv("CAIPE_UI_BASE_URL")!.replace(/\/$/, ""),
    tokenUrl: optionalEnv("SLACK_INTEGRATION_AUTH_TOKEN_URL")!,
    clientId: optionalEnv("SLACK_INTEGRATION_AUTH_CLIENT_ID")!,
    clientSecret: optionalEnv("SLACK_INTEGRATION_AUTH_CLIENT_SECRET")!,
    scope: optionalEnv("SLACK_INTEGRATION_AUTH_SCOPE"),
    audience: optionalEnv("SLACK_INTEGRATION_AUTH_AUDIENCE"),
    userId: optionalEnv("SLACK_BFF_TEST_USER_ID")!,
    userEmail: optionalEnv("SLACK_BFF_TEST_USER_EMAIL"),
    attributeName: optionalEnv("SLACK_BFF_TEST_ATTRIBUTE_NAME"),
    attributeValue: optionalEnv("SLACK_BFF_TEST_ATTRIBUTE_VALUE"),
  };
}

async function fetchSlackBotToken(
  request: APIRequestContext,
  env: SlackBffEnv,
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
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
  };

  expect(response.ok(), JSON.stringify(body)).toBe(true);
  expect(body.access_token, JSON.stringify(body)).toEqual(expect.any(String));
  return body.access_token!;
}

async function getJson<T>(
  request: APIRequestContext,
  env: SlackBffEnv,
  path: string,
  token?: string,
): Promise<ApiResult<T>> {
  const response = await request.get(`${env.baseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      "X-Client-Source": "slack-bot",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }

  return { status: response.status(), body: body as T };
}

function resolvePath(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `/api/admin/users/resolve?${search.toString()}`;
}

test.describe("RBAC live e2e — Slack bot BFF user-directory contract", () => {
  let env: SlackBffEnv;
  let token: string;

  test.beforeAll(async ({ request }) => {
    env = requireSlackBffEnvOrSkip();
    token = await fetchSlackBotToken(request, env);
  });

  test("rejects unauthenticated Slack-source user-directory calls", async ({
    request,
  }) => {
    const result = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ id: env.userId }),
    );

    expect(result.status, JSON.stringify(result.body)).not.toBe(200);
    expect([401, 403], JSON.stringify(result.body)).toContain(result.status);
  });

  test("resolves a Keycloak user by id with federation metadata", async ({
    request,
  }) => {
    const result = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ id: env.userId }),
      token,
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toMatchObject({
      sub: env.userId,
      enabled: expect.any(Boolean),
      attributes: expect.any(Object),
      federatedIdentities: expect.any(Array),
    });
  });

  test("returns data:null for a missing id instead of leaking a 404", async ({
    request,
  }) => {
    const missingId = `playwright-missing-${randomUUID()}`;
    const result = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ id: missingId }),
      token,
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toEqual({ success: true, data: null });
  });

  test("keeps locator validation and attribute allowlist enforced after auth", async ({
    request,
  }) => {
    const ambiguous = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ id: env.userId, email: "someone@example.com" }),
      token,
    );
    expect(ambiguous.status, JSON.stringify(ambiguous.body)).toBe(400);
    expect(ambiguous.body.code).toBe("INVALID_QUERY");

    const disallowedAttribute = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ attribute: "email", value: "someone@example.com" }),
      token,
    );
    expect(disallowedAttribute.status, JSON.stringify(disallowedAttribute.body)).toBe(400);
    expect(disallowedAttribute.body.code).toBe("ATTRIBUTE_NOT_ALLOWED");
  });

  test("resolves by exact email when a fixture email is supplied", async ({
    request,
  }) => {
    test.skip(!env.userEmail, "SLACK_BFF_TEST_USER_EMAIL not set.");

    const result = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({ email: env.userEmail! }),
      token,
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data?.sub).toBe(env.userId);
  });

  test("resolves by allowed attribute when a fixture attribute is supplied", async ({
    request,
  }) => {
    test.skip(
      !env.attributeName || !env.attributeValue,
      "SLACK_BFF_TEST_ATTRIBUTE_NAME/VALUE not set.",
    );

    const result = await getJson<ResolveBody>(
      request,
      env,
      resolvePath({
        attribute: env.attributeName!,
        value: env.attributeValue!,
      }),
      token,
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data?.sub).toBe(env.userId);
  });

  test("summarizes realm identity providers for broker-aware Slack routing", async ({
    request,
  }) => {
    const result = await getJson<IdentityProvidersBody>(
      request,
      env,
      "/api/admin/realm/identity-providers",
      token,
    );

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data).toMatchObject({
      hasEnabledBroker: expect.any(Boolean),
      identityProviders: expect.any(Array),
    });

    for (const provider of result.body.data?.identityProviders ?? []) {
      expect(provider.alias).toEqual(expect.any(String));
      expect(provider.providerId).toEqual(expect.any(String));
      expect(provider.enabled).toEqual(expect.any(Boolean));
    }
  });
});
