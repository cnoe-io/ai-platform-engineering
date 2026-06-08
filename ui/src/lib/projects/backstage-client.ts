// assisted-by Cursor Composer

import type { BackstageComponentCatalog, BackstageProjectCatalog } from "@/types/projects";

export interface BackstageCatalogEntity {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    title?: string;
    description?: string;
    annotations?: Record<string, string>;
    tags?: string[];
  };
  spec?: Record<string, unknown>;
}

export interface BackstageSystemSummary {
  entityRef: string;
  slug: string;
  title: string;
  description: string;
  domain: string;
  owner: string;
  tags: string[];
  catalog: BackstageProjectCatalog;
  components: BackstageComponentCatalog[];
}

export function isBackstageConfigured(): boolean {
  const url =
    process.env.BACKSTAGE_URL?.trim() ||
    process.env.BACKSTAGE_API_URL?.trim() ||
    "";
  const token =
    process.env.BACKSTAGE_API_TOKEN?.trim() ||
    process.env.BACKSTAGE_TOKEN?.trim() ||
    "";
  return Boolean(url && token);
}

export function backstageConfiguredHost(): string | null {
  const url =
    process.env.BACKSTAGE_URL?.trim() ||
    process.env.BACKSTAGE_API_URL?.trim() ||
    "";
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/** User-facing hint when the server cannot reach the Backstage catalog API. */
export function backstageReachabilityMessage(cause?: string): string {
  const host = backstageConfiguredHost();
  const hostHint = host ? ` (${host})` : "";
  const detail = cause?.trim() ? ` ${cause.trim()}` : "";
  return (
    `Cannot reach the Backstage catalog API${hostHint}.${detail} ` +
    "If you are developing locally, connect to your corporate VPN so Docker " +
    "can reach Backstage, then try again."
  );
}

function backstageBaseUrl(): string {
  const url =
    process.env.BACKSTAGE_URL?.trim() ||
    process.env.BACKSTAGE_API_URL?.trim() ||
    "";
  if (!url) {
    throw new Error(
      "Backstage is not configured (set BACKSTAGE_URL or BACKSTAGE_API_URL)",
    );
  }
  return url.replace(/\/$/, "");
}

function backstageToken(): string {
  const token =
    process.env.BACKSTAGE_API_TOKEN?.trim() ||
    process.env.BACKSTAGE_TOKEN?.trim() ||
    "";
  if (!token) {
    throw new Error(
      "Backstage credentials are not configured (set BACKSTAGE_API_TOKEN)",
    );
  }
  return token;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${backstageToken()}`,
    Accept: "application/json",
  };
}

function unwrapEntity(item: unknown): BackstageCatalogEntity | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  if (record.entity && typeof record.entity === "object") {
    return record.entity as BackstageCatalogEntity;
  }
  return record as BackstageCatalogEntity;
}

export function entityToSystemSummary(
  entity: BackstageCatalogEntity,
): BackstageSystemSummary | null {
  if ((entity.kind ?? "").toLowerCase() !== "system") {
    return null;
  }

  const slug = entity.metadata?.name?.trim();
  if (!slug) return null;

  const spec = entity.spec ?? {};
  const owner = typeof spec.owner === "string" ? spec.owner : "group:unknown";
  const domain = typeof spec.domain === "string" ? spec.domain : "default";
  const title = entity.metadata?.title?.trim() || slug;
  const description =
    entity.metadata?.description?.trim() || `${title} — imported from Backstage`;

  const catalog: BackstageProjectCatalog = {
    apiVersion: "backstage.io/v1alpha1",
    kind: "System",
    metadata: {
      name: slug,
      title,
      description,
      annotations: entity.metadata?.annotations ?? {},
      tags: entity.metadata?.tags ?? [],
    },
    spec: {
      owner,
      domain,
      type: typeof spec.type === "string" ? spec.type : "service",
      mailer: typeof spec.mailer === "string" ? spec.mailer : undefined,
      manager: typeof spec.manager === "string" ? spec.manager : undefined,
      outshift:
        spec.outshift && typeof spec.outshift === "object"
          ? (spec.outshift as BackstageProjectCatalog["spec"]["outshift"])
          : undefined,
    },
  };

  return {
    entityRef: `system:default/${slug}`,
    slug,
    title,
    description,
    domain,
    owner,
    tags: entity.metadata?.tags ?? [],
    catalog,
    components: [],
  };
}

export async function fetchBackstageSystems(): Promise<BackstageSystemSummary[]> {
  const base = backstageBaseUrl();
  const url = new URL(`${base}/api/catalog/entities/by-query`);
  url.searchParams.set("limit", "250");
  url.searchParams.set("fields", "metadata,kind,spec,relations");

  const systems: BackstageSystemSummary[] = [];
  let cursor: string | undefined;

  do {
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    } else {
      url.searchParams.delete("cursor");
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), { headers: authHeaders() });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(backstageReachabilityMessage(cause));
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Backstage catalog query failed (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    const body = (await response.json()) as {
      items?: unknown[];
      pageInfo?: { nextCursor?: string };
    };

    for (const item of body.items ?? []) {
      const entity = unwrapEntity(item);
      if (!entity) continue;
      const summary = entityToSystemSummary(entity);
      if (summary) systems.push(summary);
    }

    cursor = body.pageInfo?.nextCursor;
  } while (cursor);

  systems.sort((a, b) => a.title.localeCompare(b.title));
  return systems;
}

export async function fetchBackstageComponentsForSystem(
  systemSlug: string,
): Promise<BackstageComponentCatalog[]> {
  const base = backstageBaseUrl();
  const filter = encodeURIComponent(`kind=component,spec.system=${systemSlug}`);
  const response = await fetch(
    `${base}/api/catalog/entities?filter=${filter}`,
    { headers: authHeaders() },
  );

  if (!response.ok) {
    return [];
  }

  const entities = (await response.json()) as BackstageCatalogEntity[];
  return entities
    .map((entity) => {
      const name = entity.metadata?.name?.trim();
      if (!name) return null;
      const spec = entity.spec ?? {};
      return {
        apiVersion: "backstage.io/v1alpha1" as const,
        kind: "Component" as const,
        metadata: {
          name,
          title: entity.metadata?.title?.trim() || name,
          description: entity.metadata?.description?.trim() || "",
          tags: entity.metadata?.tags ?? [],
        },
        spec: {
          type: typeof spec.type === "string" ? spec.type : "service",
          lifecycle: typeof spec.lifecycle === "string" ? spec.lifecycle : "experimental",
          owner: typeof spec.owner === "string" ? spec.owner : "group:unknown",
          system: systemSlug,
        },
      };
    })
    .filter((item): item is BackstageComponentCatalog => item !== null);
}
