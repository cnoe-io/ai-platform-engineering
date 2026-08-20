import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  getTomeAuthorizationHealth,
  reconcileTomeAuthorization,
} from "@/lib/tome/authorization-health";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

interface AdminSession {
  sub?: string;
  org?: string;
  user?: { email?: string | null };
}

async function requireTomeAdmin(): Promise<
  { session: AdminSession } | { response: NextResponse }
> {
  if (!isTomeServerEnabled()) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const session = (await getServerSession(authOptions)) as AdminSession | null;
  if (!session?.user?.email) {
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

  const stored = await getTomeAuthorizationHealth();
  if (stored) return NextResponse.json({ health: stored });
  const health = await reconcileTomeAuthorization({ trigger: "inspect", repair: false });
  return NextResponse.json({ health });
}

export async function POST() {
  const access = await requireTomeAdmin();
  if ("response" in access) return access.response;

  const health = await reconcileTomeAuthorization({
    trigger: "manual",
    repair: true,
    actor: {
      id: access.session.sub ?? access.session.user?.email ?? "unknown",
      email: access.session.user?.email ?? undefined,
    },
  });
  return NextResponse.json({ health });
}
