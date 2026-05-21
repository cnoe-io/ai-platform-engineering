import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  withErrorHandler,
} from "@/lib/api-middleware";
import { oauthStateCookieName, parseOAuthStateCookie } from "@/lib/credentials/oauth-state";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

function cookieValue(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return value.join("=");
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

function completionPage(input: {
  providerKey: string;
  status: "success" | "error";
  title: string;
  message: string;
}): Response {
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
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root { color-scheme: dark light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #fafafa; }
      main { max-width: 28rem; padding: 2rem; text-align: center; }
      p { color: #a1a1aa; line-height: 1.5; }
      .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; margin-top: 1.5rem; }
      a, button { border: 0; border-radius: 0.5rem; background: #14b8a6; color: #042f2e; cursor: pointer; font-weight: 700; padding: 0.75rem 1rem; text-decoration: none; }
      a { background: #38bdf8; color: #082f49; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <p>${escapeHtml(input.message)}</p>
      <div class="actions">
        <a href="/credentials">Return to Connections</a>
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
  const { provider_key: providerKey } = await context!.params;
  const { session } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return completionPage({
      providerKey,
      status: "error",
      title: "Connection failed",
      message: `The provider returned an OAuth error: ${providerError}. You can close this window and try again.`,
    });
  }
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const stateCookie = cookieValue(request.headers, oauthStateCookieName(providerKey));
  if (!code || !state || !stateCookie) {
    throw new ApiError("OAuth callback is missing state or code", 400, "INVALID_OAUTH_CALLBACK");
  }
  const parsedState = parseOAuthStateCookie(stateCookie);
  if (
    parsedState.providerKey !== providerKey ||
    parsedState.ownerId !== ownerId ||
    parsedState.state !== state
  ) {
    throw new ApiError("Invalid OAuth state", 400, "INVALID_OAUTH_STATE");
  }

  const service = await getProviderConnectionService();
  try {
    await service.completeConnection({
      providerKey,
      owner: { type: "user", id: ownerId },
      code,
      codeVerifier: parsedState.codeVerifier,
    });
  } catch (error) {
    return completionPage({
      providerKey,
      status: "error",
      title: "Connection failed",
      message:
        error instanceof Error
          ? error.message
          : "The OAuth connection could not be completed. You can close this window and try again.",
    });
  }

  const response = completionPage({
    providerKey,
    status: "success",
    title: "Connection complete",
    message: "Your OAuth connection was saved. You can close this window.",
  });
  response.headers.set(
    "set-cookie",
    `${oauthStateCookieName(providerKey)}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  );
  return response;
});
