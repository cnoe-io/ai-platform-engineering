/**
 * Deterministic Webex meeting-series discovery through the configured
 * `webex_meetings` MCP server. No Webex REST calls live in Tome's BFF.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/api-error";
import { resolveMcpHeaderCredentials } from "@/lib/mcp-credential-headers";
import {
  invokeDirectHttpMcpTool,
  invokeHttpMcpTool,
} from "@/lib/mcp-http-server-client";
import { getCollection } from "@/lib/mongodb";
import { collectForwardedCredentials } from "@/lib/projects/onboarding-providers";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";
import type { MCPServerConfig } from "@/types/dynamic-agent";
import type {
  AutoIngestCredentialOwner,
  WebexMeetingSeriesSourceRefs,
  WebexMeetingSeriesSubscription,
} from "@/types/projects";

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
  state?: string;
  source: "meetings_api" | "userhub_calendar";
}

export interface WebexMeetingSeriesCandidate {
  seriesKey: string;
  title: string;
  hostEmail?: string;
  siteUrl?: string;
  sourceRefs: WebexMeetingSeriesSourceRefs;
  sources: Array<"meetings_api" | "userhub_calendar">;
  nextOccurrence?: WebexMeetingOccurrenceCandidate;
  occurrences: WebexMeetingOccurrenceCandidate[];
}

export interface WebexMeetingSeriesHostEligibility {
  canAutoIngest: boolean;
  unavailableReason?: string;
}

export function webexMeetingSeriesDiscoveryWindow(now = new Date()): {
  from: Date;
  to: Date;
  now: Date;
} {
  return {
    from: new Date(now.getTime() - 48 * 60 * 60 * 1000),
    to: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    now,
  };
}

export function createWebexMeetingSeriesSubscription({
  candidate,
  credentialOwner,
  existing = [],
  now = new Date(),
  id = randomUUID(),
}: {
  candidate: WebexMeetingSeriesCandidate;
  credentialOwner: AutoIngestCredentialOwner;
  existing?: WebexMeetingSeriesSubscription[];
  now?: Date;
  id?: string;
}): WebexMeetingSeriesSubscription {
  const baseSlug = meetingSeriesSlug(candidate.title, candidate.seriesKey);
  const stableSuffix = meetingSeriesSlug("", candidate.seriesKey).replace(/^meeting-/, "");
  let seriesSlug = baseSlug;
  let collision = 1;
  while (existing.some((item) => item.seriesSlug === seriesSlug)) {
    seriesSlug = `${baseSlug}-${stableSuffix}${collision > 1 ? `-${collision}` : ""}`;
    collision += 1;
  }
  return {
    id,
    enabled: true,
    seriesKey: candidate.seriesKey,
    seriesSlug,
    title: candidate.title,
    siteUrl: candidate.siteUrl,
    sourceRefs: candidate.sourceRefs,
    credentialOwner,
    createdAt: now.toISOString(),
    nextOccurrenceStartAt: candidate.nextOccurrence?.start,
    nextOccurrenceEndAt: candidate.nextOccurrence?.end,
    lastStatus: "pending",
  };
}

const HOST_REQUIRED_REASON =
  "You are not the meeting host. Auto-ingest can only process occurrences whose recording and transcript are available to your Webex account.";

/** Default-on policy switch for adding series hosted by another Webex user. */
export function nonHostMeetingSeriesAllowed(): boolean {
  const configured = process.env.TOME_WEBEX_ALLOW_NON_HOST_SERIES;
  if (configured === undefined || configured.trim() === "") return true;
  return ["1", "true", "yes", "on"].includes(configured.trim().toLowerCase());
}

export function meetingSeriesHostEligibility(
  candidate: WebexMeetingSeriesCandidate,
  callerEmail: string,
): WebexMeetingSeriesHostEligibility {
  const hostEmail = candidate.hostEmail?.trim().toLowerCase() ?? "";
  const normalizedCaller = callerEmail.trim().toLowerCase();
  if (hostEmail && normalizedCaller && hostEmail === normalizedCaller) {
    return { canAutoIngest: true };
  }
  return { canAutoIngest: false, unavailableReason: HOST_REQUIRED_REASON };
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
  ctx: { session: unknown; user: { email?: string } },
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

export function meetingSeriesMatches(
  candidate: WebexMeetingSeriesCandidate,
  stored: { seriesKey: string; sourceRefs: WebexMeetingSeriesSourceRefs },
): boolean {
  if (candidate.seriesKey === stored.seriesKey) return true;
  const left = candidate.sourceRefs;
  const right = stored.sourceRefs;
  if (left.meetingSeriesId && left.meetingSeriesId === right.meetingSeriesId) return true;
  if (left.userHubSeriesId && left.userHubSeriesId === right.userHubSeriesId) return true;
  if (left.scheduledMeetingId && left.scheduledMeetingId === right.scheduledMeetingId) return true;

  // A personal-room meeting number/link is not a series identity: several
  // unrelated recurring series can deliberately reuse it. Only use those
  // weak refs when the two records do not carry conflicting same-source IDs.
  if (
    (left.meetingSeriesId && right.meetingSeriesId) ||
    (left.userHubSeriesId && right.userHubSeriesId)
  ) {
    return false;
  }
  return Boolean(
    (left.meetingNumber && left.meetingNumber === right.meetingNumber) ||
      (normalizedWebLink(left.webLink) &&
        normalizedWebLink(left.webLink) === normalizedWebLink(right.webLink)),
  );
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

function hostEmailFromItem(item: Record<string, unknown>): string | undefined {
  return stringValue(item.hostEmail) || stringValue(item.organizerEmail) || undefined;
}

function occurrenceFromMeeting(
  item: Record<string, unknown>,
): WebexMeetingOccurrenceCandidate | null {
  const start = stringValue(item.start);
  const end = stringValue(item.end);
  const meetingType = stringValue(item.meetingType);
  if (!start || !end || meetingType === "meetingSeries") return null;
  // Only an actual `meeting` ID can own a transcript. A scheduledMeeting ID
  // represents calendar intent and must be resolved after the meeting occurs.
  const meetingId = meetingType === "meeting" ? stringValue(item.id) || undefined : undefined;
  const webLink = stringValue(item.webLink) || undefined;
  const state = stringValue(item.state);
  return {
    occurrenceKey:
      stringValue(item.id) ||
      `${normalizedWebLink(webLink)}:${stringValue(item.originalStartTime) || start}`,
    meetingId,
    title: stringValue(item.title) || "Untitled meeting",
    start,
    end,
    webLink,
    cancelled: ["cancelled", "canceled"].includes(state.toLowerCase()),
    state: state || undefined,
    source: "meetings_api",
  };
}

function isTimezoneAwareDate(value: string): boolean {
  return (
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function occurrenceFromUserHub(
  item: Record<string, unknown>,
): WebexMeetingOccurrenceCandidate | null {
  const start = stringValue(item.start);
  const end = stringValue(item.end);
  // User Hub calendar values are frequently local wall-clock timestamps.
  // Never let Node interpret an ambiguous value in the pod's UTC timezone.
  if (!start || !end || !isTimezoneAwareDate(start) || !isTimezoneAwareDate(end)) return null;
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

const CROSS_SOURCE_OCCURRENCE_TOLERANCE_MS = 30 * 60_000;

function nearbyCrossSourceOccurrence(
  existing: WebexMeetingOccurrenceCandidate,
  occurrence: WebexMeetingOccurrenceCandidate,
): boolean {
  if (existing.source === occurrence.source) return false;
  if (existing.title.trim().toLowerCase() !== occurrence.title.trim().toLowerCase()) return false;
  const existingStart = Date.parse(existing.start);
  const occurrenceStart = Date.parse(occurrence.start);
  return (
    Number.isFinite(existingStart) &&
    Number.isFinite(occurrenceStart) &&
    Math.abs(existingStart - occurrenceStart) <= CROSS_SOURCE_OCCURRENCE_TOLERANCE_MS
  );
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
        normalizedWebLink(existing.webLink) === normalizedWebLink(occurrence.webLink)) ||
      nearbyCrossSourceOccurrence(existing, occurrence),
  );
  if (duplicate < 0) candidate.occurrences.push(occurrence);
  else if (
    prefer ||
    (occurrence.source === "meetings_api" &&
      candidate.occurrences[duplicate]?.source !== "meetings_api")
  ) {
    candidate.occurrences[duplicate] = occurrence;
  }
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
  const scheduledMeetingCandidates = new Map<string, WebexMeetingSeriesCandidate>();
  const userHubSiteUrl = stringValue(recordValue(input.userHubCalendar)?.siteUrl) || undefined;

  const publicRows = [
    ...arrayItems(input.meetingSeries),
    ...arrayItems(input.scheduledMeetings),
    ...arrayItems(input.meetingInstances),
  ];
  for (const item of publicRows) {
    const refs = rawMeetingRefs(item);
    const seriesId = refs.meetingSeriesId;
    // Public Meetings API rows carry the durable meetingSeriesId. Do not
    // merge by meetingNumber/webLink: personal-room links are reused across
    // many separate recurring series.
    let candidate = seriesId
      ? candidates.find((existing) => existing.sourceRefs.meetingSeriesId === seriesId)
      : refs.scheduledMeetingId
        ? scheduledMeetingCandidates.get(refs.scheduledMeetingId)
        : undefined;
    // A one-off scheduled/actual meeting is not a recurring subscription.
    if (!candidate && !seriesId) continue;
    if (!candidate) {
      candidate = {
        seriesKey: `webex:${seriesId}`,
        title: stringValue(item.title) || "Untitled meeting series",
        hostEmail: hostEmailFromItem(item),
        siteUrl: stringValue(item.siteUrl) || undefined,
        sourceRefs: refs,
        sources: ["meetings_api"],
        occurrences: [],
      };
      candidates.push(candidate);
    } else {
      candidate.sourceRefs = mergeRefs(candidate.sourceRefs, refs);
      candidate.hostEmail = candidate.hostEmail || hostEmailFromItem(item);
      if (!candidate.sources.includes("meetings_api")) candidate.sources.push("meetings_api");
    }
    if (refs.scheduledMeetingId) scheduledMeetingCandidates.set(refs.scheduledMeetingId, candidate);
    addOccurrence(
      candidate,
      occurrenceFromMeeting(item),
      stringValue(item.meetingType) === "meeting",
    );
  }

  for (const item of arrayItems(input.userHubCalendar)) {
    const userHubSeriesId = stringValue(item.seriesId);
    const occurrenceType = stringValue(item.occurrenceType).toLowerCase();
    const refs: WebexMeetingSeriesSourceRefs = {
      userHubSeriesId: userHubSeriesId || undefined,
      webLink: stringValue(item.webLink) || undefined,
    };
    let candidate = userHubSeriesId
      ? candidates.find((existing) => existing.sourceRefs.userHubSeriesId === userHubSeriesId)
      : undefined;
    // User Hub often returns a concrete calendar occurrence without a stable
    // series id or recurrence marker. In that case, join it to a public
    // meetingSeries template by exact title + compatible organizer. This is
    // the key fallback for Webex templates that say "expired" even though the
    // user's calendar contains current recurring occurrences.
    if (!candidate) {
      const subject = stringValue(item.subject).trim().toLowerCase();
      const organizerEmail = hostEmailFromItem(item)?.trim().toLowerCase();
      const titleMatches = candidates.filter((existing) => {
        if (!subject || existing.title.trim().toLowerCase() !== subject) return false;
        const existingHost = existing.hostEmail?.trim().toLowerCase();
        return !organizerEmail || !existingHost || organizerEmail === existingHost;
      });
      // Ambiguous title/host matches must stay separate instead of silently
      // merging two distinct recurring series.
      if (titleMatches.length === 1) candidate = titleMatches[0];
    }
    if (!candidate && refs.webLink) {
      const webLink = normalizedWebLink(refs.webLink);
      const linkMatches = candidates.filter(
        (existing) => normalizedWebLink(existing.sourceRefs.webLink) === webLink,
      );
      if (linkMatches.length === 1) candidate = linkMatches[0];
    }
    const explicitlyRecurring =
      Boolean(userHubSeriesId) ||
      occurrenceType.includes("series") ||
      occurrenceType.includes("recurr");
    if (!candidate && !explicitlyRecurring) continue;
    if (!candidate) {
      const fallbackKey = userHubSeriesId || normalizedWebLink(refs.webLink);
      if (!fallbackKey) continue;
      candidate = {
        seriesKey: `userhub:${fallbackKey}`,
        title: stringValue(item.subject) || "Untitled meeting series",
        hostEmail: hostEmailFromItem(item),
        siteUrl: userHubSiteUrl,
        sourceRefs: refs,
        sources: ["userhub_calendar"],
        occurrences: [],
      };
      candidates.push(candidate);
    } else {
      candidate.sourceRefs = mergeRefs(candidate.sourceRefs, refs);
      candidate.hostEmail = candidate.hostEmail || hostEmailFromItem(item);
      candidate.siteUrl = candidate.siteUrl || userHubSiteUrl;
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
  const resolved = await resolveOccurrenceMeeting(invoke, occurrence);
  return resolved.meetingId;
}

export async function resolveOccurrenceMeeting(
  invoke: Invoke,
  occurrence: WebexMeetingOccurrenceCandidate,
): Promise<{ meetingId: string | null; missed: boolean }> {
  if (occurrence.state?.toLowerCase() === "missed") {
    return { meetingId: null, missed: true };
  }
  if (occurrence.meetingId) return { meetingId: occurrence.meetingId, missed: false };
  if (!occurrence.webLink) return { meetingId: null, missed: false };
  const resolved = await invoke("webex_resolve_meeting_link", {
    web_link: occurrence.webLink,
    max_results: 20,
  });
  const items = arrayItems(resolved);
  const actualMeetings = items.filter((item) => stringValue(item.meetingType) === "meeting");
  const exact =
    actualMeetings.find((item) => stringValue(item.start) === occurrence.start) ??
    actualMeetings[0];
  if (exact) return { meetingId: stringValue(exact.id) || null, missed: false };
  const scheduledMeetings = items.filter(
    (item) => stringValue(item.meetingType) === "scheduledMeeting",
  );
  const scheduled =
    scheduledMeetings.find((item) => stringValue(item.start) === occurrence.start) ??
    scheduledMeetings[0];
  return {
    meetingId: null,
    missed: stringValue(scheduled?.state).toLowerCase() === "missed",
  };
}

export async function downloadMeetingTranscript(
  invoke: Invoke,
  lookup:
    | string
    | {
        meetingId?: string | null;
        title: string;
        start: string;
        siteUrl?: string;
      },
): Promise<{
  transcript: string;
  meetingId?: string;
  transcriptId?: string;
  transcriptIds: string[];
  listedTranscriptIds: string[];
  listedCount: number;
  downloadedCount: number;
} | null> {
  const meetingId = typeof lookup === "string" ? lookup : lookup.meetingId || undefined;
  const payload = await invoke("webex_list_transcripts", {
    ...(meetingId ? { meeting_id: meetingId } : {}),
    ...(typeof lookup === "string"
      ? {}
      : {
          meeting_title: lookup.title,
          meeting_start: lookup.start,
          ...(lookup.siteUrl ? { site_url: lookup.siteUrl } : {}),
        }),
    max_results: 100,
    download: true,
    download_format: "txt",
  });
  const items = arrayItems(payload);
  if (!items.length) return null;

  const segments = items
    .map((item, originalIndex) => ({
      body: stringValue(item.body),
      id: stringValue(item.id),
      meetingId: stringValue(item.meetingId),
      originalIndex,
      startTime: stringValue(item.startTime),
    }))
    .filter((item) => item.body)
    .sort((left, right) => {
      const leftTime = Date.parse(left.startTime);
      const rightTime = Date.parse(right.startTime);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
        return Number.isFinite(leftTime) ? -1 : 1;
      }
      return left.id.localeCompare(right.id) || left.originalIndex - right.originalIndex;
    });
  const transcript =
    segments.length === 1
      ? segments[0].body
      : segments
          .map((segment, index) => {
            const timing = segment.startTime ? ` · ${segment.startTime}` : "";
            return `--- Webex transcript segment ${index + 1} of ${segments.length}${timing} ---\n${segment.body}`;
          })
          .join("\n\n");
  const transcriptIds = segments.map((item) => item.id).filter(Boolean);
  const listedTranscriptIds = items.map((item) => stringValue(item.id)).filter(Boolean).sort();
  const resolvedMeetingId = segments.find((item) => item.meetingId)?.meetingId || meetingId;

  return {
    transcript,
    meetingId: resolvedMeetingId,
    transcriptId: transcriptIds[0],
    transcriptIds,
    listedTranscriptIds,
    listedCount: items.length,
    downloadedCount: segments.length,
  };
}
