import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { revokeDirectTomeAdmin } from "@/lib/rbac/tome-admin-members";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ subject: string }> };

interface AdminSession {
  sub?: string;
  user?: { email?: string | null };
}

export async function DELETE(_request: Request, ctx: Ctx) {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = (await getServerSession(authOptions)) as AdminSession | null;
  if (!session?.sub || !session.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { subject } = await ctx.params;
  try {
    await revokeDirectTomeAdmin(subject, session.sub);
    auditTome({
      action: "tome.admin.revoke",
      actor: { type: "user", id: session.sub, email: session.user.email },
      projectSlug: "settings",
      metadata: { target_subject: subject },
    });
    return NextResponse.json({ removed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove Tome admin";
    const status = message.endsWith("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
