import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  createOAuthStateCookie,
  oauthStateCookieName,
  pkceChallenge,
  randomOAuthValue,
} from "@/lib/credentials/oauth-state";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const GET = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ provider_key: string }> }) => {
  assertFeatureEnabled();
  const { provider_key: providerKey } = await context!.params;
  const { session } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const requestUrl = new URL(request.url);
  // Optional per-user scope selection (advanced settings). Accept either a
  // single comma/space-delimited `?scopes=` or repeated `?scope=` params.
  // Absent ⇒ connector default (legacy behavior).
  const scopesParam = requestUrl.searchParams.getAll("scope");
  const scopesCsv = requestUrl.searchParams.get("scopes");
  if (scopesCsv) {
    scopesParam.push(...scopesCsv.split(/[\s,]+/));
  }
  const requestedScopes =
    scopesParam.length > 0
      ? scopesParam.map((scope) => scope.trim()).filter(Boolean)
      : undefined;

  const state = randomOAuthValue(24);
  const codeVerifier = randomOAuthValue(48);
  const service = await getProviderConnectionService();
  const result = await service.startConnection({
    providerKey,
    owner: { type: "user", id: ownerId },
    state,
    codeChallenge: pkceChallenge(codeVerifier),
    requestedScopes,
  });
  const secureCookie = process.env.NODE_ENV === "production" || requestUrl.protocol === "https:";
  const cookie = `${oauthStateCookieName(providerKey)}=${createOAuthStateCookie({
      providerKey,
      ownerId,
      state,
      codeVerifier,
      // Persist the choice only when the user explicitly selected scopes, so
      // the callback records requestedScopes and relink can pre-fill them.
      requestedScopes: requestedScopes ? result.requestedScopes : undefined,
    })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureCookie ? "; Secure" : ""}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: result.authorizationUrl,
      "set-cookie": cookie,
    },
  });
});
