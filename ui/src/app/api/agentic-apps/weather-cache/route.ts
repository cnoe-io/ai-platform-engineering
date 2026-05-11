/**
 * Mongo-backed cache for the last successful Weather dashboard pull.
 *
 * Stores weather.dashboard.v1 output only. Provider credentials and tool
 * configuration stay in the agent/MCP runtime and are never accepted here.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withAuth,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";

const COLLECTION_NAME = "agentic_app_dashboard_cache";
const APP_ID = "weather";
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_RUN_HISTORY = 12;

interface WeatherDashboardRun {
  runId: string;
  appId: "weather";
  ownerId: string;
  agentId: string;
  city: string;
  intent: string;
  unit: string;
  payload: Record<string, unknown>;
  lastAgentMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface WeatherDashboardCacheDoc extends WeatherDashboardRun {
  _id: string;
  runs?: WeatherDashboardRun[];
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user) => {
    const collection = await getCollection<WeatherDashboardCacheDoc>(COLLECTION_NAME);
    const doc = await collection.findOne({
      appId: "weather",
      ownerId: user.email,
    });

    const items = normalizeRuns(doc);
    return successResponse({ item: items[0] ?? null, items });
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user) => {
    const body = await request.json();
    const payload = body?.payload;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ApiError("payload is required", 400);
    }

    const serializedPayload = JSON.stringify(payload);
    if (Buffer.byteLength(serializedPayload, "utf8") > MAX_PAYLOAD_BYTES) {
      throw new ApiError("payload is too large", 413);
    }

    const now = new Date().toISOString();
    const collection = await getCollection<WeatherDashboardCacheDoc>(COLLECTION_NAME);
    const existing = await collection.findOne({
      appId: "weather",
      ownerId: user.email,
    });

    const run: WeatherDashboardRun = {
      runId: `${APP_ID}:${Date.now()}`,
      appId: "weather",
      ownerId: user.email,
      agentId: sanitizeShortString(body.agentId, "agent-weather-agent"),
      city: sanitizeShortString(body.city, "San Jose"),
      intent: sanitizeShortString(body.intent, "forecast-summary"),
      unit: sanitizeShortString(body.unit, "fahrenheit"),
      payload,
      lastAgentMessage: sanitizeOptionalString(body.lastAgentMessage, 64 * 1024),
      createdAt: now,
      updatedAt: now,
    };
    const runs = [run, ...normalizeRuns(existing)].slice(0, MAX_RUN_HISTORY);
    const latest = runs[0] ?? run;

    const doc: WeatherDashboardCacheDoc = {
      ...latest,
      _id: existing?._id ?? `${APP_ID}:${user.email}`,
      createdAt: existing?.createdAt ?? latest.createdAt,
      updatedAt: latest.updatedAt,
      runs,
    };

    await collection.replaceOne(
      { appId: "weather", ownerId: user.email },
      doc,
      { upsert: true },
    );

    return successResponse({ item: doc });
  });
});

function normalizeRuns(doc: WeatherDashboardCacheDoc | null): WeatherDashboardRun[] {
  if (!doc) return [];
  if (Array.isArray(doc.runs) && doc.runs.length > 0) {
    return doc.runs.slice(0, MAX_RUN_HISTORY);
  }
  const legacyRun: WeatherDashboardRun = {
    runId: `${APP_ID}:legacy:${doc.updatedAt || doc.createdAt || "latest"}`,
    appId: "weather",
    ownerId: doc.ownerId,
    agentId: doc.agentId,
    city: doc.city,
    intent: doc.intent,
    unit: doc.unit,
    payload: doc.payload,
    lastAgentMessage: doc.lastAgentMessage,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  return [legacyRun];
}

function sanitizeShortString(value: unknown, fallback: string): string {
  const normalized = String(value ?? fallback).trim().slice(0, 128);
  return normalized || fallback;
}

function sanitizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value).slice(0, maxLength);
}
