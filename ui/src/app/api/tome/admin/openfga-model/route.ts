import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import {
  getDocumentParentModelStatus,
  repairDocumentParentModel,
} from "@/lib/rbac/openfga";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
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

  try {
    return NextResponse.json(await getDocumentParentModelStatus());
  } catch (error) {
    console.error("[tome-openfga-repair] failed to inspect active model", error);
    return NextResponse.json(
      { error: "Could not inspect the active OpenFGA model" },
      { status: 502 },
    );
  }
}

export async function POST() {
  const access = await requireTomeAdmin();
  if ("response" in access) return access.response;

  try {
    const result = await repairDocumentParentModel();
    auditTome({
      action: "tome.openfga.document_parent.repair",
      actor: {
        type: "user",
        id: access.session.sub ?? access.session.user?.email ?? "unknown",
        email: access.session.user?.email ?? undefined,
      },
      projectSlug: "settings",
      tenantId: access.session.org,
      metadata: {
        changed: result.changed,
        active_model_id: result.activeModelId,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[tome-openfga-repair] failed to repair active model", error);
    return NextResponse.json(
      { error: "Could not repair the active OpenFGA model" },
      { status: 502 },
    );
  }
}
