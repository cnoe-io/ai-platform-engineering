import { successResponse,withErrorHandler } from "@/lib/api-middleware";
import {
  applyAgentToolOpenFgaSync,
  checkAgentToolOpenFgaSync,
} from "@/lib/rbac/agent-tool-openfga-sync";
import { NextRequest } from "next/server";

import { withOpenFgaAdminAuth,withOpenFgaViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => successResponse(await checkAgentToolOpenFgaSync()))
);

export const POST = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async () => successResponse(await applyAgentToolOpenFgaSync()))
);
