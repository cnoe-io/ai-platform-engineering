import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getRbacCollection } from "@/lib/rbac/mongo-collections";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { applyIdentityGroupSyncPlan } from "@/lib/rbac/identity-group-sync-reconciler";
import type { IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

import { withIdentityGroupSyncAdminAuth } from "../_lib";

interface ApplyBody {
  dry_run?: IdentityGroupSyncDryRunResult;
  reviewed?: boolean;
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - identity group sync requires MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  return withIdentityGroupSyncAdminAuth(request, async () => {
    const body = (await request.json()) as ApplyBody;
    if (!body.reviewed || !body.dry_run) {
      throw new ApiError("reviewed=true and dry_run are required before applying sync", 400);
    }
    if (body.dry_run.conflicts.length > 0) {
      throw new ApiError("Cannot apply identity group sync while conflicts are present", 409);
    }

    const now = new Date().toISOString();
    const result = await applyIdentityGroupSyncPlan({
      plan: body.dry_run,
      actor: "api",
      now,
    });

    const run = {
      id: randomUUID(),
      status: "applied",
      created_at: now,
      updated_at: now,
      result,
      dry_run: body.dry_run,
    };
    const runs = await getRbacCollection("identityGroupSyncRuns");
    await runs.insertOne(run);

    return successResponse({ run, result });
  });
});
