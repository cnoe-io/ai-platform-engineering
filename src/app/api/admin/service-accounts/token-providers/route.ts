import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { isServiceAccountTokensEnabled } from "@/lib/feature-flags/credentials";
import { getProviderDisplayName } from "@/lib/credentials/provider-display-names";
import { BUILT_IN_OAUTH_CONNECTORS } from "@/lib/credentials/built-in-oauth-connectors";
import { listOpenFgaObjects } from "@/lib/rbac/openfga";
import type { MCPServerConfig } from "@/types/dynamic-agent";

// Providers a token can actually be added for — the POST /[id]/credentials route
// validates `provider` against this same set, so don't surface a provider in the
// picker that the add call would reject.
const BUILT_IN_PROVIDER_KEYS = new Set<string>(
  BUILT_IN_OAUTH_CONNECTORS.map((c) => c.provider),
);

/**
 * GET /api/admin/service-accounts/token-providers
 *
 * Returns the providers a service account can add a TOKEN (PAT) for. The set is
 * derived from the platform's *enabled* MCP servers that declare a
 * `provider_connection` credential source — i.e. servers wired for per-principal
 * token passthrough. Enable only the GitLab MCP and only GitLab is offered.
 *
 * Why not /api/credentials/oauth-connectors? That endpoint lists OAuth
 * *connectors*, which only become "enabled" once a registered OAuth app
 * (clientId/secret/redirect) is bootstrapped. PATs need no OAuth app, so the
 * connector list is the wrong source — it would (incorrectly) hide GitLab when
 * we have no GitLab OAuth app but DO support GitLab PATs.
 *
 * Response: { success, data: [{ provider, name }] } — never any token material.
 */

interface TokenProvider {
  provider: string;
  name: string;
}

export async function GET() {
  if (!isServiceAccountTokensEnabled()) {
    return NextResponse.json(
      { success: false, error: "Service account tokens are disabled", code: "CREDENTIALS_DISABLED" },
      { status: 404 },
    );
  }

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

  // Gate on team membership, matching the rest of the SA admin surface (a
  // service account is always owned by a team, and only owning-team members
  // manage it). A caller who belongs to no team can't manage any SA, so they
  // have no reason to enumerate token-capable providers either. 403 rather than
  // expose the platform's enabled-integration topology to any logged-in user.
  const callerTeams = await listOpenFgaObjects({
    user: `user:${session.sub}`,
    relation: "member",
    type: "team",
  });
  if (callerTeams.objects.length === 0) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const collection = await getCollection<MCPServerConfig>("mcp_servers");
    const servers = await collection.find({ enabled: true }).toArray();

    // Collect distinct provider keys from enabled servers' provider_connection
    // credential sources. A server may declare more than one source; only the
    // provider_connection kind (with a non-empty provider) is token-capable.
    // Filter to BUILT_IN_PROVIDER_KEYS so we never surface a provider the
    // add-token POST would reject (it validates against the same set).
    const providers = new Set<string>();
    for (const server of servers) {
      for (const source of server.credential_sources ?? []) {
        if (
          source.kind === "provider_connection" &&
          source.provider &&
          BUILT_IN_PROVIDER_KEYS.has(source.provider)
        ) {
          providers.add(source.provider);
        }
      }
    }

    const data: TokenProvider[] = Array.from(providers)
      .map((provider) => ({ provider, name: getProviderDisplayName(provider) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[service-accounts/token-providers] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list token providers" },
      { status: 503 },
    );
  }
}
