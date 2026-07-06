import { NextRequest } from "next/server";

import {
ApiError,
getAuthFromBearerOrSession,
withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import {
  oauthStateCookieName,
  parseOAuthStateCookie,
  type OAuthStatePayload,
} from "@/lib/credentials/oauth-state";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

function resolveCallbackState(
  headers: Headers,
  callbackProviderKey: string,
  state: string,
): { providerKey: string; parsedState: OAuthStatePayload } | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  const directCookieName = oauthStateCookieName(callbackProviderKey);
  const candidates = cookie
    .split(";")
    .map((part) => {
      const [name, ...rawValue] = part.trim().split("=");
      return { name, value: rawValue.join("=") };
    })
    .filter(({ name, value }) => name.startsWith("caipe_oauth_state_") && Boolean(value))
    .sort((left, right) => Number(right.name === directCookieName) - Number(left.name === directCookieName));

  for (const candidate of candidates) {
    try {
      const parsedState = parseOAuthStateCookie(candidate.value);
      if (parsedState.state === state) {
        return { providerKey: parsedState.providerKey, parsedState };
      }
    } catch {
      // Ignore stale or invalid state cookies and continue looking for the
      // signed state that matches this callback response.
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const PROVIDER_BRANDING: Record<string, { name: string }> = {
  atlassian: { name: "Atlassian" },
  gitlab: { name: "GitLab" },
  github: { name: "GitHub" },
  pagerduty: { name: "PagerDuty" },
  webex: { name: "Webex" },
};

function providerBranding(providerKey: string): { name: string } {
  return PROVIDER_BRANDING[providerKey] ?? {
    name: providerKey
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "OAuth provider",
  };
}

function completionPage(input: {
  providerKey: string;
  status: "success" | "error";
  title: string;
  message: string;
}): Response {
  const provider = providerBranding(input.providerKey);
  const flowTitle =
    input.status === "success"
      ? `${provider.name} connected`
      : `${provider.name} connection failed`;
  const logoMarkup = `<img class="brand-logo" src="/grid-neon-logo.svg" alt="CAIPE / Grid logo" />`;
  const message = {
    type: "caipe.oauth.connection",
    provider: input.providerKey,
    status: input.status,
  };
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${flowTitle} - ${input.title}`)}</title>
    <style>
      :root { color-scheme: dark light; }
      * { box-sizing: border-box; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 50% 0%, rgba(20,184,166,0.18), transparent 28rem), #09090b; color: #fafafa; }
      main { width: min(28rem, calc(100vw - 2rem)); padding: 2.25rem; text-align: center; border: 1px solid rgba(148,163,184,0.16); border-radius: 1.25rem; background: rgba(15,23,42,0.76); box-shadow: 0 2rem 5rem rgba(0,0,0,0.32); }
      .brand-logo { width: 3.25rem; height: 3.25rem; object-fit: contain; display: inline-grid; place-items: center; margin-bottom: 1.25rem; border-radius: 0.95rem; background: rgba(2,6,23,0.72); padding: 0.45rem; box-shadow: inset 0 0 0 1px rgba(94,234,212,0.14); }
      h1 { margin: 0; font-size: clamp(1.9rem, 6vw, 2.65rem); line-height: 1; letter-spacing: -0.055em; }
      p { margin: 1rem auto 0; max-width: 22rem; color: #cbd5e1; line-height: 1.55; }
      .actions { display: flex; justify-content: center; margin-top: 1.5rem; }
      button { border: 0; border-radius: 0.75rem; background: #14b8a6; color: #042f2e; cursor: pointer; font-weight: 800; padding: 0.8rem 1.25rem; text-decoration: none; min-width: 10rem; }
    </style>
  </head>
  <body>
    <main>
      ${logoMarkup}
      <h1>${escapeHtml(flowTitle)}</h1>
      <p>${escapeHtml(input.message)}</p>
      <div class="actions">
        <button id="close-window" type="button">Close window</button>
      </div>
    </main>
    <script>
      const message = ${scriptJson(message)};
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("caipe.oauth.connection");
        channel.postMessage(message);
        channel.close();
      }
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, window.location.origin);
        if (message.status === "success") {
          window.setTimeout(() => window.close(), 750);
        }
      }
      document.getElementById("close-window")?.addEventListener("click", () => window.close());
    </script>
  </body>
</html>`;
  return new Response(html, {
    status: input.status === "success" ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const GET = withErrorHandler(async (request: NextRequest, context?: { params: Promise<{ provider_key: string }> }) => {
  assertFeatureEnabled();
  const { provider_key: callbackProviderKey } = await context!.params;
  const { session, user } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    const provider = providerBranding(callbackProviderKey);
    return completionPage({
      providerKey: callbackProviderKey,
      status: "error",
      title: "Connection failed",
      message: `${provider.name} returned ${providerError}. You can close this window.`,
    });
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) {
    throw new ApiError("OAuth callback is missing state or code", 400, "INVALID_OAUTH_CALLBACK");
  }
  const resolvedState = resolveCallbackState(request.headers, callbackProviderKey, state);
  if (!resolvedState) {
    throw new ApiError("OAuth callback is missing state or code", 400, "INVALID_OAUTH_CALLBACK");
  }
  const { providerKey, parsedState } = resolvedState;
  if (
    parsedState.ownerId !== ownerId ||
    parsedState.state !== state
  ) {
    throw new ApiError("Invalid OAuth state", 400, "INVALID_OAUTH_STATE");
  }

  const service = await getProviderConnectionService();
  try {
    await service.completeConnection({
      providerKey,
      owner: {
        type: "user",
        id: ownerId,
        ...(user?.email ? { email: user.email } : {}),
        ...(user?.name ? { name: user.name } : {}),
      },
      code,
      codeVerifier: parsedState.codeVerifier,
      requestedScopes: parsedState.requestedScopes,
    });
  } catch (error) {
    return completionPage({
      providerKey,
      status: "error",
      title: "Connection failed",
      message:
        error instanceof Error
          ? error.message
          : "The OAuth connection could not be completed. Just close this window.",
    });
  }

  const response = completionPage({
    providerKey,
    status: "success",
    title: "Connection complete",
    message: "You can close this window.",
  });
  response.headers.set(
    "set-cookie",
    `${oauthStateCookieName(providerKey)}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  );
  return response;
});
