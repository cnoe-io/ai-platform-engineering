// assisted-by Codex Codex-sonnet-4-6

import { forwardAgenticAppWebhook } from "@/lib/agentic-apps/webhook-gateway";

type WebhookRouteContext = {
  params: Promise<{
    appId: string;
    provider: string;
    channel: string;
  }>;
};

export async function POST(request: Request, context: WebhookRouteContext): Promise<Response> {
  return handleWebhook(request, context);
}

export async function PUT(request: Request, context: WebhookRouteContext): Promise<Response> {
  return handleWebhook(request, context);
}

async function handleWebhook(
  request: Request,
  context: WebhookRouteContext,
): Promise<Response> {
  const params = await context.params;
  return forwardAgenticAppWebhook({
    appId: params.appId,
    provider: params.provider,
    channel: params.channel,
    request,
  });
}
