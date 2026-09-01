/**
 * Deterministic Webex meeting-series discovery through the configured
 * `webex_meetings` MCP server. No Webex REST calls live in Tome's BFF.
 */

import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api-middleware";
import { resolveMcpHeaderCredentials } from "@/lib/mcp-credential-headers";
import {
  invokeDirectHttpMcpTool,
  invokeHttpMcpTool,
} from "@/lib/mcp-http-server-client";
import { getCollection } from "@/lib/mongodb";
import { collectForwardedCredentials } from "@/lib/projects/onboarding-providers";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import type { MCPServerConfig } from "@/types/dynamic-agent";
import type { WebexMeetingSeriesSourceRefs } from "@/types/projects";

import type { TomeProjectContext } from "./tome-api";

const SERVER_ID = "webex_meetings";
const PROVIDER = "webex_meetings";

export function meetingSeriesSlug(title: string, seriesKey: string): string {
  const titleSlug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (titleSlug) return titleSlug;
  return `meeting-${createStableSuffix(seriesKey)}`;
}

function createStableSuffix(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export interface WebexMeetingOccurrenceCandidate {
  occurrenceKey: string;
  meetingId?: string;
  title: string;
  start: string;
  end: string;
  webLink?: string;
  cancelled: boolean;
  source: "meetings_api" | "userhub_calendar";
}

export interface WebexMeetingSeriesCandidate {
  seriesKey: string;
  title: string;
  siteUrl?: string;
  sourceRefs: WebexMeetingSeriesSourceRefs;
  sources: Array<"meetings_api" | "userhub_calendar">;
  nextOccurrence?: WebexMeetingOccurrenceCandidate;
  occurrences: WebexMeetingOccurrenceCandidate[];
}

type Invoke = (toolName: string, params: Record<string, unknown>) => Promise<unknown>;

/** FastMCP exposes each typed Webex request model as the `args` tool parameter. */
export function webexMcpToolArguments(
  params: Record<string, unknown>,
): { args: Record<string, unknown> } {
  return { args: params };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayItems(payload: unknown): Record<string, unknown>[] {
  const record = recordValue(payload);
  const items = Array.isArray(record?.items) ? record.items : [];
  return items.map(recordValue).filter((item): item is Record<string, unknown> => Boolean(item));
}

/** Pull the application payload out of a JSON-RPC MCP tools/call response. */
export function readMcpToolJson(payload: unknown): unknown {
  const rpc = recordValue(payload);
  const rpcError = recordValue(rpc?.error);
  if (rpcError) {
    throw new ApiError(
      stringValue(rpcError.message) || "Webex Meetings MCP tool failed",
      502,
      "WEBEX_MEETINGS_MCP_ERROR",
    );
  }
  const result = recordValue(rpc?.result) ?? rpc;
  if (!result) return payload;
  if (result.isError === true) {
    const text = Array.isArray(result.content)
      ? result.content
          .map(recordValue)
          .map((item) => stringValue(item?.text))
          .find(Boolean)
      : "";
    throw new ApiError(text || "Webex Meetings MCP tool failed", 502, "WEBEX_MEETINGS_MCP_ERROR");
  }
  const structured = recordValue(result.structuredContent);
  if (structured) {
    // FastMCP may wrap a structured return value in `result`.
    const wrapped = structured.result ?? structured;
    if (typeof wrapped === "string") {
      try {
        return JSON.parse(wrapped);
      } catch {
        return wrapped;
      }
    }
    return wrapped;
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      const item = recordValue(block);
      if (item?.type !== "text") continue;
      const text = stringValue(item.text);
      if (!text) continue;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return result;
}

async function configuredServer(): Promise<MCPServerConfig & { endpoint: string }> {
  const servers = await getCollection<MCPServerConfig>("mcp_servers");
  const server = await servers.findOne({ _id: SERVER_ID });
  if (!server?.enabled) {
    throw new ApiError(
      "The normal Webex Meetings MCP server is not configured or enabled.",
      503,
      "WEBEX_MEETINGS_MCP_NOT_CONFIGURED",
    );
  }
  const endpoint =
    process.env.TOME_WEBEX_MEETINGS_MCP_URL?.trim() ||
    server.agentgateway_target_endpoint?.trim() ||
    server.endpoint?.trim();
  if (!endpoint) {
    throw new ApiError(
      "The Webex Meetings MCP server has no HTTP endpoint.",
      503,
      "WEBEX_MEETINGS_MCP_NOT_CONFIGURED",
    );
  }
  // Tome deliberately uses the dedicated normal Meetings connection. Do not
  // inherit an old webex/webex_pam credential mapping from a stale seed row.
  return {
    ...server,
    endpoint,
    source: "manual",
    agentgateway_discovered: false,
    credential_sources: [
      {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        provider: PROVIDER,
      },
    ],
  };
}

export async function interactiveWebexMeetingInvoker(
  request: NextRequest,
  ctx: TomeProjectContext,
): Promise<Invoke> {
  const server = await configuredServer();
  const session = ctx.session as ResourceAuthzSession & {
    sub?: string;
    accessToken?: string;
  };
  const credentialResolution = await resolveMcpHeaderCredentials({
    request,
    session,
    server,
    viaAgentGateway: false,
    retrievalCaller: "tome-webex-meeting-series",
  });
  if (!credentialResolution.sources.some((source) => source.origin === "provider_connection")) {
    throw new ApiError(
      "Connect Webex (Meetings) before selecting recurring meetings.",
      401,
      "WEBEX_MEETINGS_CONNECTION_REQUIRED",
    );
  }
  return async (toolName, params) => {
    const response = await invokeHttpMcpTool({
      request,
      session,
      server,
      serverId: SERVER_ID,
      toolName,
      params: webexMcpToolArguments(params),
      credentialResolution,
    });
    if (!response.ok) {
      throw new ApiError(
        `Webex Meetings MCP returned HTTP ${response.status}`,
        502,
        "WEBEX_MEETINGS_MCP_ERROR",
      );
    }
    return readMcpToolJson(response.payload);
  };
}

export async function backgroundWebexMeetingInvoker(ownerSubject: string): Promise<Invoke> {
  const server = await configuredServer();
  const credentials = await collectForwardedCredentials(ownerSubject, [PROVIDER]);
  const token = credentials[PROVIDER]?.access_token;
  if (!token) {
    throw new ApiError(
      "The subscription owner must reconnect Webex (Meetings).",
      401,
      "WEBEX_MEETINGS_CONNECTION_REQUIRED",
    );
  }
  return async (toolName, params) => {
    const response = await invokeDirectHttpMcpTool({
      endpoint: server.endpoint,
      toolName,
      params: webexMcpToolArguments(params),
      headers: { "X-CAIPE-Provider-Token": token },
      timeoutMs: toolName === "webex_list_transcripts" ? 75_000 : 30_000,
    });
    if (!response.ok) {
      throw new ApiError(
        `Webex Meetings MCP returned HTTP ${response.status}`,
        502,
        "WEBEX_MEETINGS_MCP_ERROR",
      );
    }
    return readMcpToolJson(response.payload);
  };
}

function normalizedWebLink(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function sourceRefValues(refs: WebexMeetingSeriesSourceRefs): string[] {
  return [
    refs.meetingSeriesId,
    refs.scheduledMeetingId,
    refs.userHubSeriesId,
    refs.meetingNumber,
    normalizedWebLink(refs.webLink),
  ]
    .map((value) => stringValue(value))
    .filter(Boolean);
}

export function meetingSeriesMatches(
  candidate: WebexMeetingSeriesCandidate,
  stored: { seriesKey: string; sourceRefs: WebexMeetingSeriesSourceRefs },
): boolean {
  if (candidate.seriesKey === stored.seriesKey) return true;
  const expected = new Set(sourceRefValues(stored.sourceRefs));
  return sourceRefValues(candidate.sourceRefs).some((value) => expected.has(value));
}

function rawMeetingRefs(item: Record<string, unknown>): WebexMeetingSeriesSourceRefs {
  const meetingType = stringValue(item.meetingType);
  return {
    meetingSeriesId:
      stringValue(item.meetingSeriesId) ||
      stringValue(item.seriesId) ||
      (meetingType === "meetingSeries" ? stringValue(item.id) : "") ||
      undefined,
    scheduledMeetingId:
      stringValue(item.scheduledMeetingId) ||
      (meetingType === "scheduledMeeting" ? stringValue(item.id) : "") ||
      undefined,
    meetingNumber: stringValue(item.meetingNumber) || undefined,
    webLink: stringValue(item.webLink) || undefined,
  };
}

function occurrenceFromMeeting(
  item: Record<string, unknown>,
): WebexMeetingOccurrenceCandidate | null {
  const start = stringValue(item.start);
  const end = stringValue(item.end);
  if (!start || !end || stringValue(item.meetingType) === "meetingSeries") return null;
  const meetingId = stringValue(item.id) || undefined;
  const webLink = stringValue(item.webLink) || undefined;
  return {
    occurrenceKey:
      meetingId ||
      `${normalizedWebLink(webLink)}:${stringValue(item.originalStartTime) || start}`,
    meetingId,
    title: stringValue(item.title) || "Untitled meeting",
    start,
    end,
    webLink,
    cancelled: ["cancelled", "canceled"].includes(stringValue(item.state).toLowerCase()),
    source: "meetings_api",
  };
}

function occurrenceFromUserHub(
  item: Record<string, unknown>,
): WebexMeetingOccurrenceCandidate | null {
  const start = stringValue(item.start);
  const end = stringValue(item.end);
  if (!start || !end) return null;
  const id = stringValue(item.id);
  const webLink = stringValue(item.webLink) || undefined;
  return {
    occurrenceKey:
      id || `${normalizedWebLink(webLink)}:${stringValue(item.originalStartTime) || start}`,
    title: stringValue(item.subject) || "Untitled meeting",
    start,
    end,
    webLink,
    cancelled:
      item.isCancelled === true || stringValue(item.isCancelled).toLowerCase() === "true",
    source: "userhub_calendar",
  };
}

function mergeRefs(
  left: WebexMeetingSeriesSourceRefs,
  right: WebexMeetingSeriesSourceRefs,
): WebexMeetingSeriesSourceRefs {
  return {
    meetingSeriesId: left.meetingSeriesId || right.meetingSeriesId,
    scheduledMeetingId: left.scheduledMeetingId || right.scheduledMeetingId,
    userHubSeriesId: left.userHubSeriesId || right.userHubSeriesId,
    meetingNumber: left.meetingNumber || right.meetingNumber,
    webLink: left.webLink || right.webLink,
  };
}

function addOccurrence(
  candidate: WebexMeetingSeriesCandidate,
  occurrence: WebexMeetingOccurrenceCandidate | null,
  prefer = false,
): void {
  if (!occurrence) return;
  const duplicate = candidate.occurrences.findIndex(
    (existing) =>
      existing.occurrenceKey === occurrence.occurrenceKey ||
      (existing.start === occurrence.start &&
        normalizedWebLink(existing.webLink) === normalizedWebLink(occurrence.webLink)),
  );
  if (duplicate < 0) candidate.occurrences.push(occurrence);
  else if (prefer) candidate.occurrences[duplicate] = occurrence;
}

/** Normalize and merge public Meetings API rows with User Hub calendar rows. */
export function normalizeMeetingSeries(input: {
  meetingSeries: unknown;
  scheduledMeetings: unknown;
  meetingInstances: unknown;
  userHubCalendar: unknown;
  now?: Date;
}): WebexMeetingSeriesCandidate[] {
  const now = input.now ?? new Date();
  const candidates: WebexMeetingSeriesCandidate[] = [];
  const userHubSiteUrl = stringValue(recordValue(input.userHubCalendar)?.siteUrl) || undefined;

  const findCandidate = (refs: WebexMeetingSeriesSourceRefs): WebexMeetingSeriesCandidate | undefined => {
    const values = new Set(sourceRefValues(refs));
    return candidates.find((candidate) =>
      sourceRefValues(candidate.sourceRefs).some((value) => values.has(value)),
    );
  };

  const publicRows = [
    ...arrayItems(input.meetingSeries),
    ...arrayItems(input.scheduledMeetings),
    ...arrayItems(input.meetingInstances),
  ];
  for (const item of publicRows) {
    const refs = rawMeetingRefs(item);
    const seriesId = refs.meetingSeriesId;
    let candidate = findCandidate(refs);
    // A one-off scheduled/actual meeting is not a recurring subscription.
    if (!candidate && !seriesId) continue;
    if (!candidate) {
      candidate = {
        seriesKey: `webex:${seriesId}`,
        title: stringValue(item.title) || "Untitled meeting series",
        siteUrl: stringValue(item.siteUrl) || undefined,
        sourceRefs: refs,
        sources: ["meetings_api"],
        occurrences: [],
      };
      candidates.push(candidate);
    } else {
      candidate.sourceRefs = mergeRefs(candidate.sourceRefs, refs);
      if (!candidate.sources.includes("meetings_api")) candidate.sources.push("meetings_api");
    }
    addOccurrence(
      candidate,
      occurrenceFromMeeting(item),
      stringValue(item.meetingType) === "meeting",
    );
  }

  for (const item of arrayItems(input.userHubCalendar)) {
    const userHubSeriesId = stringValue(item.seriesId);
    const occurrenceType = stringValue(item.occurrenceType).toLowerCase();
    if (!userHubSeriesId && !occurrenceType.includes("series") && !occurrenceType.includes("recurr")) {
      continue;
    }
    const refs: WebexMeetingSeriesSourceRefs = {
      userHubSeriesId: userHubSeriesId || undefined,
      webLink: stringValue(item.webLink) || undefined,
    };
    let candidate = findCandidate(refs);
    if (!candidate) {
      const fallbackKey = userHubSeriesId || normalizedWebLink(refs.webLink);
      if (!fallbackKey) continue;
      candidate = {
        seriesKey: `userhub:${fallbackKey}`,
        title: stringValue(item.subject) || "Untitled meeting series",
        siteUrl: userHubSiteUrl,
        sourceRefs: refs,
        sources: ["userhub_calendar"],
        occurrences: [],
      };
      candidates.push(candidate);
    } else {
      candidate.sourceRefs = mergeRefs(candidate.sourceRefs, refs);
      if (!candidate.sources.includes("userhub_calendar")) {
        candidate.sources.push("userhub_calendar");
      }
    }
    addOccurrence(candidate, occurrenceFromUserHub(item));
  }

  for (const candidate of candidates) {
    candidate.occurrences.sort((a, b) => a.start.localeCompare(b.start));
    candidate.nextOccurrence = candidate.occurrences.find(
      (occurrence) => !occurrence.cancelled && new Date(occurrence.end) > now,
    );
  }
  return candidates.sort((a, b) => {
    const aNext = a.nextOccurrence?.start ?? "9999";
    const bNext = b.nextOccurrence?.start ?? "9999";
    return aNext.localeCompare(bNext) || a.title.localeCompare(b.title);
  });
}

export async function discoverMeetingSeries(
  invoke: Invoke,
  input: { from: Date; to: Date; siteUrl?: string; now?: Date },
): Promise<WebexMeetingSeriesCandidate[]> {
  const common = {
    from_iso: input.from.toISOString(),
    to_iso: input.to.toISOString(),
    max_results: 100,
  };
  const results = await Promise.allSettled([
    invoke("webex_list_meetings", { meeting_type: "meetingSeries", max_results: 100 }),
    invoke("webex_list_meetings", { ...common, meeting_type: "scheduledMeeting" }),
    invoke("webex_list_meetings", { ...common, meeting_type: "meeting" }),
    invoke("webex_userhub_calendar", {
      ...common,
      ...(input.siteUrl ? { site_url: input.siteUrl } : {}),
      meeting_list_type: "All",
      max_results: 500,
    }),
  ]);
  if (results.every((result) => result.status === "rejected")) {
    throw results[0].status === "rejected" ? results[0].reason : new Error("Webex discovery failed");
  }
  const value = (index: number): unknown => {
    const result = results[index];
    return result?.status === "fulfilled" ? result.value : { items: [] };
  };
  return normalizeMeetingSeries({
    meetingSeries: value(0),
    scheduledMeetings: value(1),
    meetingInstances: value(2),
    userHubCalendar: value(3),
    now: input.now,
  });
}

export async function resolveOccurrenceMeetingId(
  invoke: Invoke,
  occurrence: WebexMeetingOccurrenceCandidate,
): Promise<string | null> {
  if (occurrence.meetingId) return occurrence.meetingId;
  if (!occurrence.webLink) return null;
  const resolved = await invoke("webex_resolve_meeting_link", {
    web_link: occurrence.webLink,
    max_results: 20,
  });
  const items = arrayItems(resolved);
  const exact = items.find((item) => stringValue(item.start) === occurrence.start) ?? items[0];
  return exact ? stringValue(exact.id) || null : null;
}

export async function downloadMeetingTranscript(
  invoke: Invoke,
  meetingId: string,
): Promise<{ transcript: string; transcriptId?: string } | null> {
  const payload = await invoke("webex_list_transcripts", {
    meeting_id: meetingId,
    max_results: 20,
    download: true,
    download_format: "txt",
  });
  const item = arrayItems(payload).find((candidate) => stringValue(candidate.body));
  if (!item) return null;
  return {
    transcript: stringValue(item.body),
    transcriptId: stringValue(item.id) || undefined,
  };
}
