import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import { readFileSync } from "fs";
import { NextRequest } from "next/server";
import { join } from "path";

interface PolicyDocument {
  name: string;
  content: string;
  is_system: boolean;
  updated_at: Date;
}

export const runtime = "nodejs";

function findPolicyFile(): string | null {
  const candidates = [
    process.env.POLICY_SEED_PATH,
    "/app/policy.lp",
    join(/*turbopackIgnore: true*/ process.cwd(), "policy.lp"),
    join(/*turbopackIgnore: true*/ process.cwd(), "..", "policy.lp"),
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      "..",
      "charts",
      "ai-platform-engineering",
      "data",
      "policy.lp",
    ),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Policy storage requires MongoDB to be configured", 503);
  }

  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");

  const collection = await getCollection<PolicyDocument>("policies");

  const existing = await collection.findOne({ name: "default" });
  if (existing) {
    return successResponse({
      seeded: false,
      message: "Default policy already exists",
    });
  }

  const filePath = findPolicyFile();
  if (!filePath) {
    return successResponse({
      seeded: false,
      message: "No policy.lp found. Set POLICY_SEED_PATH or mount at /app/policy.lp",
    });
  }

  const content = readFileSync(filePath, "utf-8");

  await collection.insertOne({
    name: "default",
    content,
    is_system: true,
    updated_at: new Date(),
  });

  return successResponse({
    seeded: true,
    message: `Seeded default policy from ${filePath}`,
  });
});
