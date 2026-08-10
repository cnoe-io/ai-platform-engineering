// assisted-by Codex Codex-sonnet-4-6

export interface ProviderConnectionDisplayInput {
  status?: string;
  expiresAt?: string | Date;
  updatedAt?: string | Date;
  connectedAt?: string | Date;
  // False ⇒ no refresh token; the connection is valid now but cannot silently
  // auto-renew and will need manual re-auth at expiry. Absent ⇒ assume it can
  // renew (legacy connections / providers that issue refresh tokens).
  renewable?: boolean;
  profileSummary?: string;
  owner?: {
    email?: string;
    name?: string;
    displayName?: string;
  };
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// Providers for which the API exposes a user-profile / token-validation
// endpoint (see api/credentials/connections/[connection_id]/profile/route.ts).
// The "Test connection" button is only meaningful for these; for any other
// provider (e.g. a custom MCP OAuth app like co2-dev) the route returns
// UNSUPPORTED_PROVIDER, which would surface as a spurious "Profile check
// failed". This is the single source of truth — the profile route imports it
// so the UI affordance and the API stay in lockstep.
export const PROFILE_CHECK_PROVIDERS = [
  "github",
  "atlassian",
  "webex",
  "pagerduty",
  "gitlab",
] as const;

export type ProfileCheckProvider = (typeof PROFILE_CHECK_PROVIDERS)[number];

const PROFILE_CHECK_PROVIDER_SET = new Set<string>(PROFILE_CHECK_PROVIDERS);

export function supportsProfileCheck(provider: string | undefined | null): boolean {
  return provider ? PROFILE_CHECK_PROVIDER_SET.has(provider) : false;
}

function toTimestamp(value: string | Date | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function describeProviderConnectionHealth(
  connection: ProviderConnectionDisplayInput | null | undefined,
): string {
  if (!connection) return "not linked";
  if (connection.status && connection.status !== "connected") return "relink required";
  if (!connection.expiresAt) return "healthy";
  const expiresAt = toTimestamp(connection.expiresAt);
  if (expiresAt === null) return "healthy";
  if (expiresAt <= Date.now()) return "expired";
  if (expiresAt - Date.now() <= FIFTEEN_MINUTES_MS) return "expiring soon";
  // A connection with no refresh token cannot auto-renew: it is fully usable
  // now but will lapse at expiry and require a manual reconnect. Surface that
  // distinctly from a self-renewing "healthy" connection. Keep the label short
  // so it fits on one line in the status pill.
  if (connection.renewable === false) return "no auto-renew";
  return "healthy";
}

/**
 * Human-readable countdown to expiry, e.g. "expires in 11h" / "expires in 3d".
 * Returns undefined when there is no expiry or it has already lapsed.
 */
export function formatExpiresInLabel(
  expiresAt: string | Date | undefined,
  now = Date.now(),
): string | undefined {
  const timestamp = toTimestamp(expiresAt);
  if (timestamp === null) return undefined;
  const deltaMs = timestamp - now;
  if (deltaMs <= 0) return undefined;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `expires in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `expires in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `expires in ${days}d`;
}

export function formatRelativeRefreshLabel(
  updatedAt: string | Date | undefined,
  now = Date.now(),
): string | undefined {
  const timestamp = toTimestamp(updatedAt);
  if (timestamp === null) return undefined;
  const deltaMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "refreshed just now";
  if (minutes < 60) return `refreshed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `refreshed ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `refreshed ${days}d ago`;
}

function ownerLabel(connection: ProviderConnectionDisplayInput): string | undefined {
  const owner = connection.owner;
  if (!owner) return undefined;
  return owner.displayName?.trim() || owner.name?.trim() || owner.email?.trim() || undefined;
}

export function formatProviderConnectionOptionLabel(
  connectorName: string,
  connection: ProviderConnectionDisplayInput,
): string {
  const health = describeProviderConnectionHealth(connection);
  const refresh = formatRelativeRefreshLabel(connection.updatedAt ?? connection.connectedAt);
  const account = connection.profileSummary?.trim() || ownerLabel(connection);

  return [connectorName, health, refresh, account].filter(Boolean).join(" · ");
}
