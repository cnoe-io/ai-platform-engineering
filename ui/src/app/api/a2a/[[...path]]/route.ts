import { getInternalA2AUrl } from "@/lib/config";

// assisted-by Codex GPT-5.5
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
  "x-request-id",
  "x-user-email",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "x-accel-buffering",
] as const;

function buildSupervisorUrl(baseUrl: string, path: string[] | undefined, requestUrl: string): string {
  const encodedPath = (path ?? []).map((segment) => encodeURIComponent(segment)).join("/");
  const suffix = encodedPath ? `/${encodedPath}` : "/";
  const search = new URL(requestUrl).search;
  return `${baseUrl}${suffix}${search}`;
}

function forwardedRequestHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function forwardedResponseHeaders(response: Response): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  return headers;
}

async function proxyA2ARequest(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const targetUrl = buildSupervisorUrl(getInternalA2AUrl(), path, request.url);
  const method = request.method.toUpperCase();

  try {
    const response = await fetch(targetUrl, {
      method,
      headers: forwardedRequestHeaders(request),
      body: method === "GET" || method === "HEAD" ? undefined : request.body,
      cache: "no-store",
      redirect: "manual",
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: forwardedResponseHeaders(response),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown supervisor proxy error";
    return Response.json(
      { error: "supervisor_unreachable", message },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxyA2ARequest(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxyA2ARequest(request, context);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-headers": "authorization,content-type,x-request-id,x-user-email",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}
