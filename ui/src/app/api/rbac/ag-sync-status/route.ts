import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { AgSyncState } from "@/lib/rbac/types";

/**
 * GET /api/rbac/ag-sync-status
 *
 * Returns the current AG config sync state so the Admin UI can display
 * whether the config bridge has picked up the latest policy generation.
 * Admin-only.
 */
export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    role?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isMongoDBConfigured) {
    return NextResponse.json({ error: "MongoDB not configured" }, { status: 503 });
  }

  try {
    const col = await getCollection<AgSyncState>("ag_sync_state");
    const state = await col.findOne({ _id: "current" as unknown as AgSyncState["_id"] });

    if (!state) {
      return NextResponse.json({
        synced: true,
        policy_generation: 0,
        bridge_generation: 0,
        last_sync: null,
        error: null,
      });
    }

    return NextResponse.json({
      synced: state.policy_generation === state.bridge_generation,
      policy_generation: state.policy_generation,
      bridge_generation: state.bridge_generation,
      last_sync: state.bridge_last_sync,
      error: state.bridge_error ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 },
    );
  }
}
