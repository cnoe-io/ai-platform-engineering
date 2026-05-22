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

  const state = randomOAuthValue(24);
  const codeVerifier = randomOAuthValue(48);
  const service = await getProviderConnectionService();
  const result = await service.startConnection({
    providerKey,
    owner: { type: "user", id: ownerId },
    state,
    codeChallenge: pkceChallenge(codeVerifier),
  });
  const requestUrl = new URL(request.url);
  const secureCookie = process.env.NODE_ENV === "production" || requestUrl.protocol === "https:";
  const cookie = `${oauthStateCookieName(providerKey)}=${createOAuthStateCookie({
      providerKey,
      ownerId,
      state,
      codeVerifier,
    })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureCookie ? "; Secure" : ""}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: result.authorizationUrl,
      "set-cookie": cookie,
    },
  });
});
