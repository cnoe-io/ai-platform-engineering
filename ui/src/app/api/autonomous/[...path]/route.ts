// Copyright CNOE Contributors (https://cnoe.io)
// SPDX-License-Identifier: Apache-2.0

import { NextRequest, NextResponse } from 'next/server';

import {
  withAuth,
  withErrorHandler,
  requireAdmin,
  requireAdminView,
  ApiError,
} from '@/lib/api-middleware';
import { getConfig } from '@/lib/config';

/**
 * Autonomous Agents API Proxy.
 *
 * Forwards every method (GET/POST/PUT/PATCH/DELETE) under
 * `/api/autonomous/<...path>` to the autonomous-agents FastAPI
 * service at `AUTONOMOUS_AGENTS_URL` (default `http://localhost:8002`).
 *
 * Why a proxy instead of calling the FastAPI service directly from the
 * browser:
 *   1. The autonomous-agents service binds to 8002 and isn't exposed
 *      publicly in any deployment topology -- the UI is the only
 *      sanctioned entry point.
 *   2. Auth lives at the Next.js boundary. We require a NextAuth
 *      session here and (eventually) forward the JWT downstream so
 *      the autonomous-agents service can pick up the same identity
 *      semantics as the RAG proxy. Today the service is
 *      localhost-only so we skip the Bearer step until the
 *      service-side auth (IMP-10) is shipped.
 *   3. Centralising the URL keeps the React side decoupled -- code
 *      always hits `/api/autonomous/...` regardless of where the
 *      backend physically runs.
 *
 * Authorization model (IMP-19):
 *   - Read endpoints (GET) require the OIDC **admin-view** role
 *     (`requireAdminView`). Operators and on-call responders need to
 *     see what's scheduled and inspect run history without being
 *     handed the keys to mutate config.
 *   - Mutation endpoints (POST/PUT/PATCH/DELETE) require the OIDC
 *     **admin** role (`requireAdmin`). This includes
 *     `POST /tasks/{id}/run`: triggering a run is a write-equivalent
 *     side effect (LLM cost, downstream actions) and must not be
 *     available to view-only users.
 *
 * Without these guards, any authenticated user could create / edit /
 * delete / fire autonomous tasks -- which is fine in a single-tenant
 * dev box but a real production gap once the UI is shared.
 */

/**
 * Base URL for the autonomous-agents service, **without** the API
 * version prefix. Operators set this to e.g.
 * ``http://localhost:8002`` or ``http://autonomous-agents:8002``;
 * the ``/api/v1`` segment is added by ``buildTargetUrl`` below so a
 * prefix bump (v2 etc.) only touches one constant.
 */
function getAutonomousAgentsUrl(): string {
  return (
    process.env.AUTONOMOUS_AGENTS_URL ||
    process.env.NEXT_PUBLIC_AUTONOMOUS_AGENTS_URL ||
    'http://localhost:8002'
  );
}

/**
 * FastAPI mounts both the tasks and webhooks routers under
 * ``/api/v1`` (see ``autonomous_agents/main.py``). We hard-code the
 * prefix here rather than baking it into the env var so:
 *   1. operators can copy/paste the same URL they'd use for a
 *      ``curl localhost:8002/healthz`` smoke test, AND
 *   2. an upstream version bump (v1 -> v2) is a one-line edit.
 */
const AUTONOMOUS_API_PREFIX = '/api/v1';

function buildTargetUrl(request: NextRequest, pathSegments: string[]): URL {
  const targetPath = pathSegments.join('/');
  // Strip a trailing slash on the env var so we don't end up with
  // ``//api/v1/tasks`` (some HTTP stacks tolerate it, others don't).
  const base = getAutonomousAgentsUrl().replace(/\/$/, '');
  const targetUrl = new URL(`${base}${AUTONOMOUS_API_PREFIX}/${targetPath}`);
  // Forward query parameters (the run-history endpoints don't take any
  // today, but future pagination params would otherwise be silently
  // dropped here).
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });
  return targetUrl;
}

async function readBody(request: NextRequest): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (!contentLength || parseInt(contentLength, 10) === 0) {
    return undefined;
  }
  try {
    return await request.json();
  } catch {
    // Some endpoints (manual trigger) accept an empty body; others
    // would reject malformed JSON downstream. Either way, surfacing
    // ``undefined`` here is correct -- we only forward a body if we
    // managed to parse one.
    return undefined;
  }
}

/**
 * Method → required role mapping. Kept as data so the auth gating
 * lives in one obvious place rather than being scattered across the
 * five HTTP verb handlers.
 */
type SupportedMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function enforceRole(
  method: SupportedMethod,
  session: { role?: string; canViewAdmin?: boolean },
): void {
  if (method === 'GET') {
    requireAdminView(session);
    return;
  }
  requireAdmin(session);
}

async function forward(
  request: NextRequest,
  pathSegments: string[],
  method: SupportedMethod,
): Promise<NextResponse> {
  if (!getConfig('autonomousAgentsEnabled')) {
    throw new ApiError('Autonomous agents are disabled', 404);
  }

  return await withAuth(request, async (_req, _user, session) => {
    enforceRole(method, session);

    const targetUrl = buildTargetUrl(request, pathSegments);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };
    if (method !== 'GET' && method !== 'DELETE') {
      const body = await readBody(request);
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }
    }

    try {
      const response = await fetch(targetUrl.toString(), fetchOptions);

      // 204 No Content -- pass through verbatim so the UI sees a clean
      // success without a body parse attempt.
      if (response.status === 204) {
        return new NextResponse(null, { status: 204 });
      }

      // The autonomous-agents service always replies in JSON, but read
      // as text first so we can surface a useful error envelope even if
      // the upstream returned a non-JSON body (e.g. on a crash).
      const text = await response.text();
      if (!text) {
        return new NextResponse(null, { status: response.status });
      }
      try {
        const data = JSON.parse(text);
        return NextResponse.json(data, { status: response.status });
      } catch {
        return NextResponse.json(
          { error: 'Upstream returned non-JSON response', body: text.slice(0, 500) },
          { status: response.status },
        );
      }
    } catch (error) {
      console.error(`[Autonomous Proxy] ${method} ${targetUrl} failed:`, error);
      // Map upstream connectivity failures to ``ApiError`` so they
      // flow through the shared ``withErrorHandler`` envelope and we
      // don't leak ``error.toString()`` shapes that vary by Node
      // version.
      throw new ApiError(
        `Failed to reach autonomous-agents service: ${
          error instanceof Error ? error.message : String(error)
        }`,
        502,
      );
    }
  });
}

export const GET = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params;
  return forward(request, path, 'GET');
});

export const POST = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params;
  return forward(request, path, 'POST');
});

export const PUT = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params;
  return forward(request, path, 'PUT');
});

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params;
  return forward(request, path, 'PATCH');
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) => {
  const { path } = await context.params;
  return forward(request, path, 'DELETE');
});
