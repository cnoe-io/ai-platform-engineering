import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import { getBySub } from "@/lib/service-accounts";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { BUILT_IN_OAUTH_CONNECTORS } from "@/lib/credentials/built-in-oauth-connectors";
import { getCollection } from "@/lib/mongodb";
import { CREDENTIAL_COLLECTIONS } from "@/lib/credentials/collections";
import { isServiceAccountTokensEnabled } from "@/lib/feature-flags/credentials";
import { ApiError } from "@/lib/api-error";
import type { ProviderConnectionDocument } from "@/lib/credentials/oauth-service";

/**
 * GET/POST/DELETE /api/admin/service-accounts/[id]/credentials
 *
 * Manage provider credentials (pasted static tokens) owned by a service
 * account. `[id]` is the SA's OpenFGA subject id (`sa_sub`). All three
 * verbs are gated by the SAME `can_manage` check used elsewhere in the SA
 * admin API (owning-team member). Non-members get 404 (do not reveal
 * existence — FR-022).
 *
 * GET  — list provider connections owned by this SA. Returns connection
 *         metadata; NEVER returns token material (FR-005).
 * POST — register a pasted access token for a provider. Body: { provider,
 *         token, requestedScopes? }. Provider must be one of the 5
 *         built-in connectors. Returns 409 if a connected credential for
 *         that provider already exists.
 * DELETE — remove a connection. Body (or query): { connection_id }. The
 *           cross-owner guard verifies the connection belongs to this SA
 *           before deleting, so a caller cannot delete another principal's
 *           connection by guessing an id.
 */

const BUILT_IN_PROVIDER_KEYS = new Set<string>(
  BUILT_IN_OAUTH_CONNECTORS.map((c) => c.provider),
);

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Return 404 when the service-account Tokens surface is disabled. */
function assertFeatureEnabled(): NextResponse | null {
  if (!isServiceAccountTokensEnabled()) {
    return NextResponse.json(
      { success: false, error: "Service account tokens are disabled", code: "CREDENTIALS_DISABLED" },
      { status: 404 },
    );
  }
  return null;
}

/** Resolve the SA and gate by can_manage. Returns [sa_sub, 403/404 response | null]. */
async function resolveAndGate(
  callerSub: string,
  id: string,
): Promise<
  | { sa_sub: string; error?: never }
  | { sa_sub?: never; error: NextResponse }
> {
  const decision = await checkOpenFgaTuple({
    user: `user:${callerSub}`,
    relation: "can_manage",
    object: `service_account:${id}`,
  });
  if (!decision.allowed) {
    return {
      error: NextResponse.json(
        { success: false, error: "Service account not found" },
        { status: 404 },
      ),
    };
  }

  const doc = await getBySub(id);
  if (!doc || doc.status === "revoked") {
    return {
      error: NextResponse.json(
        { success: false, error: "Service account not found" },
        { status: 404 },
      ),
    };
  }

  return { sa_sub: doc.sa_sub };
}

/** Strip secret fields from connection metadata for safe external response. */
function safeConnectionShape(conn: {
  id: string;
  provider: string;
  status: string;
  updatedAt?: Date;
  requestedScopes?: string[];
  connectorId: string;
}) {
  return {
    id: conn.id,
    provider: conn.provider,
    status: conn.status,
    connectedAt: conn.updatedAt ?? null,
    requestedScopes: conn.requestedScopes ?? [],
    connectorId: conn.connectorId,
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const featureGuard = assertFeatureEnabled();
  if (featureGuard) return featureGuard;

  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing service account id" },
      { status: 400 },
    );
  }

  try {
    const result = await resolveAndGate(session.sub, id);
    if (result.error) return result.error;
    const { sa_sub } = result;

    const service = await getProviderConnectionService();
    const connections = await service.listConnections({ type: "service_account", id: sa_sub });

    return NextResponse.json({
      success: true,
      data: connections.map(safeConnectionShape),
    });
  } catch (error) {
    console.error("[service-accounts:credentials:list] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list credentials" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const featureGuard = assertFeatureEnabled();
  if (featureGuard) return featureGuard;

  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing service account id" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const provider =
    typeof body.provider === "string" ? body.provider.trim() : "";
  const token =
    typeof body.token === "string" ? body.token.trim() : "";

  if (!provider) {
    return NextResponse.json(
      { success: false, error: "provider is required" },
      { status: 400 },
    );
  }
  if (!BUILT_IN_PROVIDER_KEYS.has(provider)) {
    return NextResponse.json(
      {
        success: false,
        error: `provider must be one of: ${[...BUILT_IN_PROVIDER_KEYS].join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!token) {
    return NextResponse.json(
      { success: false, error: "token is required" },
      { status: 400 },
    );
  }

  const requestedScopes =
    Array.isArray(body.requestedScopes) &&
    body.requestedScopes.every((s) => typeof s === "string")
      ? (body.requestedScopes as string[])
      : undefined;

  try {
    const result = await resolveAndGate(session.sub, id);
    if (result.error) return result.error;
    const { sa_sub } = result;

    const service = await getProviderConnectionService();

    // Duplicate-provider guard: reject if a connected credential for this
    // provider already exists on the SA (prevents non-deterministic exchange).
    const existing = await service.listConnections({ type: "service_account", id: sa_sub });
    const duplicate = existing.find(
      (c) => c.provider === provider && c.status === "connected",
    );
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          error: `A connected credential for provider "${provider}" already exists (id: ${duplicate.id}). Delete it first or rotate it.`,
        },
        { status: 409 },
      );
    }

    const connection = await service.registerStaticToken({
      providerKey: provider,
      owner: { type: "service_account", id: sa_sub },
      accessToken: token,
      requestedScopes,
    });

    logOpenFgaRebacAuditEvent({
      sub: session.sub,
      operation: "service_account.credential.add",
      scope: "admin",
      resourceRef: `service_account:${id}`,
      email: session.user.email ?? undefined,
      correlationId: `service_account.credential.add:${id}:${provider}:${connection.id}`,
    });

    return NextResponse.json(
      { success: true, data: safeConnectionShape(connection) },
      { status: 201 },
    );
  } catch (error) {
    // Let validation errors (from the service — e.g. bad scopes, unknown
    // connector) surface as 400.
    if (
      error !== null &&
      typeof error === "object" &&
      typeof (error as { statusCode?: unknown }).statusCode === "number" &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      const apiErr = error as { message: string; statusCode: number };
      return NextResponse.json(
        { success: false, error: apiErr.message },
        { status: apiErr.statusCode },
      );
    }
    console.error("[service-accounts:credentials:add] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to register credential" },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const featureGuard = assertFeatureEnabled();
  if (featureGuard) return featureGuard;

  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email || !session.sub) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Missing service account id" },
      { status: 400 },
    );
  }

  // Accept connection_id from body OR query param.
  let connectionId: string;
  const queryConnectionId = new URL(request.url).searchParams.get("connection_id") ?? "";
  if (queryConnectionId) {
    connectionId = queryConnectionId.trim();
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: "connection_id is required (body or query)" },
        { status: 400 },
      );
    }
    connectionId =
      typeof body.connection_id === "string" ? body.connection_id.trim() : "";
  }

  if (!connectionId) {
    return NextResponse.json(
      { success: false, error: "connection_id is required" },
      { status: 400 },
    );
  }

  try {
    const result = await resolveAndGate(session.sub, id);
    if (result.error) return result.error;
    const { sa_sub } = result;

    // Fetch the connection to verify cross-owner guard.
    // Only return 404 for genuine not-found (ApiError with statusCode 404);
    // let infra errors (DB timeout, etc.) propagate to the outer handler.
    const service = await getProviderConnectionService();
    let connection;
    try {
      connection = await service.getConnection(connectionId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        return NextResponse.json(
          { success: false, error: "Provider connection not found" },
          { status: 404 },
        );
      }
      throw err;
    }

    // Cross-owner guard: only delete if the connection belongs to this SA.
    if (
      connection.owner.type !== "service_account" ||
      connection.owner.id !== sa_sub
    ) {
      return NextResponse.json(
        { success: false, error: "Provider connection not found" },
        { status: 404 },
      );
    }

    // Delete the connection document directly from the Mongo collection.
    // There is no service-level delete method today; follow the same pattern
    // as lib/service-accounts.ts (direct getCollection). Best-effort cleanup
    // of the encrypted payload secret is attempted but does not fail the
    // request if the payload is already gone.
    const connectionsCollection = await getCollection<ProviderConnectionDocument>(
      CREDENTIAL_COLLECTIONS.providerConnections,
    );
    await (connectionsCollection as unknown as {
      deleteOne(query: Record<string, unknown>): Promise<unknown>;
    }).deleteOne({ id: connectionId });

    // Best-effort: purge the encrypted payload for the access token secret.
    // The key is deterministic: provider_connection:<connectionId>:access_token
    // (matches oauth-service.ts registerStaticToken line 460).
    try {
      const payloadsCollection = await getCollection(
        CREDENTIAL_COLLECTIONS.encryptedPayloads,
      );
      await (payloadsCollection as unknown as {
        deleteOne(query: Record<string, unknown>): Promise<unknown>;
      }).deleteOne({ secretRefId: `provider_connection:${connectionId}:access_token` });
    } catch {
      // Non-fatal — the token is inaccessible once the connection doc is gone.
    }

    logOpenFgaRebacAuditEvent({
      sub: session.sub,
      operation: "service_account.credential.remove",
      scope: "admin",
      resourceRef: `service_account:${id}`,
      email: session.user.email ?? undefined,
      correlationId: `service_account.credential.remove:${id}:${connectionId}`,
    });

    return NextResponse.json({ success: true, data: { id: connectionId, deleted: true } });
  } catch (error) {
    console.error("[service-accounts:credentials:delete] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete credential" },
      { status: 503 },
    );
  }
}
