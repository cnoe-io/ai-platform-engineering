import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { TOME_MCP_OIDC_PROOF_HEADER } from "@/lib/tome/oidc-jwt";

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 100;
const KEEPALIVE_MS = 15_000;
const encoder = new TextEncoder();

export interface TomeMcpSseSession {
  id: string;
  ownerSub: string;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  keepAlive: ReturnType<typeof setInterval> | null;
  expiresAt: number;
  closed: boolean;
}

const sessions = new Map<string, TomeMcpSseSession>();

export function publicOrigin(request: NextRequest): string {
  return (
    process.env.TOME_PUBLIC_ORIGIN ||
    process.env.NEXTAUTH_URL ||
    new URL(request.url).origin
  ).replace(/\/$/, "");
}

export function mcpSseHeaders(contentType: string): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Caipe-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-transform",
    "Content-Type": contentType,
    "X-Accel-Buffering": "no",
  };
}

export function createTomeMcpSseSession(ownerSub: string): TomeMcpSseSession | null {
  if (sessions.size >= MAX_SESSIONS) return null;

  const session: TomeMcpSseSession = {
    id: randomUUID(),
    ownerSub,
    controller: null,
    keepAlive: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
    closed: false,
  };
  sessions.set(session.id, session);
  return session;
}

export function getTomeMcpSseSession(id: string): TomeMcpSseSession | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.closed || session.expiresAt <= Date.now()) {
    closeTomeMcpSseSession(session);
    return null;
  }
  return session;
}

export function closeTomeMcpSseSession(session: TomeMcpSseSession): void {
  if (session.closed) return;
  session.closed = true;
  if (session.keepAlive) clearInterval(session.keepAlive);
  session.keepAlive = null;
  sessions.delete(session.id);
  try {
    session.controller?.close();
  } catch {
    // The client may have already disconnected.
  }
  session.controller = null;
}

export function writeTomeMcpSseEvent(
  session: TomeMcpSseSession,
  event: string,
  data: unknown,
): boolean {
  if (session.closed || !session.controller) return false;
  try {
    session.controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
    return true;
  } catch {
    closeTomeMcpSseSession(session);
    return false;
  }
}

export function writeTomeMcpSseEndpoint(
  session: TomeMcpSseSession,
  endpoint: string,
): boolean {
  if (session.closed || !session.controller) return false;
  try {
    session.controller.enqueue(
      encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`),
    );
    return true;
  } catch {
    closeTomeMcpSseSession(session);
    return false;
  }
}

export function writeTomeMcpSseComment(
  session: TomeMcpSseSession,
  comment: string,
): boolean {
  if (session.closed || !session.controller) return false;
  try {
    session.controller.enqueue(encoder.encode(`: ${comment}\n\n`));
    return true;
  } catch {
    closeTomeMcpSseSession(session);
    return false;
  }
}

export function createTomeMcpSseStream(
  session: TomeMcpSseSession,
  endpoint: string,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      session.controller = controller;
      writeTomeMcpSseEndpoint(session, endpoint);
      session.keepAlive = setInterval(() => {
        if (!writeTomeMcpSseComment(session, "keepalive")) {
          closeTomeMcpSseSession(session);
        }
      }, KEEPALIVE_MS);
    },
    cancel() {
      closeTomeMcpSseSession(session);
    },
  });
}

export function forwardMcpHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authorization = request.headers.get("Authorization");
  const cookie = request.headers.get("cookie");
  const tomeApiKey = request.headers.get("X-Caipe-Token");
  const oidcProof = request.headers.get(TOME_MCP_OIDC_PROOF_HEADER);
  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.cookie = cookie;
  if (tomeApiKey) headers["X-Caipe-Token"] = tomeApiKey;
  if (oidcProof) headers[TOME_MCP_OIDC_PROOF_HEADER] = oidcProof;
  return headers;
}

export function mcpInternalOrigin(request: NextRequest): string {
  return (process.env.TOME_INTERNAL_ORIGIN || new URL(request.url).origin).replace(
    /\/$/,
    "",
  );
}
