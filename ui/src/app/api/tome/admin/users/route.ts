import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import {
  grantTomeAdminByEmail,
  listDirectTomeAdmins,
} from "@/lib/rbac/tome-admin-members";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

interface AdminSession {
  sub?: string;
  user?: { email?: string | null };
}

async function requireTomeAdmin(): Promise<
  { session: AdminSession } | { response: NextResponse }
> {
  if (!isTomeServerEnabled()) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const session = (await getServerSession(authOptions)) as AdminSession | null;
  if (!session?.sub || !session.user?.email) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await isTomeAdmin(session))) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const access = await requireTomeAdmin();
  if ("response" in access) return access.response;

  const admins = await listDirectTomeAdmins();
  return NextResponse.json({
    admins: admins.map((admin) => ({
      ...admin,
      is_current_user: admin.subject === access.session.sub,
    })),
  });
}

export async function POST(request: NextRequest) {
  const access = await requireTomeAdmin();
  if ("response" in access) return access.response;

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (!body || typeof body.email !== "string") {
    return NextResponse.json({ error: "Body must include a user email" }, { status: 400 });
  }

  try {
    const admin = await grantTomeAdminByEmail(body.email);
    auditTome({
      action: "tome.admin.grant",
      actor: {
        type: "user",
        id: access.session.sub!,
        email: access.session.user?.email ?? undefined,
      },
      projectSlug: "settings",
      metadata: { target_subject: admin.subject, target_email: admin.email },
    });
    return NextResponse.json({ admin: { ...admin, is_current_user: false } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add Tome admin";
    const status = message.startsWith("User not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
