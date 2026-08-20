// Model config — user-facing surface.
//
//   GET /api/tome/model-config?scope_kind=global|type&scope_id=project
//
// Read is open to any signed-in user so the admin UI can show current values
// before an edit. Edits go through PATCH /api/tome/model-config/[role], which
// is TOME-Admin gated.

import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import {
  getScopeModelConfigs,
  ModelConfigValidationFailure,
  parseModelScope,
} from "@/lib/tome/model-config-store";
import { isTomeServerEnabled } from "@/lib/tome/guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isTomeServerEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!(session as { user?: { email?: string | null } } | null)?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isTomeAdmin(session as Parameters<typeof isTomeAdmin>[0]))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(request.url);
  try {
    const scope = parseModelScope(
      url.searchParams.get("scope_kind"),
      url.searchParams.get("scope_id"),
    );
    const errors = scope.kind === "exact"
      ? [{ field: "scope_kind", message: "Exact configuration belongs in entity Settings." }]
      : [];
    if (errors.length) return NextResponse.json({ error: "Validation failed", errors }, { status: 422 });
    return NextResponse.json({ models: await getScopeModelConfigs(scope), scope });
  } catch (error) {
    if (error instanceof ModelConfigValidationFailure) {
      return NextResponse.json({ error: "Validation failed", errors: error.errors }, { status: 422 });
    }
    throw error;
  }
}
