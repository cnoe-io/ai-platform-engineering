/**
 * API proxy route for Dynamic Agents (Agent Runtime) health check.
 *
 * Proxies to the dynamic-agents backend /healthz endpoint and normalizes
 * the response to { status: "healthy" | "unhealthy" }.
 *
 * GET /api/dynamic-agents/health
 */

import { NextResponse } from "next/server";
import { getServerConfig } from "@/lib/config";

export async function GET(): Promise<Response> {
  const config = getServerConfig();

  if (!config.dynamicAgentsEnabled) {
    return NextResponse.json({ status: "unhealthy", reason: "disabled" });
  }

  const dynamicAgentsUrl = config.dynamicAgentsUrl;
  if (!dynamicAgentsUrl) {
    return NextResponse.json({ status: "unhealthy", reason: "not configured" });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${dynamicAgentsUrl}/healthz`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return NextResponse.json({
        status: data.status === "healthy" ? "healthy" : "unhealthy",
      });
    }

    return NextResponse.json({ status: "unhealthy" });
  } catch {
    return NextResponse.json({ status: "unhealthy" });
  }
}
