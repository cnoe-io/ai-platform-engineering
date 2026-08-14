import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  getExperiment,
  listArtifactEvaluations,
  listExperimentArtifacts,
} from "@/lib/tome/evaluation-store";
import { aggregateExperiment } from "@/lib/tome/experiment-runner";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ experimentId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = (await getServerSession(authOptions)) as {
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { experimentId } = await ctx.params;
  const experiment = await getExperiment(experimentId);
  if (!experiment) return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
  const [artifacts, evaluations] = await Promise.all([
    listExperimentArtifacts(experimentId),
    listArtifactEvaluations(experimentId),
  ]);
  return NextResponse.json({
    data: {
      experiment,
      artifacts,
      evaluations,
      aggregates: aggregateExperiment(experiment, artifacts, evaluations),
      warnings: [experiment.config.model_a, experiment.config.model_b]
        .includes(experiment.config.evaluator_model)
        ? ["The evaluator is also one of the candidate models."]
        : [],
    },
  });
}
