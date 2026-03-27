/**
 * Keycloak Authorization Services — sync per-task / per-skill resources (098).
 * Mirrors dynamic_agents KeycloakSyncService resource registration via Admin REST API.
 */

import { getKeycloakAdminToken } from "@/lib/rbac/keycloak-admin";

const TASK_SCOPES = ["view", "invoke", "configure", "delete"] as const;
const SKILL_SCOPES = ["view", "invoke", "configure", "delete"] as const;

function getKeycloakAdminBase(): string | null {
  const url = process.env.KEYCLOAK_URL?.trim();
  if (!url) return null;
  const realm = process.env.KEYCLOAK_REALM?.trim() || "caipe";
  return `${url.replace(/\/$/, "")}/admin/realms/${encodeURIComponent(realm)}`;
}

function getAuthzClientId(): string {
  return process.env.KEYCLOAK_RESOURCE_SERVER_ID?.trim() || "caipe-platform";
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getKeycloakAdminBase();
  if (!base) {
    throw new Error("KEYCLOAK_URL is not set");
  }
  const token = await getKeycloakAdminToken();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

async function getClientUuid(clientId: string): Promise<string | null> {
  const qs = new URLSearchParams({ clientId });
  const response = await adminFetch(`/clients?${qs.toString()}`, { method: "GET" });
  if (!response.ok) {
    console.warn(
      `[KeycloakResourceSync] list clients failed: ${response.status} ${clientId}`
    );
    return null;
  }
  const items = (await response.json()) as Array<{ id?: string }>;
  if (Array.isArray(items) && items[0]?.id) {
    return String(items[0].id);
  }
  return null;
}

async function deleteResourceByName(clientUuid: string, resourceName: string): Promise<void> {
  const encClient = encodeURIComponent(clientUuid);
  const basePath = `/clients/${encClient}/authz/resource-server/resource`;
  const qs = new URLSearchParams({ name: resourceName });
  const listResponse = await adminFetch(`${basePath}?${qs.toString()}`, { method: "GET" });
  if (!listResponse.ok) {
    return;
  }
  const rows = (await listResponse.json()) as Array<{ id?: string; name?: string }>;
  if (!Array.isArray(rows)) {
    return;
  }
  for (const row of rows) {
    if (row?.name !== resourceName || !row?.id) continue;
    const del = await adminFetch(`${basePath}/${encodeURIComponent(String(row.id))}`, {
      method: "DELETE",
    });
    if (!del.ok && del.status !== 404) {
      console.warn(`[KeycloakResourceSync] delete resource ${resourceName}: ${del.status}`);
    }
    return;
  }
}

type SyncAction = "create" | "delete";

async function syncCaipeResource(
  action: SyncAction,
  opts: {
    resourceName: string;
    displayName: string;
    type: string;
    scopes: readonly string[];
    attributes: Record<string, string[]>;
  }
): Promise<void> {
  const baseUrl = getKeycloakAdminBase();
  if (!baseUrl) {
    console.log("[KeycloakResourceSync] KEYCLOAK_URL unset — skip resource sync");
    return;
  }

  try {
    const clientUuid = await getClientUuid(getAuthzClientId());
    if (!clientUuid) {
      console.warn(
        `[KeycloakResourceSync] Authz client ${getAuthzClientId()} not found — skip`
      );
      return;
    }
    const encClient = encodeURIComponent(clientUuid);
    const resourceBase = `/clients/${encClient}/authz/resource-server/resource`;

    if (action === "delete") {
      await deleteResourceByName(clientUuid, opts.resourceName);
      return;
    }

    const payload = {
      name: opts.resourceName,
      displayName: opts.displayName,
      type: opts.type,
      attributes: opts.attributes,
      uris: [] as string[],
      scopes: opts.scopes.map((name) => ({ name })),
    };

    const createResponse = await adminFetch(resourceBase, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (createResponse.status === 409) {
      return;
    }
    if (!createResponse.ok) {
      const detail = await createResponse.text();
      console.warn(
        `[KeycloakResourceSync] create ${opts.resourceName} failed: ${createResponse.status} ${detail.slice(0, 300)}`
      );
    }
  } catch (e) {
    console.warn("[KeycloakResourceSync] sync failed:", e);
  }
}

/**
 * Register or remove a Task Builder config as Keycloak resource `task:<taskId>`.
 */
export async function syncTaskResource(
  action: SyncAction,
  taskId: string,
  taskName: string,
  visibility?: string
): Promise<void> {
  const resourceName = `task:${taskId}`;
  const attrs: Record<string, string[]> = { task_id: [taskId] };
  if (visibility) {
    attrs.visibility = [visibility];
  }
  await syncCaipeResource(action, {
    resourceName,
    displayName: taskName,
    type: "caipe:task",
    scopes: action === "create" ? TASK_SCOPES : [],
    attributes: attrs,
  });
}

/**
 * Register or remove a Skills Gateway skill as Keycloak resource `skill:<skillId>`.
 */
export async function syncSkillResource(
  action: SyncAction,
  skillId: string,
  skillName: string,
  visibility?: string
): Promise<void> {
  const resourceName = `skill:${skillId}`;
  const attrs: Record<string, string[]> = { skill_id: [skillId] };
  if (visibility) {
    attrs.visibility = [visibility];
  }
  await syncCaipeResource(action, {
    resourceName,
    displayName: skillName,
    type: "caipe:skill",
    scopes: action === "create" ? SKILL_SCOPES : [],
    attributes: attrs,
  });
}
