import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  deleteTerminalExperiments,
  getExperiment,
  listArtifactEvaluations,
  listArtifactFileEvaluations,
  listExperimentArtifacts,
  TERMINAL_EXPERIMENT_STATUSES,
} from "@/lib/tome/evaluation-store";
import { aggregateExperiment } from "@/lib/tome/experiment-runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ experimentId: string }> };

async function adminSession(): Promise<{
  sub?: string;
  user: { email: string };
} | null> {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !(await isTomeAdmin(session))) return null;
  return { sub: session.sub, user: { email: session.user.email } };
}

export async function GET(_request: Request, ctx: Ctx) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await adminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { experimentId } = await ctx.params;
  const experiment = await getExperiment(experimentId);
  if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  const [artifacts, evaluations, fileEvaluations] = await Promise.all([
    listExperimentArtifacts(experimentId),
    listArtifactEvaluations(experimentId),
    listArtifactFileEvaluations(experimentId),
  ]);
  return NextResponse.json({
    data: {
      experiment,
      artifacts,
      evaluations,
      file_evaluations: fileEvaluations,
      aggregates: aggregateExperiment(experiment, artifacts, evaluations),
      warnings: [experiment.config.model_a, experiment.config.model_b]
        .includes(experiment.config.evaluator_model)
        ? ["The evaluator is also one of the candidate models."]
        : [],
    },
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { experimentId } = await ctx.params;
  const experiment = await getExperiment(experimentId);
  if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  if (!TERMINAL_EXPERIMENT_STATUSES.includes(experiment.status)) {
    return NextResponse.json(
      { error: "Active experiments must be stopped before deletion" },
      { status: 409 },
    );
  }
  try {
    const result = await deleteTerminalExperiments({
      actor: session.user.email,
      experimentId,
    });
    auditTome({
      action: "tome.experiment.delete",
      actor: { type: "user", id: session.sub || session.user.email },
      projectSlug: experiment.project_slug,
      metadata: { ...result },
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 409 },
    );
  }
}
