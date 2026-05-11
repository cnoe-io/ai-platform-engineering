/**
 * Mongo-backed cache for the last successful FinOps dashboard pull.
 *
 * Stores dashboard output only. AWS credentials stay in agent/MCP runtime
 * configuration and are never accepted by this route.
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
const APP_ID = "finops";
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_RUN_HISTORY = 12;

interface FinOpsDashboardRun {
  runId: string;
  appId: "finops";
  ownerId: string;
  agentId: string;
  dashboardKind: string;
  lookbackDays: number | null;
  payload: {
    currency?: string;
    totalCost?: number | null;
    forecastCost?: number | null;
    services?: Array<{ name: string; amount: number }>;
    trend?: Array<{ date: string; amount: number }>;
    rawCost?: Array<{
      date: string;
      service: string;
      account?: string;
      amount: number;
      unit?: string;
    }>;
    anomalies?: Array<{
      service: string;
      impact?: number | null;
      explanation?: string;
    }>;
    recommendations?: string[];
  };
  lastAgentMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface FinOpsDashboardCacheDoc extends FinOpsDashboardRun {
  _id: string;
  runs?: FinOpsDashboardRun[];
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, user) => {
    const collection = await getCollection<FinOpsDashboardCacheDoc>(COLLECTION_NAME);
    const doc = await collection.findOne({
      appId: "finops",
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
    const collection = await getCollection<FinOpsDashboardCacheDoc>(COLLECTION_NAME);
    const existing = await collection.findOne({
      appId: "finops",
      ownerId: user.email,
    });

    const run: FinOpsDashboardRun = {
      runId: `${APP_ID}:${Date.now()}`,
      appId: "finops",
      ownerId: user.email,
      agentId: sanitizeShortString(body.agentId, "agent-aws-cost-explorer"),
      dashboardKind: sanitizeShortString(body.dashboardKind, "cost-overview"),
      lookbackDays: normalizeLookbackDays(body.lookbackDays),
      payload,
      lastAgentMessage: sanitizeOptionalString(body.lastAgentMessage, 64 * 1024),
      createdAt: now,
      updatedAt: now,
    };
    const runs = [run, ...normalizeRuns(existing)].slice(0, MAX_RUN_HISTORY);
    const latest = runs[0] ?? run;

    const doc: FinOpsDashboardCacheDoc = {
      ...latest,
      _id: existing?._id ?? `${APP_ID}:${user.email}`,
      createdAt: existing?.createdAt ?? latest.createdAt,
      updatedAt: latest.updatedAt,
      runs,
    };

    await collection.replaceOne(
      { appId: "finops", ownerId: user.email },
      doc,
      { upsert: true },
    );

    return successResponse({ item: doc });
  });
});

function normalizeRuns(doc: FinOpsDashboardCacheDoc | null): FinOpsDashboardRun[] {
  if (!doc) return [];
  if (Array.isArray(doc.runs) && doc.runs.length > 0) {
    return doc.runs.slice(0, MAX_RUN_HISTORY);
  }
  const legacyRun: FinOpsDashboardRun = {
    runId: `${APP_ID}:legacy:${doc.updatedAt || doc.createdAt || "latest"}`,
    appId: "finops",
    ownerId: doc.ownerId,
    agentId: doc.agentId,
    dashboardKind: doc.dashboardKind,
    lookbackDays: doc.lookbackDays,
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

function normalizeLookbackDays(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 366) return null;
  return Math.round(numeric);
}
