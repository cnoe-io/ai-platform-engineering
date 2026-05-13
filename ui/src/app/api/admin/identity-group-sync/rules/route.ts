import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import {
  listIdentityGroupSyncRules,
  upsertIdentityGroupSyncRule,
} from "@/lib/rbac/identity-group-sync-rule-store";
import type { IdentityGroupSyncRule } from "@/types/identity-group-sync";

import { withIdentityGroupSyncAdminAuth, withIdentityGroupSyncViewAuth } from "../_lib";

function mongoUnavailable() {
  return NextResponse.json(
    {
      success: false,
      error: "MongoDB not configured - identity group sync requires MongoDB",
      code: "MONGODB_NOT_CONFIGURED",
    },
    { status: 503 }
  );
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return mongoUnavailable();

  return withIdentityGroupSyncViewAuth(request, async () => {
    const providerId = request.nextUrl.searchParams.get("provider_id") ?? undefined;
    const rules = await listIdentityGroupSyncRules(providerId);
    return successResponse({ rules, total: rules.length });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) return mongoUnavailable();

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const body = (await request.json()) as Partial<IdentityGroupSyncRule>;
    if (!body.provider_id || !body.name) {
      throw new ApiError("provider_id and name are required", 400);
    }

    const now = new Date().toISOString();
    const rule: IdentityGroupSyncRule = {
      id: body.id ?? randomUUID(),
      provider_id: body.provider_id,
      name: body.name,
      priority: Number(body.priority ?? 100),
      enabled: Boolean(body.enabled ?? false),
      review_status: body.review_status ?? "dry_run_required",
      include_patterns: body.include_patterns ?? [],
      exclude_patterns: body.exclude_patterns ?? [],
      team_name_template: body.team_name_template ?? "{{team}}",
      team_slug_template: body.team_slug_template ?? "{{team}}",
      role_map: body.role_map ?? { Users: "member", Admins: "admin" },
      auto_create_team: Boolean(body.auto_create_team ?? true),
      default_relationship_policy_ids: body.default_relationship_policy_ids,
      created_by: body.created_by ?? "api",
      created_at: body.created_at ?? now,
      updated_by: body.updated_by ?? "api",
      updated_at: now,
    };
    await upsertIdentityGroupSyncRule(rule);
    return successResponse({ rule }, 201);
  });
});
