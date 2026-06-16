// assisted-by Codex Codex-sonnet-4-6
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { listOpenFgaObjects } from "@/lib/rbac/openfga";
import { listRebacCatalog } from "@/lib/rbac/resource-catalog";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import { hasOrganizationAdmin } from "@/lib/rbac/platform-admin";

/**
 * GET /api/admin/service-accounts/grantable
 *
 * Returns the agents and tools the CALLING USER currently holds, to populate
 * the create / add-scope picker (FR-009). The grantable set is the user's OWN
 * permissions (FR-007) — it is independent of any owning team, so `?team_id=`
 * is accepted but ignored here (the UI may use it only to pre-select a team).
 *
 * Backed by `listOpenFgaObjects(user:<caller>, can_use, agent)` and the tool
 * equivalent (`can_call`, `tool`). See research.md R-8.
 *
 * Response: { success, data: { agents: [{ref,name}], tools: [{ref,name}] } }
 * Credential material is never involved here.
 */

interface GrantableItem {
  ref: string;
  name: string;
}

interface DynamicAgentLite {
  _id: string;
  name?: string;
  enabled?: boolean;
}

interface MCPServerLite {
  _id: string;
  name?: string;
  enabled?: boolean;
}

/** Strip the OpenFGA `<type>:` prefix, returning the bare object id. */
function stripType(object: string, type: string): string {
  const prefix = `${type}:`;
  return object.startsWith(prefix) ? object.slice(prefix.length) : object;
}

/** Best-effort human label for a tool ref like "jira/search" or "jira/*". */
function humanizeToolRef(ref: string): string {
  const slash = ref.indexOf("/");
  if (slash < 0) return ref;
  const server = ref.slice(0, slash);
  const tool = ref.slice(slash + 1);
  return tool === "*" ? `${server}: all tools` : `${server}: ${tool}`;
}

async function listFullPlatformCatalog(): Promise<{ agents: GrantableItem[]; tools: GrantableItem[] }> {
  if (!isMongoDBConfigured) {
    throw new Error("MongoDB not configured");
  }

  const agentsCol = await getCollection<DynamicAgentLite>("dynamic_agents");
  const mcpCol = await getCollection<MCPServerLite>("mcp_servers");
  const [allAgents, allServers] = await Promise.all([
    agentsCol
      .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1 } })
      .sort({ name: 1 })
      .toArray(),
    mcpCol
      .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1 } })
      .sort({ name: 1 })
      .toArray(),
  ]);

  const agents = allAgents.map((agent) => ({
    ref: agent._id,
    name: agent.name ?? agent._id,
  }));
  const tools = allServers.map((server) => {
    const ref = `${server._id}/*`;
    return { ref, name: humanizeToolRef(ref) };
  });

  agents.sort((a, b) => a.name.localeCompare(b.name));
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, tools };
}

export async function GET(request?: NextRequest | Request) {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const caller = `user:${session.sub}`;
  const url = request ? new URL(request.url) : null;
  const isUnlinkedContext = url?.searchParams.get("context") === "unlinked";

  try {
    if (isUnlinkedContext) {
      const admin = await hasOrganizationAdmin(session);
      if (!admin) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 },
        );
      }

      const data = await listFullPlatformCatalog();
      return NextResponse.json({ success: true, data });
    }

    const [agentObjects, toolObjects] = await Promise.all([
      listOpenFgaObjects({ user: caller, relation: "can_use", type: "agent" }),
      listOpenFgaObjects({ user: caller, relation: "can_call", type: "tool" }),
    ]);

    // Resolve friendly names best-effort from the ReBAC resource catalog;
    // fall back to the ref itself so the picker is always usable even if the
    // catalog is unavailable.
    const nameByAgentId = new Map<string, string>();
    try {
      const catalog = await listRebacCatalog({ type: "agent" });
      for (const r of catalog.resources) {
        if (r.type === "agent") nameByAgentId.set(r.id, r.display_name);
      }
    } catch {
      // Names are decorative; ignore catalog failures.
    }

    const agents: GrantableItem[] = agentObjects.objects.map((object) => {
      const ref = stripType(object, "agent");
      return { ref, name: nameByAgentId.get(ref) ?? ref };
    });

    const tools: GrantableItem[] = toolObjects.objects.map((object) => {
      const ref = stripType(object, "tool");
      return { ref, name: humanizeToolRef(ref) };
    });

    // Stable ordering for a predictable picker.
    agents.sort((a, b) => a.name.localeCompare(b.name));
    tools.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data: { agents, tools } });
  } catch (error) {
    console.error("[service-accounts/grantable] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list grantable resources" },
      { status: 503 },
    );
  }
}
