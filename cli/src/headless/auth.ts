/**
 * Headless credential resolver (T041).
 *
 * Priority order:
 *   1. --token <jwt> / CAIPE_TOKEN  (JWT pass-through — also accepts OIDC JWTs)
 *   2. CAIPE_API_KEY / settings.json auth.apiKey  (static API key)
 *   3. CAIPE_CLIENT_ID + CAIPE_CLIENT_SECRET  (Client Credentials exchange)
 */

import { readSettings, endpoints, getServerUrl } from "../platform/config.js";

export type CredentialType = "jwt" | "apikey" | "client_credentials";

export interface HeadlessCredentials {
  type: CredentialType;
  /** The Bearer token to use in Authorization: Bearer <token> */
  accessToken: string;
}

/**
 * Resolve headless credentials from environment / flags.
 * Returns null if no credential is available.
 *
 * @param tokenFlag   Value of --token flag (highest priority)
 * @param serverUrl   Used only for client_credentials flow
 */
export async function resolveHeadlessCredentials(
  tokenFlag?: string,
  serverUrl?: string,
): Promise<HeadlessCredentials | null> {
  // 1. --token flag or CAIPE_TOKEN env
  const jwt = tokenFlag ?? process.env["CAIPE_TOKEN"];
  if (jwt && jwt.trim() !== "") {
    return { type: "jwt", accessToken: jwt.trim() };
  }

  // 2. CAIPE_API_KEY or settings.json auth.apiKey
  const apiKey = process.env["CAIPE_API_KEY"] ?? readSettings().auth?.apiKey;
  if (apiKey && apiKey.trim() !== "") {
    return { type: "apikey", accessToken: apiKey.trim() };
  }

  // 3. Client Credentials (CAIPE_CLIENT_ID + CAIPE_CLIENT_SECRET)
  const clientId = process.env["CAIPE_CLIENT_ID"];
  const clientSecret = process.env["CAIPE_CLIENT_SECRET"];
  if (clientId && clientSecret) {
    const resolvedUrl = serverUrl ?? getServerUrl();
    const token = await clientCredentialsExchange(clientId, clientSecret, resolvedUrl);
    if (token) {
      return { type: "client_credentials", accessToken: token };
    }
  }

  return null;
}

async function clientCredentialsExchange(
  clientId: string,
  clientSecret: string,
  serverUrl: string,
): Promise<string | null> {
  const ep = endpoints(serverUrl);
  try {
    const res = await fetch(ep.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as Record<string, unknown>;
    const accessToken = body["access_token"];
    return typeof accessToken === "string" ? accessToken : null;
  } catch {
    return null;
  }
}
