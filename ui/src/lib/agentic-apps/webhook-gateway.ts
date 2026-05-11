// assisted-by Codex Codex-sonnet-4-6

import { createHash, randomUUID } from "node:crypto";

import { buildPdpDecisionRecord, decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import {
  appendAppTokenGrant,
  appendPdpDecision,
  appendWebhookDelivery,
  listAppInstallations,
  listAppPackages,
} from "@/lib/agentic-apps/store";
import { mintAppScopedToken } from "@/lib/agentic-apps/tokens";
import type {
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageRecord,
  AgenticAppWebhookChannel,
} from "@/types/agentic-app";

export type ForwardAgenticAppWebhookInput = {
  appId: string;
  provider: string;
  channel: string;
  request: Request;
};

const HOST_CONTROLLED_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "connection",
  "transfer-encoding",
  "te",
  "trailer",
  "x-caipe-app-id",
  "x-caipe-decision-id",
  "x-correlation-id",
]);

export async function forwardAgenticAppWebhook(
  input: ForwardAgenticAppWebhookInput,
): Promise<Response> {
  const correlationId = input.request.headers.get("x-correlation-id") ?? randomUUID();
  const receivedAt = new Date().toISOString();
  const deliveryBase = {
    deliveryId: randomUUID(),
    appId: input.appId,
    provider: input.provider,
    channel: input.channel,
    receivedAt,
    correlationId,
  };

  const [installations, packages] = await Promise.all([listAppInstallations(), listAppPackages()]);
  const installation = installations.find((candidate) => candidate.appId === input.appId) ?? null;
  const pkg =
    installation !== null
      ? packages.find((candidate) => candidate.packageId === installation.packageId) ?? null
      : null;
  const hook = pkg?.manifest.webhooks?.find(
    (candidate) => candidate.provider === input.provider && candidate.channel === input.channel,
  );

  if (!installation || !pkg || !hook) {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "denied",
      bodySha256: "",
      completedAt: new Date().toISOString(),
      httpStatus: 404,
    });
    return Response.json({ error: "webhook_not_found" }, { status: 404 });
  }

  const method = input.request.method.toUpperCase();
  if (!hook.allowedMethods.includes(method as "POST" | "PUT")) {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "denied",
      bodySha256: "",
      completedAt: new Date().toISOString(),
      httpStatus: 405,
    });
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const hostCheck = checkWebhookHostState(installation, pkg.manifest);
  if (hostCheck) {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "denied",
      bodySha256: "",
      completedAt: new Date().toISOString(),
      httpStatus: hostCheck.status,
    });
    return Response.json({ error: hostCheck.error }, { status: hostCheck.status });
  }

  const body = Buffer.from(await input.request.arrayBuffer());
  const bodySha256 = createHash("sha256").update(body).digest("hex");
  if (body.byteLength > hook.maxBodyBytes) {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "dropped",
      bodySha256,
      completedAt: new Date().toISOString(),
      httpStatus: 413,
    });
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const action = hook.policyAction ?? `webhook.${hook.provider}.${hook.channel}`;
  const decision = decideAgenticAppPdp({
    action,
    user: { email: "webhook@caipe.local", name: "Webhook Gateway", role: "system" },
    session: { role: "system" },
    pkg,
    installation,
    scopes: pkg.manifest.access.tokenScopes,
    skipUserAccess: true,
    metadata: {
      provider: hook.provider,
      channel: hook.channel,
      method,
      bodySha256,
    },
  });
  await appendPdpDecision(
    buildPdpDecisionRecord({
      appId: input.appId,
      action,
      decision,
      correlationId,
      method,
      route: input.request.url,
    }),
  );
  if (decision.effect !== "allow") {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "denied",
      bodySha256,
      decisionId: decision.decisionId,
      completedAt: new Date().toISOString(),
      httpStatus: 403,
    });
    return Response.json(
      { error: "pdp_denied", decisionId: decision.decisionId, reasonCode: decision.reasonCode },
      { status: 403 },
    );
  }

  const token = await mintAppScopedToken({
    appId: input.appId,
    subject: `webhook:${input.provider}:${input.channel}`,
    scopes: decision.scopes,
    decisionId: decision.decisionId,
    correlationId,
  });
  await appendAppTokenGrant({
    jti: token.jti,
    decisionId: decision.decisionId,
    correlationId,
    appId: input.appId,
    audience: token.audience,
    scopes: decision.scopes,
    issuedAt: new Date().toISOString(),
    expiresAt: token.expiresAt,
    subject: { type: "webhook", provider: input.provider, channel: input.channel },
    tokenHash: token.tokenHash,
  });

  let upstream: Response;
  try {
    upstream = await fetch(buildWebhookTargetUrl(installation, pkg, hook), {
      method,
      headers: buildWebhookForwardHeaders(input.request.headers, hook, {
        appId: input.appId,
        token: token.token,
        decisionId: decision.decisionId,
        correlationId,
        bodySha256,
      }),
      body: toArrayBuffer(body),
      redirect: "manual",
    });
  } catch {
    await appendWebhookDelivery({
      ...deliveryBase,
      status: "failed",
      bodySha256,
      decisionId: decision.decisionId,
      completedAt: new Date().toISOString(),
      httpStatus: 502,
      safeHeaders: collectSafeHeaders(input.request.headers, hook),
    });
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  await appendWebhookDelivery({
    ...deliveryBase,
    status: upstream.ok ? "forwarded" : "failed",
    bodySha256,
    decisionId: decision.decisionId,
    completedAt: new Date().toISOString(),
    httpStatus: upstream.status,
    safeHeaders: collectSafeHeaders(input.request.headers, hook),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "x-caipe-decision-id": decision.decisionId,
      "x-correlation-id": correlationId,
    },
  });
}

function checkWebhookHostState(
  installation: AgenticAppInstallationRecord,
  manifest: AgenticAppManifest,
): { status: number; error: string } | null {
  if (!installation.installed || !installation.enabled) {
    return { status: 404, error: "webhook_not_found" };
  }
  const health = installation.runtimeHealth ?? "unknown";
  const blockWhen = installation.healthPolicy?.blockLaunchWhen ?? manifest.health.blockLaunchWhen ?? [];
  if (blockWhen.includes(health)) {
    return { status: 403, error: "app_unhealthy" };
  }
  return null;
}

function buildWebhookTargetUrl(
  installation: AgenticAppInstallationRecord,
  pkg: AgenticAppPackageRecord,
  hook: AgenticAppWebhookChannel,
): string {
  const origin = installation.runtimeOriginOverride ?? pkg.manifest.runtime.origin;
  if (!origin) {
    throw new Error("webhook runtime origin is missing");
  }
  return new URL(hook.upstreamPath, origin).toString();
}

function buildWebhookForwardHeaders(
  source: Headers,
  hook: AgenticAppWebhookChannel,
  input: {
    appId: string;
    token: string;
    decisionId: string;
    correlationId: string;
    bodySha256: string;
  },
): Headers {
  const headers = new Headers();
  const preserved = new Set((hook.preservedHeaders ?? []).map((header) => header.toLowerCase()));
  source.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOST_CONTROLLED_HEADERS.has(lower)) {
      return;
    }
    if (lower === "content-type" || preserved.has(lower)) {
      headers.set(key, value);
    }
  });
  headers.set("authorization", `Bearer ${input.token}`);
  headers.set("x-caipe-app-id", input.appId);
  headers.set("x-caipe-decision-id", input.decisionId);
  headers.set("x-correlation-id", input.correlationId);
  headers.set("x-caipe-body-sha256", input.bodySha256);
  return headers;
}

function collectSafeHeaders(source: Headers, hook: AgenticAppWebhookChannel): Record<string, string> {
  const out: Record<string, string> = {};
  const preserved = new Set((hook.preservedHeaders ?? []).map((header) => header.toLowerCase()));
  source.forEach((value, key) => {
    if (preserved.has(key.toLowerCase())) {
      out[key.toLowerCase()] = value;
    }
  });
  return out;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
