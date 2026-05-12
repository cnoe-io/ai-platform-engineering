import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
  requireAdmin,
} from "@/lib/api-middleware";

interface PolicyDocument {
  name: string;
  content: string;
  is_system: boolean;
  updated_at: Date;
  updated_by?: string;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Policy storage requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, _user, session) => {
    const collection = await getCollection<PolicyDocument>("policies");
    const policy = await collection.findOne({ name: "default" });

    if (!policy) {
      return successResponse({
        name: "default",
        content: "",
        is_system: true,
        exists: false,
      });
    }

    return successResponse({
      name: policy.name,
      content: policy.content,
      is_system: policy.is_system,
      updated_at: policy.updated_at,
      updated_by: policy.updated_by,
      exists: true,
    });
  });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Policy storage requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, user, session) => {
    requireAdmin(session);

    const body = await request.json();

    if (typeof body.content !== "string") {
      throw new ApiError("'content' field (string) is required", 400);
    }

    const collection = await getCollection<PolicyDocument>("policies");

    await collection.updateOne(
      { name: "default" },
      {
        $set: {
          content: body.content,
          updated_at: new Date(),
          updated_by: user.email,
        },
        $setOnInsert: {
          name: "default",
          is_system: true,
        },
      },
      { upsert: true }
    );

    return successResponse({ message: "Policy updated successfully" });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Policy storage requires MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action !== "reset") {
      throw new ApiError("Only action=reset is supported", 400);
    }

    const candidates = [
      process.env.POLICY_SEED_PATH,
      "/app/policy.lp",
      resolve(process.cwd(), "policy.lp"),
      resolve(process.cwd(), "..", "policy.lp"),
      resolve(process.cwd(), "..", "charts", "ai-platform-engineering", "data", "policy.lp"),
    ].filter(Boolean) as string[];

    let content: string | null = null;
    for (const candidate of candidates) {
      try {
        content = readFileSync(candidate, "utf-8");
        break;
      } catch {
        continue;
      }
    }

    if (!content) {
      throw new ApiError(
        "Cannot reset: no policy.lp file found on disk",
        404
      );
    }

    const collection = await getCollection<PolicyDocument>("policies");
    await collection.updateOne(
      { name: "default" },
      {
        $set: {
          content,
          updated_at: new Date(),
          updated_by: "system",
        },
        $setOnInsert: {
          name: "default",
          is_system: true,
        },
      },
      { upsert: true }
    );

    return successResponse({ message: "Policy reset to default from file" });
  });
});
