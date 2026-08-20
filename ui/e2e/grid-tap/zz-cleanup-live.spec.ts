import { gridTapEnvOrSkip } from "./_env";
import {
  api,
  attachEvidence,
  bestEffortCleanupTome,
  dataRecord,
  evidenceScreenshot,
  expect,
  installPersona,
  test,
} from "./_helpers";
import { clearManifest, readManifest } from "./_manifest";

function rows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const data = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : record;
  for (const key of ["items", "servers", "tools", "conversations", "secrets"]) {
    if (Array.isArray(data[key])) return data[key] as Array<Record<string, unknown>>;
  }
  if (Array.isArray(record.data)) return record.data as Array<Record<string, unknown>>;
  return [];
}

function resourceId(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  return "";
}

test.describe("GRID TAP cleanup verification", () => {
  test("fixture prefix is deleted and leaves no surviving resources", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    await installPersona(page, env, "admin");

    const endpoints = {
      agents: "/api/dynamic-agents?page_size=100",
      servers: "/api/mcp-servers?page_size=100",
      secrets: "/api/credentials/secrets",
      tools: "/api/rag/v1/mcp/custom-tools",
      conversations: "/api/chat/conversations?page_size=100",
    } as const;
    const listed = Object.fromEntries(await Promise.all(Object.entries(endpoints).map(async ([key, path]) => [key, await api(page, path)])));

    const manifest = await readManifest();
    const tomeProjects = manifest.resources.filter((entry) => entry.kind === "tome_project");
    const tomeCleanupResults = [];
    for (const project of [...tomeProjects].reverse()) {
      const pages = manifest.resources
        .filter((entry) => entry.kind === "tome_page" && entry.slug === project.slug)
        .map((entry) => entry.path);
      const gists = manifest.resources
        .filter((entry) => entry.kind === "tome_gist" && entry.slug === project.slug)
        .map((entry) => entry.id);
      await bestEffortCleanupTome(page, {
        id: project.id,
        slug: project.slug,
        object: project.object,
        stewardSubject: env.admin.subject,
      }, { pages, gists });
      const projectRead = await api(page, `/api/projects/${encodeURIComponent(project.slug)}`);
      const tupleRead = await api(
        page,
        `/api/admin/openfga/tuples?${new URLSearchParams({ object: project.object, limit: "100" })}`,
      );
      const tupleRows = Array.isArray(dataRecord(tupleRead).tuples)
        ? dataRecord(tupleRead).tuples as unknown[]
        : [];
      tomeCleanupResults.push({ project, projectRead, tupleRead });
      expect(projectRead.status, JSON.stringify(projectRead.body)).toBe(404);
      expect(tupleRead.status, JSON.stringify(tupleRead.body)).toBe(200);
      expect(tupleRows, JSON.stringify(tupleRead.body)).toHaveLength(0);
    }

    const matching = Object.fromEntries(Object.entries(listed).map(([key, result]) => [
      key,
      rows(result.body).filter((row) => JSON.stringify(row).includes(env.prefix)),
    ])) as Record<string, Array<Record<string, unknown>>>;

    const deletes: string[] = [];
    for (const row of matching.conversations) {
      const id = resourceId(row, ["_id", "id"]);
      if (id) deletes.push(`/api/chat/conversations/${encodeURIComponent(id)}`);
    }
    for (const row of matching.agents) {
      const id = resourceId(row, ["_id", "id"]);
      if (id) deletes.push(`/api/dynamic-agents?id=${encodeURIComponent(id)}`);
    }
    for (const row of matching.tools) {
      const id = resourceId(row, ["tool_id", "id"]);
      if (id) deletes.push(`/api/rag/v1/mcp/custom-tools/${encodeURIComponent(id)}`);
    }
    for (const row of matching.servers) {
      const id = resourceId(row, ["_id", "id"]);
      if (id) deletes.push(`/api/mcp-servers?id=${encodeURIComponent(id)}`);
    }
    for (const row of matching.secrets) {
      const id = resourceId(row, ["id", "_id"]);
      if (id) deletes.push(`/api/credentials/secrets/${encodeURIComponent(id)}`);
    }

    const cleanupResults = [];
    for (const path of deletes) {
      cleanupResults.push({ path, result: await api(page, path, { method: "DELETE" }) });
    }

    const after = Object.fromEntries(await Promise.all(Object.entries(endpoints).map(async ([key, path]) => [key, await api(page, path)])));
    const residue = Object.fromEntries(Object.entries(after).map(([key, result]) => [
      key,
      rows(result.body).filter((row) => JSON.stringify(row).includes(env.prefix)),
    ])) as Record<string, Array<Record<string, unknown>>>;
    expect(Object.values(residue).flat(), JSON.stringify(residue)).toHaveLength(0);
    const tomeProjectScan = await api(
      page,
      `/api/projects?type=all&q=${encodeURIComponent(env.prefix)}`,
    );
    expect(tomeProjectScan.status, JSON.stringify(tomeProjectScan.body)).toBe(200);
    const projectRows = Array.isArray(dataRecord(tomeProjectScan).projects)
      ? dataRecord(tomeProjectScan).projects as Array<Record<string, unknown>>
      : [];
    const tomeResidue = projectRows.filter((project) => JSON.stringify(project).includes(env.prefix));
    expect(tomeResidue, JSON.stringify(tomeProjectScan.body)).toHaveLength(0);

    await attachEvidence(testInfo, "cleanup-residue-scan", {
      prefix: env.prefix,
      before: matching,
      cleanupResults,
      manifest,
      tomeCleanupResults,
      after: residue,
      tomeResidue,
    });
    await page.goto("/dynamic-agents", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "cleanup-zero-residue");
    await clearManifest();
  });
});
