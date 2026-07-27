// Page-template config — user-facing surface.
//
//   GET /api/tome/page-templates          → all scopes (any authenticated user)
//
// Read is open to any signed-in user so the wiki UI can render live templates.
// Edits go through PATCH /api/tome/page-templates/[scope], which is TOME-Admin
// gated.

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!(session as { user?: { email?: string | null } } | null)?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const templates = await getAllPageTemplates();
  return NextResponse.json({ templates });
}
