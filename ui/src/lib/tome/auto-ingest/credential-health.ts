import type { ProviderConnectionMetadata } from "@/lib/credentials/oauth-service";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCollection } from "@/lib/mongodb";
import {
  dataStewardLabel,
  type AutoIngestCredentialOwner,
  type ProjectDocument,
} from "@/types/projects";

export const AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION =
  "tome_auto_ingest_credential_health";
export const AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.TOME_AUTO_INGEST_CREDENTIAL_REFRESH_MS) || 5 * 60 * 1000,
);

export const AUTO_INGEST_PROVIDERS = ["github", "atlassian", "webex"] as const;
export type AutoIngestProvider = (typeof AUTO_INGEST_PROVIDERS)[number];

export type AutoIngestCredentialStatus =
  | "healthy"
  | "expiring"
  | "expired"
  | "missing"
  | "needs_reauth"
  | "refresh_failed"
  | "non_renewable"
  | "pending"
  | "no_owner"
  | "no_sources";

interface AutoIngestCredentialHealthDocument {
  _id: string;
  owner_subject: string;
  owner_email: string;
  owner_name: string;
  provider: AutoIngestProvider;
  connection_id?: string;
  status: Exclude<
    AutoIngestCredentialStatus,
    "pending" | "no_owner" | "no_sources"
  >;
  renewable?: boolean;
  expires_at?: Date;
  last_attempt_at: Date;
  last_success_at?: Date;
  detail?: string;
}

export interface AutoIngestCredentialHealthRow {
  projectId: string;
  projectSlug: string;
  projectTitle: string;
  dataSteward: string;
  dataStewardType: "user" | "team" | "legacy" | "unassigned";
  credentialOwner: {
    email: string;
    name: string;
  } | null;
  provider: AutoIngestProvider | null;
  status: AutoIngestCredentialStatus;
  renewable?: boolean;
  expiresAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  detail: string;
}

export interface AutoIngestCredentialHealthSnapshot {
  generatedAt: string;
  refreshIntervalMs: number;
  rows: AutoIngestCredentialHealthRow[];
  summary: {
    projects: number;
    healthy: number;
    attention: number;
    missing: number;
  };
}

type AutoIngestProject = ProjectDocument & { _id: string };

const EXPIRING_WINDOW_MS = 15 * 60 * 1000;

function healthId(ownerSubject: string, provider: AutoIngestProvider): string {
  return `${provider}:${ownerSubject}`;
}

function asDate(value: Date | string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 240) || "Token refresh failed";
}

function stewardType(project: ProjectDocument): AutoIngestCredentialHealthRow["dataStewardType"] {
  if (!project.data_steward) return "unassigned";
  if (typeof project.data_steward === "string") return "legacy";
  return project.data_steward.type;
}

/** Providers whose credentials this project's configured sources consume. */
export function requiredAutoIngestProviders(project: ProjectDocument): AutoIngestProvider[] {
  const sources = project.sources;
  if (!sources) return [];
  const providers: AutoIngestProvider[] = [];
  if ((sources.github_repos?.length ?? 0) > 0 || (sources.repos?.length ?? 0) > 0) {
    providers.push("github");
  }
  if (
    Boolean(sources.confluence_url?.trim()) ||
    (sources.confluence_spaces?.length ?? 0) > 0 ||
    (sources.confluence_page_scopes?.length ?? 0) > 0 ||
    Boolean(sources.confluence_page_scope)
  ) {
    providers.push("atlassian");
  }
  if ((sources.webex_rooms?.length ?? 0) > 0) providers.push("webex");
  return providers;
}

async function loadEnabledProjects(): Promise<AutoIngestProject[]> {
  const col = await getCollection<ProjectDocument>("projects");
  const projects = await col.find({ "autoIngest.enabled": true }).toArray();
  return projects.map((project) => ({ ...project, _id: String(project._id) }));
}

function connectionForProvider(
  connections: ProviderConnectionMetadata[],
  provider: AutoIngestProvider,
): ProviderConnectionMetadata | undefined {
  return connections.find(
    (connection) =>
      connection.provider === provider &&
      (connection.status === "connected" || connection.status === "needs_reauth"),
  );
}

function classifySuccessfulRefresh(
  connection: ProviderConnectionMetadata,
  expiresIn: number | undefined,
  refreshFailed: boolean,
  now: Date,
): Pick<AutoIngestCredentialHealthDocument, "status" | "expires_at" | "detail"> {
  const expiresAt =
    expiresIn !== undefined
      ? new Date(now.getTime() + Math.max(0, expiresIn) * 1000)
      : asDate(connection.expiresAt);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return {
      status: "expired",
      expires_at: expiresAt,
      detail: "Token expired. The credential owner must reconnect this provider.",
    };
  }
  if (refreshFailed) {
    return {
      status: "refresh_failed",
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      detail: "Automatic refresh failed. The current token is still available, but the credential owner should reconnect this provider.",
    };
  }
  if (connection.renewable === false) {
    return {
      status: "non_renewable",
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      detail: "Token is available but cannot be refreshed automatically.",
    };
  }
  if (expiresAt && expiresAt.getTime() - now.getTime() <= EXPIRING_WINDOW_MS) {
    return {
      status: "expiring",
      expires_at: expiresAt,
      detail: "Token is close to expiry; the next refresh window will retry it.",
    };
  }
  return {
    status: "healthy",
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    detail: "Token is available for scheduled ingestion.",
  };
}

async function writeHealth(
  document: AutoIngestCredentialHealthDocument,
): Promise<void> {
  const col = await getCollection<AutoIngestCredentialHealthDocument>(
    AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION,
  );
  const { _id, ...fields } = document;
  const setFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const unsetFields: Record<string, ""> = {};
  for (const field of ["connection_id", "renewable", "expires_at"] as const) {
    if (fields[field] === undefined) unsetFields[field] = "";
  }
  await col.updateOne(
    { _id },
    {
      $set: setFields,
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
      $setOnInsert: { _id },
    },
    { upsert: true },
  );
}

/**
 * Refresh every provider token actually used by an enabled auto-ingest
 * project. One owner/provider is refreshed once even when shared by projects.
 * Failures are persisted per provider and do not stop other owners/providers.
 */
export async function refreshAutoIngestCredentialHealth(
  now: Date = new Date(),
  suppliedProjects?: AutoIngestProject[],
): Promise<void> {
  const projects = suppliedProjects ?? (await loadEnabledProjects());
  const owners = new Map<
    string,
    { owner: AutoIngestCredentialOwner; providers: Set<AutoIngestProvider> }
  >();
  for (const project of projects) {
    const owner = project.autoIngest?.credentialOwner;
    if (!owner) continue;
    const entry = owners.get(owner.subject) ?? { owner, providers: new Set() };
    requiredAutoIngestProviders(project).forEach((provider) => entry.providers.add(provider));
    owners.set(owner.subject, entry);
  }

  const activeIds: string[] = [];
  if (![...owners.values()].some(({ providers }) => providers.size > 0)) {
    const health = await getCollection<AutoIngestCredentialHealthDocument>(
      AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION,
    );
    await health.deleteMany({ _id: { $nin: activeIds } });
    return;
  }
  const service = await getProviderConnectionService();
  for (const { owner, providers } of owners.values()) {
    let connections: ProviderConnectionMetadata[] = [];
    let listError: unknown;
    try {
      connections = await service.listConnections(
        { type: "user", id: owner.subject, email: owner.email, name: owner.name },
        { includeDisabled: true },
      );
    } catch (error) {
      listError = error;
    }

    for (const provider of providers) {
      const _id = healthId(owner.subject, provider);
      activeIds.push(_id);
      const base = {
        _id,
        owner_subject: owner.subject,
        owner_email: owner.email,
        owner_name: owner.name,
        provider,
        last_attempt_at: now,
      };
      if (listError) {
        await writeHealth({
          ...base,
          status: "refresh_failed",
          detail: safeError(listError),
        });
        continue;
      }
      const connection = connectionForProvider(connections, provider);
      if (!connection) {
        await writeHealth({
          ...base,
          status: "missing",
          detail: `No ${provider} connection is configured for this credential owner.`,
        });
        continue;
      }
      if (connection.status !== "connected") {
        await writeHealth({
          ...base,
          connection_id: connection.id,
          status: "needs_reauth",
          renewable: connection.renewable,
          ...(asDate(connection.expiresAt) ? { expires_at: asDate(connection.expiresAt) } : {}),
          detail: "Provider connection requires re-authentication.",
        });
        continue;
      }
      try {
        const refreshed = await service.refreshConnection(connection.id, {
          includeDiagnostics: true,
        });
        const classification = classifySuccessfulRefresh(
          connection,
          refreshed.expiresIn,
          refreshed.refreshFailed === true,
          now,
        );
        await writeHealth({
          ...base,
          connection_id: connection.id,
          renewable: connection.renewable,
          ...(["healthy", "expiring", "non_renewable"].includes(classification.status)
            ? { last_success_at: now }
            : {}),
          ...classification,
        });
      } catch (error) {
        await writeHealth({
          ...base,
          connection_id: connection.id,
          status: "refresh_failed",
          renewable: connection.renewable,
          ...(asDate(connection.expiresAt) ? { expires_at: asDate(connection.expiresAt) } : {}),
          detail: safeError(error),
        });
      }
    }
  }

  const health = await getCollection<AutoIngestCredentialHealthDocument>(
    AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION,
  );
  await health.deleteMany({ _id: { $nin: activeIds } });
}

/** Read-only admin projection. It deliberately contains metadata, never tokens. */
export async function getAutoIngestCredentialHealth(
  refreshIntervalMs: number,
  now: Date = new Date(),
): Promise<AutoIngestCredentialHealthSnapshot> {
  const projects = await loadEnabledProjects();
  const health = await getCollection<AutoIngestCredentialHealthDocument>(
    AUTO_INGEST_CREDENTIAL_HEALTH_COLLECTION,
  );
  const documents = await health.find({}).toArray();
  const byId = new Map(documents.map((document) => [document._id, document]));
  const rows: AutoIngestCredentialHealthRow[] = [];

  for (const project of projects) {
    const projectBase = {
      projectId: project._id,
      projectSlug: project.slug,
      projectTitle: project.title,
      dataSteward: dataStewardLabel(project.data_steward) || "Not assigned",
      dataStewardType: stewardType(project),
    };
    const owner = project.autoIngest?.credentialOwner ?? null;
    if (!owner) {
      rows.push({
        ...projectBase,
        credentialOwner: null,
        provider: null,
        status: "no_owner",
        detail: "Choose a credential owner before scheduled ingestion can run.",
      });
      continue;
    }
    const ownerView = { email: owner.email, name: owner.name };
    const providers = requiredAutoIngestProviders(project);
    if (providers.length === 0) {
      rows.push({
        ...projectBase,
        credentialOwner: ownerView,
        provider: null,
        status: "no_sources",
        detail: "No credential-backed sources are configured for this project.",
      });
      continue;
    }
    for (const provider of providers) {
      const document = byId.get(healthId(owner.subject, provider));
      rows.push({
        ...projectBase,
        credentialOwner: ownerView,
        provider,
        status: document?.status ?? "pending",
        ...(document?.renewable !== undefined ? { renewable: document.renewable } : {}),
        ...(document?.expires_at
          ? { expiresAt: new Date(document.expires_at).toISOString() }
          : {}),
        ...(document?.last_attempt_at
          ? { lastAttemptAt: new Date(document.last_attempt_at).toISOString() }
          : {}),
        ...(document?.last_success_at
          ? { lastSuccessAt: new Date(document.last_success_at).toISOString() }
          : {}),
        detail: document?.detail ?? "Waiting for the first background token check.",
      });
    }
  }

  const healthyStatuses = new Set<AutoIngestCredentialStatus>(["healthy"]);
  const missingStatuses = new Set<AutoIngestCredentialStatus>(["missing", "no_owner"]);
  return {
    generatedAt: now.toISOString(),
    refreshIntervalMs,
    rows,
    summary: {
      projects: projects.length,
      healthy: rows.filter((row) => healthyStatuses.has(row.status)).length,
      missing: rows.filter((row) => missingStatuses.has(row.status)).length,
      attention: rows.filter(
        (row) => !healthyStatuses.has(row.status) && row.status !== "no_sources",
      ).length,
    },
  };
}
