/** Install a TOME GitHub issue webhook using the caller's delegated token. */

import { NextRequest } from "next/server";

import {
  ApiError,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  createGitHubClient,
  GitHubClientError,
} from "@/lib/github-webhooks/client";
import { TOME_GITHUB_WEBHOOK_EVENTS } from "@/lib/github-webhooks/events";
import {
  projectGitHubRepos,
  resolveTomeGitHubCredential,
} from "@/lib/tome/github-issue-scope";
import { loadTomeProject, requireTomeEditor } from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

interface SubscribeRequest {
  repo?: unknown;
}

export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);

  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? "";
  if (
    process.env.TOME_GITHUB_WEBHOOK_ENABLED !== "true" ||
    secret.length < 8
  ) {
    throw new ApiError(
      "GitHub webhook ingestion is not configured on this CAIPE deployment",
      503,
      "GITHUB_WEBHOOK_NOT_CONFIGURED",
    );
  }

  let body: SubscribeRequest = {};
  try {
    body = (await request.json()) as SubscribeRequest;
  } catch {
    // An empty body is valid when the project has exactly one repository.
  }
  const attached = projectGitHubRepos(tctx.project);
  const requested = typeof body.repo === "string" ? body.repo.trim() : "";
  const fullName = requested || (attached.length === 1 ? attached[0] : "");
  if (!fullName || !attached.includes(fullName)) {
    throw new ApiError(
      "Choose one GitHub repository attached directly to this TOME project",
      400,
      "GITHUB_REPOSITORY_REQUIRED",
    );
  }

  const callbackUrl = webhookCallbackUrl(request);
  const credential = await resolveTomeGitHubCredential(tctx);
  if (!credential.token) {
    throw new ApiError(
      "Connect a GitHub account with repository administration access",
      503,
      "GITHUB_CREDENTIAL_MISSING",
    );
  }

  const [owner, repo] = fullName.split("/");
  try {
    const github = createGitHubClient({ authToken: credential.token });
    const metadata = await github.getRepoMetadata(owner, repo);
    if (!metadata.permissions?.admin) {
      throw new ApiError(
        "GitHub repository administration access is required to install a webhook",
        403,
        "GITHUB_ADMIN_REQUIRED",
      );
    }
    const hooks = await github.listRepoWebhooks(owner, repo);
    const existing = hooks.find((hook) => hook.config.url === callbackUrl);
    const expectedEvents = [...TOME_GITHUB_WEBHOOK_EVENTS];
    const needsUpdate = Boolean(
      existing &&
      (!existing.active ||
        expectedEvents.some((event) => !existing.events.includes(event))),
    );
    const hook =
      existing && needsUpdate
        ? await github.updateRepoWebhook(owner, repo, existing.id, {
            callbackUrl,
            secret,
            events: expectedEvents,
          })
        : existing ??
          (await github.createRepoWebhook(owner, repo, {
            callbackUrl,
            secret,
            events: expectedEvents,
          }));

    return successResponse(
      {
        repo: metadata.full_name,
        created: !existing,
        updated: needsUpdate,
        webhookId: hook.id,
        callbackUrl,
        events: TOME_GITHUB_WEBHOOK_EVENTS,
        settingsUrl: `https://github.com/${metadata.full_name}/settings/hooks/${hook.id}`,
      },
      existing ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof GitHubClientError) {
      throw new ApiError(
        error.message,
        error.status ?? 502,
        `GITHUB_${error.code.toUpperCase()}`,
      );
    }
    throw error;
  }
});

function webhookCallbackUrl(request: NextRequest): string {
  const configured = process.env.TOME_GITHUB_WEBHOOK_URL?.trim();
  const url = new URL(configured || "/api/webhooks/github", request.nextUrl.origin);
  if (url.username || url.password) {
    throw new ApiError("Invalid GitHub webhook callback URL", 503, "BAD_WEBHOOK_URL");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new ApiError(
      "The production GitHub webhook callback must use HTTPS",
      503,
      "BAD_WEBHOOK_URL",
    );
  }
  const isCanonicalIngress = url.pathname.endsWith("/api/webhooks/github");
  const isConfiguredHttpsRelay =
    Boolean(configured) &&
    url.protocol === "https:" &&
    url.pathname === "/github";
  if (!isCanonicalIngress && !isConfiguredHttpsRelay) {
    throw new ApiError("Invalid GitHub webhook callback path", 503, "BAD_WEBHOOK_URL");
  }
  return url.toString();
}
