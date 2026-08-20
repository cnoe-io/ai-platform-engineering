import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  defaultRubricPolicy,
  listQualityPolicies,
  saveQualityPolicy,
} from "@/lib/tome/evaluation-store";
import { TOME_RUBRIC_IDS, type QualityPolicy } from "@/types/tome-evaluation";

export const dynamic = "force-dynamic";

async function emailIfAdmin(): Promise<string | null> {
  const session = (await getServerSession(authOptions)) as {
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !(await isTomeAdmin(session))) return null;
  return session.user.email;
}

export async function GET() {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await emailIfAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ data: await listQualityPolicies() });
}

export async function PUT(request: NextRequest) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const email = await emailIfAdmin();
  if (!email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Partial<QualityPolicy> | null;
  if (!body || !body.scope_kind || !["global", "type", "exact"].includes(body.scope_kind)) {
    return NextResponse.json({ error: "Invalid policy scope" }, { status: 400 });
  }
  if (!body.mode || !["off", "observe", "enforce"].includes(body.mode)) {
    return NextResponse.json({ error: "Invalid policy mode" }, { status: 400 });
  }
  if (body.scope_kind !== "global" && !body.scope_id?.trim()) {
    return NextResponse.json({ error: "scope_id is required" }, { status: 400 });
  }
  if (body.scope_kind === "type" && !["project", "area", "bhag"].includes(body.scope_id!)) {
    return NextResponse.json({ error: "Invalid entity type scope" }, { status: 400 });
  }
  const supplied = body.rubrics ?? defaultRubricPolicy();
  const defaults = defaultRubricPolicy();
  const rubrics = Object.fromEntries(TOME_RUBRIC_IDS.map((id) => [
    id,
    { ...defaults[id], ...(supplied[id] ?? {}) },
  ])) as QualityPolicy["rubrics"];
  const policy = await saveQualityPolicy({
    scope_kind: body.scope_kind,
    scope_id: body.scope_kind === "global" ? null : body.scope_id?.trim() || null,
    mode: body.mode,
    evaluator_model: body.evaluator_model?.trim() || "",
    rubrics,
    require_human_review: body.require_human_review !== false,
    allow_steward_override: body.allow_steward_override !== false,
    updated_by: email,
  });
  return NextResponse.json({ data: policy });
}
