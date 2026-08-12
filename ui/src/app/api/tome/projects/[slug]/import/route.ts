import { NextRequest } from "next/server";

import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { convertDocumentImport } from "@/lib/tome/document-import";
import {
  MAX_IMPORT_FILES,
  MAX_IMPORT_TOTAL_BYTES,
} from "@/lib/tome/document-import-formats";
import { auditTome, tomeActorFromAuth } from "@/lib/tome/audit";
import { getPageStore } from "@/lib/tome/page-store";
import {
  guardNotLocked,
  loadTomeProject,
  requireTomeEditor,
} from "@/lib/tome/tome-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

function asFiles(values: FormDataEntryValue[]): File[] {
  return values.filter((value): value is File => typeof value !== "string");
}

/** Import Markdown, text, HTML, DOCX, or PDF documents as stable wiki pages. */
export const POST = withErrorHandler(async (request: NextRequest, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const tctx = await loadTomeProject(request, slug);
  requireTomeEditor(tctx);
  await guardNotLocked(tctx.projectId, tctx.project.locked ?? false);

  const form = await request.formData();
  const files = asFiles(form.getAll("files"));
  const requestedPaths = form.getAll("paths").map(String);
  if (files.length === 0) {
    throw new ApiError("At least one import file is required", 400, "BAD_REQUEST");
  }
  if (files.length > MAX_IMPORT_FILES) {
    throw new ApiError(
      `Import at most ${MAX_IMPORT_FILES} files at a time`,
      413,
      "IMPORT_TOO_LARGE",
    );
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
    throw new ApiError(
      `Combined import size exceeds ${MAX_IMPORT_TOTAL_BYTES / 1024 / 1024} MB`,
      413,
      "IMPORT_TOO_LARGE",
    );
  }

  const converted = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      converted.push(
        await convertDocumentImport({
          sourcePath: requestedPaths[index] || file.name,
          data: Buffer.from(await file.arrayBuffer()),
        }),
      );
    }
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "Document conversion failed",
      400,
      "IMPORT_CONVERSION_FAILED",
    );
  }

  const pages: Record<string, string> = {};
  for (const item of converted) {
    if (pages[item.path] !== undefined) {
      throw new ApiError(
        `Multiple files resolve to the same page path: ${item.path}`,
        409,
        "IMPORT_PATH_CONFLICT",
      );
    }
    pages[item.path] = item.markdown;
  }

  const store = await getPageStore();
  await store.writePages(tctx.projectId, pages, {
    author: tctx.user.email ?? "tome",
    message: `import ${converted.length} document${converted.length === 1 ? "" : "s"}`,
  });

  auditTome({
    action: "tome.page.import",
    actor: tomeActorFromAuth({ user: tctx.user, session: tctx.session }),
    projectSlug: slug,
    metadata: {
      paths: converted.map((item) => item.path),
      formats: files.map((file) => file.name.split(".").pop()?.toLowerCase() ?? "unknown"),
    },
  });

  return successResponse({
    imported: converted.map((item) => ({
      path: item.path,
      warnings: item.warnings,
    })),
  });
});
