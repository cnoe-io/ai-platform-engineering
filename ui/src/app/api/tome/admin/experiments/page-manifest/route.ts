import { ObjectId } from "mongodb";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth-config";
import { getCollection } from "@/lib/mongodb";
import { isTomeAdmin } from "@/lib/rbac/tome-admin";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import { getPageStore } from "@/lib/tome/page-store";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";
import type { ProjectDocument } from "@/types/projects";

export const dynamic = "force-dynamic";

function pageOrigin(path: string): "wiki" | "github" | "confluence" | "webex" | "template" {
  if (path.startsWith("repos/")) return "github";
  if (path.startsWith("confluence/")) return "confluence";
  if (path.startsWith("webex/")) return "webex";
  return "wiki";
}

export async function GET(request: NextRequest) {
  if (!isTomeServerEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !(await isTomeAdmin(session))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const entityId = request.nextUrl.searchParams.get("entity_id")?.trim();
  if (!entityId) {
    return NextResponse.json({ error: "entity_id is required" }, { status: 400 });
  }
  const projects = await getCollection<ProjectDocument>("projects");
  const selector = ObjectId.isValid(entityId)
    ? { _id: new ObjectId(entityId) as never }
    : { slug: entityId };
  const project = await projects.findOne(selector);
  if (!project) return NextResponse.json({ error: "TOME entity not found" }, { status: 404 });
  const projectId = String(project._id);
  const [pages, templates] = await Promise.all([
    getPageStore().then((store) => store.listPages(projectId)),
    getAllPageTemplates(),
  ]);
  const entries = new Map(Object.entries(pages).map(([path, markdown]) => [path, {
    path,
    characters: markdown.length,
    origin: pageOrigin(path),
    exists: true,
  }]));
  for (const page of templates.find((template) => template.scope === "top-level")?.pages ?? []) {
    if (page.enabled === false || entries.has(page.path)) continue;
    entries.set(page.path, {
      path: page.path,
      characters: 0,
      origin: "template",
      exists: false,
    });
  }
  return NextResponse.json({
    data: {
      entity_id: projectId,
      paths: [...entries.values()].sort((left, right) => left.path.localeCompare(right.path)),
    },
  });
}
