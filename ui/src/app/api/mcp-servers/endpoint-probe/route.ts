/**
 * Probe MCP endpoint URLs before saving a server.
 */

// assisted-by Codex Codex-sonnet-4-6

import {
ApiError,
getAuthFromBearerOrSession,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { caipeOrgKey } from "@/lib/rbac/organization";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { NextRequest } from "next/server";

interface ProbeAttempt {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

function normalizedUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("Endpoint URL is required", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ApiError("Endpoint URL must be a valid URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiError("Endpoint URL must use http or https", 400);
  }
  return parsed.toString().replace(/\/$/, "");
}

function mcpVariant(url: string): string | null {
  const parsed = new URL(url);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  return `${url.replace(/\/$/, "")}/mcp`;
}

async function probe(url: string): Promise<ProbeAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json, text/event-stream;q=0.9, */*;q=0.1" },
    });
    return {
      url,
      ok: response.status < 500 && response.status !== 404,
      status: response.status,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireResourcePermission(
    session,
    { type: "organization", id: caipeOrgKey(), action: "use" },
    { bypassForOrgAdmin: true },
  );

  const body = await request.json();
  const url = normalizedUrl(body.url);
  const attempts: ProbeAttempt[] = [await probe(url)];
  const variant = mcpVariant(url);
  if (variant && variant !== url) {
    attempts.push(await probe(variant));
  }
  const suggestedUrl = attempts[0]?.ok ? undefined : attempts.find((attempt) => attempt.ok)?.url;

  return successResponse({
    attempts,
    suggestedUrl,
  });
});
