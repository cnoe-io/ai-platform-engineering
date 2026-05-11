// assisted-by Codex Codex-sonnet-4-6

import { NextRequest, NextResponse } from "next/server";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { ApiError, withAuth, withErrorHandler } from "@/lib/api-middleware";
import { evaluateAppAccess } from "@/lib/agentic-apps/access";
import { buildPublicAgenticAppDetailPayload } from "@/lib/agentic-apps/public-detail-dto";
import { requireAgenticAppsInstallEnabled } from "@/lib/agentic-apps/guard";
import { listAppInstallations, listAppPackages } from "@/lib/agentic-apps/store";
import type { AgenticAppHealthStatus } from "@/types/agentic-app";

export const GET = withErrorHandler<unknown>(
  async (request: NextRequest, context: { params: Promise<{ appId: string }> }) => {
    requireAgenticAppsInstallEnabled();
    if (!isMongoDBConfigured) {
      throw new ApiError("MongoDB is required for Agentic Apps", 503);
    }
    const { appId } = await context.params;

    return withAuth(request, async (_req, user, session) => {
      const [installations, packages] = await Promise.all([
        listAppInstallations(),
        listAppPackages(),
      ]);

      const installation = installations.find((i) => i.appId === appId) ?? null;
      const pkg =
        installation !== null
          ? packages.find((p) => p.packageId === installation.packageId) ?? null
          : null;

      if (!installation || !pkg) {
        return NextResponse.json({ error: "app_not_found" }, { status: 404 });
      }

      const accessResult = evaluateAppAccess({
        user,
        session,
        pkg,
        installation,
      });

      const runtimeStatus: AgenticAppHealthStatus = installation.runtimeHealth ?? "unknown";

      return NextResponse.json(
        buildPublicAgenticAppDetailPayload({
          pkg,
          installation,
          accessResult,
          runtimeStatus,
        }),
      );
    });
  },
);
