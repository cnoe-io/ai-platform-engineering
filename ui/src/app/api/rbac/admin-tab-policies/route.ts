import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import type { AdminTabPolicy } from "@/lib/rbac/types";

/**
 * GET /api/rbac/admin-tab-policies
 *
 * Returns the raw CEL expressions stored in admin_tab_policies.
 * Admin-only — used by the CEL policy editor in the Policy tab.
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
    return NextResponse.json(
      { error: "MongoDB not configured" },
      { status: 503 },
    );
  }

  try {
    const col = await getCollection<AdminTabPolicy>("admin_tab_policies");
    const docs = await col.find({}).toArray();
    const policies = docs.map((d) => ({
      tab_key: d.tab_key,
      expression: d.expression,
      updated_by: d.updated_by,
      updated_at: d.updated_at,
    }));

    return NextResponse.json({ policies });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Database error" },
      { status: 500 },
    );
  }
}
