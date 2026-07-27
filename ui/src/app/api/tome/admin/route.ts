// GET /api/tome/admin — returns { isTomeAdmin: boolean } for the current session.
// Used by the client admin page to decide whether to render or redirect.

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isTomeAdmin(session);
  return NextResponse.json({ isTomeAdmin: admin });
}
