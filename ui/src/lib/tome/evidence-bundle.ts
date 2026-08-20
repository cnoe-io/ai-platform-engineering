/** Build the immutable evidence snapshot shared by both experiment candidates. */

import { randomUUID } from "node:crypto";

import { buildSnapshotFromProject } from "@/lib/tome/agent-proxy";
import { githubRepoSlug } from "@/lib/projects/github-repository";
import { getPageStore } from "@/lib/tome/page-store";
import { getAllPageTemplates } from "@/lib/tome/page-templates-store";
import type { ProjectDocument } from "@/types/projects";
import type { EvidenceBundle, EvidenceItem, EvidenceKind } from "@/types/tome-evaluation";

import { insertEvidenceBundle, sha256, stableJson } from "./evaluation-store";

function item(
  kind: EvidenceKind,
  canonicalUri: string,
  content: string,
  capturedAt: string,
  pagePath?: string,
  workspaceProjectId?: string,
): EvidenceItem {
  return {
    id: sha256(`${kind}\n${canonicalUri}`),
    kind,
    canonical_uri: canonicalUri,
    content_hash: sha256(content),
    content,
    ...(pagePath ? { page_path: pagePath } : {}),
    ...(workspaceProjectId ? { workspace_project_id: workspaceProjectId } : {}),
    captured_at: capturedAt,
  };
}

function pageEvidenceKind(path: string): EvidenceKind {
  if (path.startsWith("repos/")) return "github";
  if (path.startsWith("confluence/")) return "confluence";
  if (path.startsWith("webex/")) return "webex";
  return "wiki";
}

function canonicalPageUri(
  project: ProjectDocument,
  path: string,
): string {
  const [root, sourceSlug, ...rest] = path.split("/");
  const sourcePath = rest.join("/");
  if (root === "repos" && sourceSlug) {
    const source = project.sources?.github_repos?.find(
      (repo) => githubRepoSlug(repo) === sourceSlug || repo.full_name === sourceSlug,
    );
    const repository = source?.html_url || source?.full_name || sourceSlug;
    return `github://${repository.replace(/^https?:\/\//, "")}/${sourcePath}`;
  }
  if (root === "confluence" && sourceSlug) {
    const source = project.sources?.confluence_spaces?.find((space) => space.slug === sourceSlug);
    const authority = source?.base_url?.replace(/^https?:\/\//, "") || "configured-space";
    return `confluence://${authority}/${source?.space_key || sourceSlug}/${sourcePath}`;
  }
  if (root === "webex" && sourceSlug) {
    const source = project.sources?.webex_rooms?.find((room) => room.slug === sourceSlug);
    return `webex://${source?.room_id || sourceSlug}/${sourcePath}`;
  }
  return `tome://${project.slug}/${path}`;
}

export async function captureEvidenceBundle(input: {
  project: ProjectDocument & { _id: string };
  childProjects?: Array<{ _id: string; slug: string }>;
  createdBy: string;
  seed?: string | null;
}): Promise<EvidenceBundle> {
  const capturedAt = new Date().toISOString();
  const [pages, templates, childPages] = await Promise.all([
    getPageStore().then((store) => store.listPages(input.project._id)),
    getAllPageTemplates(),
    Promise.all(
      (input.childProjects ?? []).map(async (project) => ({
        project,
        pages: await getPageStore().then((store) => store.listPages(project._id)),
      })),
    ),
  ]);
  const snapshot = buildSnapshotFromProject(input.project);
  const items: EvidenceItem[] = [
    item(
      "project_snapshot",
      `tome-project://${input.project.slug}`,
      stableJson(snapshot),
      capturedAt,
    ),
    ...Object.entries(pages)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, markdown]) =>
        item(
          pageEvidenceKind(path),
          canonicalPageUri(input.project, path),
          markdown,
          capturedAt,
          path,
          input.project._id,
        ),
      ),
    ...childPages.flatMap(({ project, pages: frozenPages }) =>
      Object.entries(frozenPages)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, markdown]) =>
          item(
            "wiki",
            `tome://${project.slug}/${path}`,
            markdown,
            capturedAt,
            path,
            project._id,
          ),
        ),
    ),
    ...templates.map((template) =>
      item(
        "template",
        `tome-template://${template.scope}@${template.version}`,
        stableJson(template.pages),
        capturedAt,
      ),
    ),
  ];
  if (input.seed?.trim()) {
    items.push(item("seed", `tome-seed://${input.project.slug}`, input.seed.trim(), capturedAt));
  }
  const bundle: EvidenceBundle = {
    _id: randomUUID(),
    project_id: input.project._id,
    project_slug: input.project.slug,
    version: 1,
    content_hash: sha256(
      stableJson(items.map(({ id, kind, canonical_uri, content_hash }) => ({
        id,
        kind,
        canonical_uri,
        content_hash,
      }))),
    ),
    items,
    created_at: capturedAt,
    created_by: input.createdBy,
  };
  await insertEvidenceBundle(bundle);
  return bundle;
}

export const __test = { canonicalPageUri, pageEvidenceKind };
