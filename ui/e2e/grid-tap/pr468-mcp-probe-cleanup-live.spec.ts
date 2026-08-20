import { gridTapEnvOrSkip } from "./_env";
import { api, attachEvidence, dataRecord, evidenceScreenshot, expect, installPersona, test } from "./_helpers";

function rows(body: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(body)) return body.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
  const data = typeof record.data === "object" && record.data !== null ? record.data as Record<string, unknown> : record;
  for (const key of ["items", "servers"]) {
    if (Array.isArray(data[key])) return data[key] as Array<Record<string, unknown>>;
  }
  if (Array.isArray(record.data)) return record.data as Array<Record<string, unknown>>;
  return [];
}

async function matchingServers(page: Parameters<typeof api>[0], prefix: string) {
  const result = await api(
    page,
    `/api/mcp-servers?page_size=100&_grid_tap=${Date.now()}`,
    { cache: "no-store" },
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return rows(result.body).filter((row) => JSON.stringify(row).includes(prefix));
}

test.describe("PR 468 MCP probe cleanup", () => {
  test("each owner deletes its fixtures and both personas see zero residue", async ({ page }, testInfo) => {
    const env = gridTapEnvOrSkip();
    const cleanupResults: Array<Record<string, unknown>> = [];
    const deletedResourceIds: string[] = [];

    for (const persona of ["member", "admin"] as const) {
      await installPersona(page, env, persona);
      const ownedToken = persona === "member"
        ? ["-member-private"]
        : ["-admin-private", "-team", "-global"];
      for (const retry of [0, 1, 2]) {
        const base = `${env.prefix}-probe-${retry}`.slice(0, 84);
        for (const token of ownedToken) {
          const resourceId = `mcp-${base}${token}`;
          const result = await api(page, `/api/mcp-servers?id=${encodeURIComponent(resourceId)}`, { method: "DELETE" });
          cleanupResults.push({ persona, resourceId, result });
          expect([200, 404], JSON.stringify(result.body)).toContain(result.status);
          if (result.status === 200) deletedResourceIds.push(resourceId);
        }
      }
    }

    await attachEvidence(testInfo, "cleanup-delete-results", { prefix: env.prefix, cleanupResults });

    const residue: Record<string, unknown> = {};
    for (const persona of ["admin", "member"] as const) {
      await installPersona(page, env, persona);
      residue[persona] = await matchingServers(page, env.prefix);
      expect(residue[persona], JSON.stringify(residue)).toHaveLength(0);
    }

    await installPersona(page, env, "admin");
    const tupleResidue: Record<string, unknown> = {};
    for (const resourceId of deletedResourceIds) {
      await expect.poll(async () => {
        const params = new URLSearchParams({ object: `mcp_server:${resourceId}`, limit: "100" });
        const result = await api(page, `/api/admin/openfga/tuples?${params}`);
        expect(result.status, JSON.stringify(result.body)).toBe(200);
        const tuples = dataRecord(result).tuples;
        tupleResidue[resourceId] = tuples;
        return Array.isArray(tuples) ? tuples.length : -1;
      }, { timeout: 20_000, intervals: [250, 500, 1_000, 2_000] }).toBe(0);
    }

    await attachEvidence(testInfo, "cleanup-residue-scan", {
      prefix: env.prefix,
      cleanupResults,
      residue,
      tupleResidue,
    });
    await page.goto("/dynamic-agents?tab=mcp-servers", { waitUntil: "domcontentloaded" });
    await evidenceScreenshot(page, testInfo, "cleanup-zero-residue-both-personas");
  });
});
