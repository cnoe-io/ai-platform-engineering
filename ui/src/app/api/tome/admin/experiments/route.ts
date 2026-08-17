import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { auditTome } from "@/lib/tome/audit";
import { deleteTerminalExperiments, listExperiments } from "@/lib/tome/evaluation-store";
import { startExperiment } from "@/lib/tome/experiment-runner";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import type { ProjectDocument } from "@/types/projects";
import type {
  ExperimentEvaluationMode,
  ExperimentOperation,
  ExperimentPageScope,
  RubricPolicy,
} from "@/types/tome-evaluation";

export const dynamic = "force-dynamic";

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

export async function GET() {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await adminSession())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ data: await listExperiments() });
}

export async function DELETE(request: NextRequest) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (request.nextUrl.searchParams.get("scope") !== "terminal") {
    return NextResponse.json(
      { error: "scope=terminal is required; active experiments are never deleted" },
      { status: 400 },
    );
  }
  try {
    const result = await deleteTerminalExperiments({ actor: session.user.email });
    auditTome({
      action: "tome.experiment.delete_terminal_runs",
      actor: { type: "user", id: session.sub || session.user.email },
      projectSlug: result.project_slugs.length === 1
        ? result.project_slugs[0]
        : "model-evaluations",
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

export async function POST(request: NextRequest) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    entity_id?: string;
    model_a?: string;
    model_b?: string;
    evaluator_model?: string;
    operation?: ExperimentOperation;
    evaluation_suite_id?: string;
    repeat_count?: number;
    rubric_policy?: RubricPolicy;
    cost_ceiling_usd?: number;
    turn_limit?: number;
    seed?: number;
    instruction?: string | null;
    evaluation_page_scope?: ExperimentPageScope;
    evaluation_mode?: ExperimentEvaluationMode;
  } | null;
  if (!body?.entity_id || !body.model_a || !body.model_b || !body.evaluator_model) {
    return NextResponse.json(
      { error: "entity_id, model_a, model_b, and evaluator_model are required" },
      { status: 400 },
    );
  }
  if (!body.operation || !["ingest", "synthesize", "compact"].includes(body.operation)) {
    return NextResponse.json({ error: "Invalid operation" }, { status: 400 });
  }
  if (body.evaluation_suite_id && body.evaluation_suite_id !== "live-entity") {
    return NextResponse.json({ error: "Unknown evaluation suite" }, { status: 400 });
  }
  const projects = await getCollection<ProjectDocument>("projects");
  const selector = ObjectId.isValid(body.entity_id)
    ? { _id: new ObjectId(body.entity_id) as never }
    : { slug: body.entity_id };
  const found = await projects.findOne(selector);
  if (!found) return NextResponse.json({ error: "TOME entity not found" }, { status: 404 });
  const project = { ...found, _id: String(found._id) } as ProjectDocument & { _id: string };
  const entityType = project.type ?? "project";
  if (body.operation === "synthesize" && !["area", "bhag"].includes(entityType)) {
    return NextResponse.json(
      { error: "Synthesis experiments require an Area or BHAG entity" },
      { status: 400 },
    );
  }
  if (body.operation === "ingest" && entityType !== "project") {
    return NextResponse.json(
      { error: "Ingest experiments require a Project entity" },
      { status: 400 },
    );
  }
  try {
    const experiment = await startExperiment({
      project,
      createdBy: session.user.email,
      modelA: body.model_a,
      modelB: body.model_b,
      evaluatorModel: body.evaluator_model,
      operation: body.operation,
      evaluationSuiteId: body.evaluation_suite_id,
      repeatCount: body.repeat_count,
      rubricPolicy: body.rubric_policy,
      costCeilingUsd: body.cost_ceiling_usd,
      turnLimit: body.turn_limit,
      seed: body.seed,
      instruction: body.instruction,
      evaluationPageScope: body.evaluation_page_scope,
      evaluationMode: body.evaluation_mode,
    });
    return NextResponse.json({ data: experiment }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error)?.message ?? error) },
      { status: 400 },
    );
  }
}
