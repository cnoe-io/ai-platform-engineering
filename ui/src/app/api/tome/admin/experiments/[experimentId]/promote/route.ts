import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { auditTome } from "@/lib/tome/audit";
import { promoteExperimentWinner } from "@/lib/tome/experiment-promotion";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ experimentId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { artifact_id?: string } | null;
  if (!body?.artifact_id) {
    return NextResponse.json({ error: "artifact_id is required" }, { status: 400 });
  }
  const { experimentId } = await ctx.params;
  try {
    const result = await promoteExperimentWinner({
      experimentId,
      artifactId: body.artifact_id,
      actor: session.user.email,
    });
    auditTome({
      action: "tome.experiment.promote",
      actor: { type: "user", id: session.sub || session.user.email },
      projectSlug: result.projectSlug,
      metadata: {
        experiment_id: experimentId,
        artifact_id: body.artifact_id,
        run_id: result.runId,
      },
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 409 },
    );
  }
}
