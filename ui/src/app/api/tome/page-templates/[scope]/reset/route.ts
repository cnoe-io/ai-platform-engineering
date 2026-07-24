// Page-template config — reset a scope to shipped defaults.
//
//   POST /api/tome/page-templates/[scope]/reset
//
// TOME-Admin gated. Overwrites the scope's current template (including any
// prior admin edits) with the hardcoded fallback set.

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  TEMPLATE_SCOPES,
  resetPageTemplate,
  type TemplateScope,
} from "@/lib/tome/page-templates-store";

type Ctx = { params: Promise<{ scope: string }> };

export async function POST(_request: Request, ctx: Ctx) {
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

  const doc = await resetPageTemplate(scope as TemplateScope, session.user.email ?? null);
  return NextResponse.json({ template: doc });
}
