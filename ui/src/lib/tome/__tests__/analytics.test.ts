import { getServerOnlyConfig } from "@/lib/config";
import {
  buildCurrentPageSizePipeline,
  getTomeFreshnessBucket,
  getTomeQueryLatencyP95,
  getTomeUptime,
  hasConfiguredTomeSource,
  summarizeTomeLeadershipKpis,
  summarizeOrgConsumptionRows,
  type OrgConsumptionRow,
} from "@/lib/tome/analytics";

jest.mock("@/lib/config", () => ({
  getServerOnlyConfig: jest.fn(),
}));
jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));
jest.mock("@/lib/tome/mongo-collections", () => ({
  getTomeChatMessagesCollection: jest.fn(),
}));

const mockGetServerOnlyConfig = jest.mocked(getServerOnlyConfig);

describe("TOME analytics", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("current page consumption", () => {
    it("selects the latest revision before filtering tombstones", () => {
      const pipeline = buildCurrentPageSizePipeline(["project-1"]);

      expect(pipeline).toEqual([
        { $match: { project_id: { $in: ["project-1"] } } },
        { $sort: { project_id: 1, path: 1, created_at: -1 } },
        {
          $group: {
            _id: { project_id: "$project_id", path: "$path" },
            deleted: { $first: "$deleted" },
            bytes: { $first: { $strLenBytes: { $ifNull: ["$markdown", ""] } } },
          },
        },
        { $match: { deleted: { $ne: true } } },
        {
          $group: {
            _id: "$_id.project_id",
            pageCount: { $sum: 1 },
            wikiSizeBytes: { $sum: "$bytes" },
          },
        },
      ]);
    });

    it("summarizes only the current project rows supplied to the table", () => {
      const rows: OrgConsumptionRow[] = [
        {
          projectId: "project-1",
          slug: "primary",
          title: "Primary",
          pageCount: 4,
          wikiSizeBytes: 100,
          lastIngestedAt: null,
          activeIngest: null,
          ingestRunsSucceeded: 2,
          tokenUsage: { input: 10, output: 5 },
        },
        {
          projectId: "project-2",
          slug: "secondary",
          title: "Secondary",
          pageCount: 3,
          wikiSizeBytes: 80,
          lastIngestedAt: null,
          activeIngest: {
            status: "running",
            mode: "ingest",
            started_at: null,
            queued_at: null,
            project_slug: "secondary",
            project_title: "Secondary",
          },
          ingestRunsSucceeded: 1,
          tokenUsage: { input: 7, output: 3 },
        },
      ];

      expect(summarizeOrgConsumptionRows(rows)).toEqual({
        projectCount: 2,
        activeIngestCount: 1,
        totalPages: 7,
        totalWikiSizeBytes: 180,
        totalTokens: 25,
      });
    });
  });

  describe("Prometheus measurement status", () => {
    it("reports not_configured when Prometheus has no URL", async () => {
      mockGetServerOnlyConfig.mockReturnValue({ prometheusUrl: null });

      await expect(getTomeQueryLatencyP95()).resolves.toMatchObject({
        configured: false,
        status: "not_configured",
        p95Seconds: null,
      });
      await expect(getTomeUptime()).resolves.toMatchObject({
        configured: false,
        status: "not_configured",
        uptimePct: null,
        coveragePct: null,
      });
    });

    it("reports no_data when Prometheus is reachable without TOME samples", async () => {
      mockGetServerOnlyConfig.mockReturnValue({ prometheusUrl: "http://prometheus.example.test" });
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "success", data: { result: [] } }),
      }) as jest.Mock;

      await expect(getTomeQueryLatencyP95()).resolves.toMatchObject({
        configured: true,
        status: "no_data",
        p95Seconds: null,
      });
      await expect(getTomeUptime()).resolves.toMatchObject({
        configured: true,
        status: "no_data",
        uptimePct: null,
      });
    });

    it("reports query_failed when Prometheus rejects the query", async () => {
      mockGetServerOnlyConfig.mockReturnValue({ prometheusUrl: "http://prometheus.example.test" });
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as jest.Mock;

      await expect(getTomeQueryLatencyP95()).resolves.toMatchObject({
        configured: true,
        status: "query_failed",
      });
      await expect(getTomeUptime()).resolves.toMatchObject({
        configured: true,
        status: "query_failed",
      });
    });

    it("reports measured values returned by Prometheus", async () => {
      mockGetServerOnlyConfig.mockReturnValue({ prometheusUrl: "http://prometheus.example.test" });
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "4.25"] }] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "99.95"] }] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "3600"] }] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "100"] }] } }),
        }) as jest.Mock;

      await expect(getTomeQueryLatencyP95()).resolves.toMatchObject({
        status: "measured",
        p95Seconds: 4.25,
      });
      await expect(getTomeUptime()).resolves.toMatchObject({
        status: "measured",
        uptimePct: 99.95,
        processUptimeSeconds: 3600,
        coveragePct: 100,
      });
    });

    it("does not claim 24-hour uptime before the scrape window is populated", async () => {
      mockGetServerOnlyConfig.mockReturnValue({ prometheusUrl: "http://prometheus.example.test" });
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "100"] }] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "120"] }] } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "success", data: { result: [{ value: [0, "0.2"] }] } }),
        }) as jest.Mock;

      await expect(getTomeUptime()).resolves.toMatchObject({
        status: "collecting",
        uptimePct: null,
        coveragePct: 0.2,
      });
    });
  });

  describe("leadership scorecard", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");

    it("recognizes every supported configured-source shape", () => {
      expect(hasConfiguredTomeSource({ repos: ["owner/repo"] })).toBe(true);
      expect(hasConfiguredTomeSource({ confluence_url: "https://example.test/wiki" })).toBe(true);
      expect(hasConfiguredTomeSource({ webex_rooms: [{ slug: "room", name: "Room", room_id: "id" }] })).toBe(true);
      expect(hasConfiguredTomeSource({})).toBe(false);
      expect(hasConfiguredTomeSource(undefined)).toBe(false);
    });

    it("uses deterministic source-health boundaries", () => {
      expect(getTomeFreshnessBucket(new Date("2026-07-20T12:00:00.000Z"), now)).toBe("fresh");
      expect(getTomeFreshnessBucket(new Date("2026-06-27T12:00:00.000Z"), now)).toBe("aging");
      expect(getTomeFreshnessBucket(new Date("2026-06-26T12:00:00.000Z"), now)).toBe("stale");
      expect(getTomeFreshnessBucket(null, now)).toBe("never");
    });

    it("counts only direct active projects and reports aggregate engagement and BHAG synthesis", () => {
      const kpis = summarizeTomeLeadershipKpis(
        [
          {
            projectId: "project-a",
            slug: "project-a",
            name: "Project A",
            dataSteward: "owner@example.test",
            sources: { repos: ["example/project-a"] },
            initiatives: ["Strategic goal"],
            areas: ["Delivery area"],
            lastSourceEventAt: new Date("2026-07-26T12:00:00.000Z"),
            lastChatAt: new Date("2026-07-10T12:00:00.000Z"),
          },
          {
            projectId: "project-b",
            slug: "project-b",
            sources: {},
            lastIngestedAt: new Date("2026-06-20T12:00:00.000Z"),
          },
          { projectId: "goal-a", type: "bhag", slug: "goal-a", name: "Strategic goal" },
          { projectId: "area-a", type: "area", slug: "area-a", name: "Delivery area", initiatives: ["goal-a"] },
        ],
        { sessions: 12, messages: 30, repeatUsers: 3 },
        new Map([["goal-a", new Date("2026-07-01T12:00:00.000Z")]]),
        now,
      );

      expect(kpis).toMatchObject({
        windowDays: 30,
        coverage: { eligibleProjects: 2, stewardedProjects: 1, sourcedProjects: 1 },
        activity: { activeProjects: 1, dormantProjects: 1 },
        engagement: { sessions: 12, messages: 30, repeatUsers: 3 },
        sourceHealth: { fresh: 1, aging: 0, stale: 1, never: 0 },
        bhag: { count: 1, childProjects: 1, fresh: 0, aging: 1, stale: 0, never: 0 },
        hierarchy: {
          bhags: 1,
          areas: 1,
          projects: 2,
          bhagAreaRelations: 1,
          bhagProjectRelations: 1,
          areaProjectRelations: 1,
        },
        onboarding: { totalProjects: 2, addedInWindow: 0 },
        wikiMaturity: { realWikis: 0, greenfieldOnly: 0, emptyShells: 2 },
        ingestReliability: { succeeded: 0, failed: 0, successRate: null },
        cost: { totalUsd: 0, perActiveProjectUsd: null, measuredRuns: 0, terminalRuns: 0 },
      });
    });

    it("reports onboarding, maturity, reliability, cost, project engagement, and BHAG children", () => {
      const kpis = summarizeTomeLeadershipKpis(
        [
          { projectId: "real", slug: "real", name: "Real wiki", createdAt: new Date("2026-07-26T00:00:00Z"), lastChatAt: new Date("2026-07-26T00:00:00Z"), initiatives: ["goal"] },
          { projectId: "greenfield", slug: "greenfield", name: "Greenfield", createdAt: new Date("2026-07-01T00:00:00Z"), initiatives: ["goal"] },
          { projectId: "empty", slug: "empty", name: "Empty", areas: ["area"] },
          { projectId: "goal", type: "bhag", slug: "goal", name: "Goal" },
          { projectId: "area", type: "area", slug: "area", name: "Area", initiatives: ["goal"] },
        ],
        { sessions: 4, messages: 8, repeatUsers: 1 },
        new Map(),
        now,
        30,
        {
          maturityByProjectId: new Map([["real", "real"], ["greenfield", "greenfield"]]),
          engagementByProjectId: new Map([["real", { sessions: 2, messages: 5, repeatUsers: 1 }]]),
          ingestReliability: { succeeded: 9, failed: 1 },
          cost: { totalUsd: 3, measuredRuns: 3, terminalRuns: 10 },
        },
      );

      expect(kpis.onboarding).toEqual({ totalProjects: 3, addedInWindow: 2 });
      expect(kpis.wikiMaturity).toEqual({ realWikis: 1, greenfieldOnly: 1, emptyShells: 1 });
      expect(kpis.ingestReliability).toEqual({ succeeded: 9, failed: 1, successRate: 0.9 });
      expect(kpis.cost).toEqual({ totalUsd: 3, perActiveProjectUsd: 3, measuredRuns: 3, terminalRuns: 10 });
      expect(kpis.projectEngagement[0]).toMatchObject({ projectId: "real", sessions: 2, messages: 5, repeatUsers: 1 });
      expect(kpis.bhagBreakdown).toEqual([{ projectId: "goal", slug: "goal", name: "Goal", directProjects: 2, areas: 1, areaProjects: 1 }]);
    });
  });
});
