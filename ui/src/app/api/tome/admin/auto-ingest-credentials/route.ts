import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS,
  getAutoIngestCredentialHealth,
  refreshAutoIngestCredentialHealth,
} from "@/lib/tome/auto-ingest/credential-health";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

interface AdminSession {
  sub?: string;
  user?: { email?: string | null };
}

async function requireTomeAdmin(): Promise<NextResponse | null> {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = (await getServerSession(authOptions)) as AdminSession | null;
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

async function snapshot(): Promise<NextResponse> {
  const health = await getAutoIngestCredentialHealth(
    AUTO_INGEST_CREDENTIAL_REFRESH_INTERVAL_MS,
  );
  return NextResponse.json({ health });
}

export async function GET() {
  const denied = await requireTomeAdmin();
  if (denied) return denied;
  return snapshot();
}

export async function POST() {
  const denied = await requireTomeAdmin();
  if (denied) return denied;
  await refreshAutoIngestCredentialHealth();
  return snapshot();
}
