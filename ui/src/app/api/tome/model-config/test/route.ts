// Model config — live smoke test for a candidate model id.
//
//   POST /api/tome/model-config/test  → { model: string } -> { ok, error? }
//
// TOME-Admin gated, same as the PATCH route. Proxies to the tome-agent's
// POST /model-check (a toolless one-shot SDK query — no project scope, no
// persistence) so a bad id is caught in the admin UI instead of at the next
// real ingest/chat run.

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { testTomeModel } from "@/lib/tome/model-check";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { model?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    return NextResponse.json({ error: "Body must include a non-empty `model` string" }, { status: 400 });
  }

  return NextResponse.json(await testTomeModel(body.model));
}
