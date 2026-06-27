// assisted-by Codex Codex-sonnet-4-6

export interface ProviderConnectionDisplayInput {
  status?: string;
  expiresAt?: string | Date;
  updatedAt?: string | Date;
  connectedAt?: string | Date;
  profileSummary?: string;
  owner?: {
    email?: string;
    name?: string;
    displayName?: string;
  };
}

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

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
  return "healthy";
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
