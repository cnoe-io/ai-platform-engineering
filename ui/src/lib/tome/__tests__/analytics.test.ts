import { getServerOnlyConfig } from "@/lib/config";
import {
  buildCurrentPageSizePipeline,
  getTomeQueryLatencyP95,
  getTomeUptime,
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
});
