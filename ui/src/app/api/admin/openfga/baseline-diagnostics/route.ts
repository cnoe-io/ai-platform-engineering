import { NextRequest } from "next/server";
import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import { baselineDiagnosticChecks, getBaselineFgaProfile } from "@/lib/rbac/baseline-access";
import { withOpenFgaViewAuth } from "../_lib";

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const subject = new URL(request.url).searchParams.get("userId")?.trim();
    if (!subject) {
      throw new ApiError("userId is required", 400);
    }

    const profile = await getBaselineFgaProfile();
    const checks = await Promise.all(
      baselineDiagnosticChecks(subject, profile).map(async (check) => {
        const result = await checkOpenFgaTuple(check.tuple);
        return {
          ...check,
          actual: result.allowed,
          matches_member: result.allowed === check.expected_member,
          matches_admin: result.allowed === check.expected_admin,
        };
      })
    );

    return successResponse({
      user_id: subject,
      summary: {
        total: checks.length,
        matches_member: checks.filter((check) => check.matches_member).length,
        matches_admin: checks.filter((check) => check.matches_admin).length,
        member_drift: checks.filter((check) => !check.matches_member).length,
        admin_drift: checks.filter((check) => !check.matches_admin).length,
      },
      checks,
    });
  })
);
