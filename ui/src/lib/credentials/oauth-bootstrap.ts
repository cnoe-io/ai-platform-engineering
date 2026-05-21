import type { CreateConnectorInput, OAuthConnectorService } from "./oauth-service";
import { BUILT_IN_OAUTH_CONNECTORS } from "./built-in-oauth-connectors";

type Env = Record<string, string | undefined>;

interface BootstrapProviderEnv {
  provider: "github" | "atlassian" | "webex";
  clientIdEnv: string;
  clientSecretEnv: string;
  redirectUriEnv: string;
}

const PROVIDER_ENV: BootstrapProviderEnv[] = [
  {
    provider: "github",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
    redirectUriEnv: "GITHUB_REDIRECT_URI",
  },
  {
    provider: "atlassian",
    clientIdEnv: "CONFLUENCE_CLIENT_ID",
    clientSecretEnv: "CONFLUENCE_CLIENT_SECRET",
    redirectUriEnv: "CONFLUENCE_REDIRECT_URI",
  },
  {
    provider: "webex",
    clientIdEnv: "WEBEX_CLIENT_ID",
    clientSecretEnv: "WEBEX_CLIENT_SECRET",
    redirectUriEnv: "WEBEX_REDIRECT_URI",
  },
];

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function value(env: Env, key: string): string | null {
  const candidate = env[key]?.trim();
  return candidate ? candidate : null;
}

function canonicalCallbackBase(env: Env): string {
  return value(env, "NEXTAUTH_URL") ?? "http://localhost:3000";
}

function canonicalProviderCallback(provider: BootstrapProviderEnv["provider"], env: Env): string {
  return `${canonicalCallbackBase(env).replace(/\/$/, "")}/api/credentials/oauth/${provider}/callback`;
}

function normalizeRedirectUri(
  provider: BootstrapProviderEnv["provider"],
  redirectUri: string,
  env: Env,
): string {
  try {
    const url = new URL(redirectUri);
    const legacyLocalCallback =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3001" &&
      url.pathname === `/oauth/${provider}/callback`;

    if (legacyLocalCallback) {
      return canonicalProviderCallback(provider, env);
    }
  } catch {
    return redirectUri;
  }

  return redirectUri;
}

export function buildOAuthConnectorBootstrapInputs(env: Env = process.env): CreateConnectorInput[] {
  const inputs: CreateConnectorInput[] = [];
  for (const providerEnv of PROVIDER_ENV) {
    const descriptor = BUILT_IN_OAUTH_CONNECTORS.find(
      (candidate) => candidate.provider === providerEnv.provider,
    );
    const clientId = value(env, providerEnv.clientIdEnv);
    const clientSecret = value(env, providerEnv.clientSecretEnv);
    const redirectUri = value(env, providerEnv.redirectUriEnv);
    if (!descriptor || !clientId || !clientSecret || !redirectUri) {
      continue;
    }
    inputs.push({
      name: descriptor.name,
      provider: descriptor.provider,
      clientId,
      clientSecret,
      authorizationUrl: descriptor.authorizationUrl,
      tokenUrl: descriptor.tokenUrl,
      scopes: descriptor.scopes,
      redirectUri: normalizeRedirectUri(providerEnv.provider, redirectUri, env),
    });
  }
  return inputs;
}

export async function bootstrapOAuthConnectorsFromEnv(options?: {
  env?: Env;
  service?: Pick<OAuthConnectorService, "upsertConnector">;
}): Promise<number> {
  const env = options?.env ?? process.env;
  if (!enabled(env.CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS)) {
    return 0;
  }
  const inputs = buildOAuthConnectorBootstrapInputs(env);
  const service = options?.service ?? await (async () => {
    const { getOAuthConnectorService } = await import("./oauth-service-factory");
    return getOAuthConnectorService();
  })();
  let applied = 0;
  for (const input of inputs) {
    try {
      await service.upsertConnector(input);
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      console.error(`[credentials] Skipped OAuth connector bootstrap for ${input.provider}: ${message}`);
    }
  }
  if (applied > 0) {
    console.log(`[credentials] Bootstrapped ${applied} OAuth connector(s) from environment`);
  }
  return applied;
}
