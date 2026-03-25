import { NextRequest, NextResponse } from "next/server";
import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";
import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  ApiError,
} from "@/lib/api-middleware";
import { ObjectId } from "mongodb";

/**
 * Skill Hubs API — Admin endpoints for managing external skill hubs.
 *
 * GET  /api/skill-hubs       — List all registered hubs (admin only)
 * POST /api/skill-hubs       — Register a new hub (admin only)
 *
 * Per contracts/skill-hubs-api.md
 */

interface SkillHubDoc {
  _id?: ObjectId;
  id: string;
  type: "github" | "gitlab";
  location: string;
  enabled: boolean;
  credentials_ref: string | null;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_message: string | null;
  created_at: string;
  updated_at: string;
}

function sanitizeHub(doc: SkillHubDoc) {
  const { _id, ...rest } = doc;
  return rest;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    return NextResponse.json({ hubs: [] });
  }

  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const collection = await getCollection<SkillHubDoc>("skill_hubs");
    const hubs = await collection.find().sort({ created_at: 1 }).toArray();

    return NextResponse.json({ hubs: hubs.map(sanitizeHub) });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  if (!isMongoDBConfigured) {
    throw new ApiError("Skill hubs require MongoDB to be configured", 503);
  }

  return await withAuth(request, async (_req, _user, session) => {
    requireAdmin(session);

    const body = await request.json();

    // Validate required fields
    const { type, location } = body;
    if (!type || !location) {
      throw new ApiError("Missing required fields: type, location", 400);
    }
    if (!["github", "gitlab"].includes(type)) {
      throw new ApiError(
        `Unsupported hub type: ${type}. Supported: "github", "gitlab".`,
        400,
      );
    }
    if (typeof location !== "string" || !location.includes("/")) {
      throw new ApiError(
        `Invalid location format. Expected "${type === "gitlab" ? "group/project" : "owner/repo"}".`,
        400,
      );
    }

    // Normalize full URLs to owner/repo format (users may paste a GitHub URL)
    let normalizedLocation = location.trim();
    try {
      const url = new URL(normalizedLocation);
      if (url.hostname === "github.com" || url.hostname === "gitlab.com" || url.hostname === "www.github.com") {
        const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (segments.length >= 2) {
          normalizedLocation = `${segments[0]}/${segments[1]}`;
        }
      }
    } catch {
      // Not a URL — keep as-is (already owner/repo format)
    }

    const collection = await getCollection<SkillHubDoc>("skill_hubs");

    // Check for duplicate location (use normalized)
    const existing = await collection.findOne({ location: normalizedLocation });
    if (existing) {
      throw new ApiError(
        `A hub with location "${location}" is already registered.`,
        409,
      );
    }

    const now = new Date().toISOString();
    const hubDoc: SkillHubDoc = {
      id: new ObjectId().toHexString(),
      type,
      location: normalizedLocation,
      enabled: body.enabled !== false,
      credentials_ref: body.credentials_ref || null,
      last_success_at: null,
      last_failure_at: null,
      last_failure_message: null,
      created_at: now,
      updated_at: now,
    };

    await collection.insertOne(hubDoc as any);

    return NextResponse.json(sanitizeHub(hubDoc), { status: 201 });
  });
});
