// Page-template config — per-scope admin write.
//
//   PATCH /api/tome/page-templates/[scope]  → replace a scope's page list
//
// TOME-Admin gated. Body: { pages: StoredPageSpec[] }. Validation rejects
// edits that break required-page invariants (see validateTemplatePages).

import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  TEMPLATE_SCOPES,
  TemplateValidationFailure,
  updatePageTemplate,
  type StoredPageSpec,
  type TemplateScope,
} from "@/lib/tome/page-templates-store";

type Ctx = { params: Promise<{ scope: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
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

  const { scope } = await ctx.params;
  if (!(TEMPLATE_SCOPES as readonly string[]).includes(scope)) {
    return NextResponse.json({ error: `Unknown scope "${scope}"` }, { status: 400 });
  }

  let body: { pages?: StoredPageSpec[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.pages)) {
    return NextResponse.json({ error: "Body must include a `pages` array" }, { status: 400 });
  }

  try {
    const doc = await updatePageTemplate(
      scope as TemplateScope,
      body.pages,
      session.user.email ?? null,
    );
    return NextResponse.json({ template: doc });
  } catch (err) {
    if (err instanceof TemplateValidationFailure) {
      return NextResponse.json({ error: "Validation failed", errors: err.errors }, { status: 422 });
    }
    throw err;
  }
}
