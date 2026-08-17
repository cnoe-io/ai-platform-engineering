import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
import { getExperiment } from "@/lib/tome/evaluation-store";
import { retryFailedExperimentFiles } from "@/lib/tome/experiment-runner";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ experimentId: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { experimentId } = await ctx.params;
  const experiment = await getExperiment(experimentId);
  if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  try {
    const retrying = await retryFailedExperimentFiles({
      experimentId,
      actor: session.user.email,
    });
    auditTome({
      action: "tome.experiment.retry_failed_files",
      actor: { type: "user", id: session.sub || session.user.email },
      projectSlug: experiment.project_slug,
      metadata: { experiment_id: experimentId },
    });
    return NextResponse.json({ data: retrying }, { status: 202 });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const status = message.includes("no incomplete files") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
