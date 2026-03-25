import { NextRequest } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";

/**
 * POST /api/agent-skills/import-github
 *
 * Fetches all files under a GitHub directory (excluding SKILL.md) and returns
 * them as a `Record<string, string>` so the UI can merge them into the
 * agent-config's `ancillary_files` field before saving.
 *
 * Body: { repo: "owner/repo", path: "skills/my-skill", credentials_ref?: string }
 */

export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (_req, _user) => {
    const body = await request.json();
    const repo: string = body.repo?.trim();
    const dirPath: string = body.path?.trim();
    const credentialsRef: string | undefined = body.credentials_ref;

    if (!repo || !dirPath) {
      throw new ApiError("Both 'repo' (owner/repo) and 'path' are required", 400);
    }

    const token =
      (credentialsRef ? process.env[credentialsRef] : undefined) ||
      process.env.GITHUB_TOKEN ||
      "";
    const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const treeUrl = `${apiBase}/repos/${repo}/git/trees/HEAD?recursive=1`;
    const treeResp = await fetch(treeUrl, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!treeResp.ok) {
      throw new ApiError(`GitHub tree fetch failed: ${treeResp.status}`, 502);
    }
    const tree = await treeResp.json();

    const prefix = dirPath.replace(/\/$/, "") + "/";
    const blobs: string[] = [];
    for (const item of tree.tree ?? []) {
      const p = (item.path as string).replace(/\\/g, "/");
      if (item.type === "blob" && p.startsWith(prefix) && !p.endsWith("SKILL.md")) {
        blobs.push(p);
      }
    }

    const files: Record<string, string> = {};
    for (const blobPath of blobs) {
      const rel = blobPath.slice(prefix.length);
      try {
        const contUrl = `${apiBase}/repos/${repo}/contents/${blobPath}`;
        const r = await fetch(contUrl, {
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) continue;
        const data = await r.json();
        files[rel] = Buffer.from(data.content ?? "", "base64").toString("utf-8");
      } catch {
        // skip files that fail to fetch
      }
    }

    return successResponse({ files, count: Object.keys(files).length });
  });
});
