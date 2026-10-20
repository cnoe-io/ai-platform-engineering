import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import type { AuthResult } from "@/lib/da-proxy";

export interface HarnessEngineConfig {
  url: string;
  internalToken: string;
  storageBinding?: string;
}

/** Configuration guard only: separate service credentials/options do not change database ownership. */
export function canonicalMongoStorageBinding(uri: string, database: string): string {
  const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)/i.exec(uri);
  if (!match) throw new Error("A valid MongoDB connection URI is required");
  const hosts = match[2].slice(match[2].lastIndexOf("@") + 1).split(",").map((host) => host.toLowerCase().replace(/:27017$/, "")).sort();
  return createHash("sha256").update(JSON.stringify([match[1].toLowerCase(), hosts, database])).digest("hex");
}

export function isHarnessEngineConfigured(): boolean {
  return Boolean(
    process.env.HARNESS_ENGINE_URL?.trim() &&
      process.env.HARNESS_ENGINE_INTERNAL_TOKEN?.trim(),
  );
}

export function getHarnessEngineConfig(): HarnessEngineConfig | NextResponse {
  const url = process.env.HARNESS_ENGINE_URL?.trim().replace(/\/$/, "");
  const internalToken = process.env.HARNESS_ENGINE_INTERNAL_TOKEN?.trim();

  if (!url || !internalToken) {
    return NextResponse.json(
      { success: false, error: "Harness Engine is not configured" },
      { status: 503 },
    );
  }
  const uri = process.env.MONGODB_URI;
  const database = process.env.MONGODB_DATABASE;
  const storageBinding = uri && database ? canonicalMongoStorageBinding(uri, database) : undefined;
  return { url, internalToken, storageBinding };
}

export function buildHarnessEngineHeaders(
  config: HarnessEngineConfig,
  auth: Pick<AuthResult, "subject" | "traceparent">,
  contentType = "application/json",
): Record<string, string> | NextResponse {
  if (!auth.subject) {
    return NextResponse.json(
      { success: false, error: "A stable caller subject is required" },
      { status: 401 },
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${config.internalToken}`,
    "Content-Type": contentType,
    "X-Harness-Engine-Subject": auth.subject,
  };
  if (config.storageBinding) headers["X-Harness-Engine-Storage-Binding"] = config.storageBinding;
  if (auth.traceparent) headers.traceparent = auth.traceparent;
  return headers;
}

export async function proxyHarnessEngine(
  config: HarnessEngineConfig,
  auth: Pick<AuthResult, "subject" | "traceparent">,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = buildHarnessEngineHeaders(config, auth);
  if (headers instanceof NextResponse) return headers;

  try {
    const response = await fetch(`${config.url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[harness-engine] Backend request failed", error);
    return NextResponse.json(
      { success: false, error: "Harness Engine is unavailable" },
      { status: 503 },
    );
  }
}

export async function proxyHarnessEngineStream(
  config: HarnessEngineConfig,
  auth: Pick<AuthResult, "subject" | "traceparent">,
  path: string,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = buildHarnessEngineHeaders(config, auth);
  if (headers instanceof NextResponse) return headers;
  headers.Accept = "text/event-stream";

  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
      });
    }
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (signal?.aborted) {
      return new Response(null, { status: 499 });
    }
    console.error("[harness-engine] Event subscription failed", error);
    return NextResponse.json(
      { success: false, error: "Harness Engine is unavailable" },
      { status: 503 },
    );
  }
}
