/**
 * Tests for ScanTab (formerly HistoryTab) — the consolidated "Scan
 * skill" surface. We focus on:
 *   - The Scan-now CTA wires to the right endpoint and refreshes
 *     history after success
 *   - The empty state appears when there are no past scans
 *   - The latest-scan banner appears once history is populated
 *   - Hub-crawled IDs route to the hub-scan endpoint, not the
 *     agent-skills endpoint
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { ScanTab } from "../tabs/HistoryTab";

interface FakeEvent {
  id: string;
  ts: string;
  trigger: string;
  skill_id: string;
  skill_name: string;
  source: string;
  actor?: string;
  scan_status: "passed" | "flagged" | "unscanned";
  scan_summary?: string;
  scanner_unavailable?: boolean;
}

function makeFetch(impl: (url: string, init?: RequestInit) => unknown) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    const body = await impl(url, init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response;
  });
}

beforeEach(() => {
  mockToast.mockClear();
});

describe("ScanTab — first render with no history", () => {
  it("shows the never-scanned empty state and the Scan-now CTA", async () => {
    global.fetch = makeFetch((url) => {
      if (url.includes("/scan-history")) return { events: [] };
      return {};
    }) as unknown as typeof fetch;

    render(<ScanTab skillId="skill-abc" skillName="Triage" />);

    // Wait for history fetch to resolve.
    await waitFor(() => {
      expect(screen.getByTestId("skill-scan-never")).toBeInTheDocument();
    });
    expect(screen.getByTestId("skill-scan-now")).toBeInTheDocument();
    expect(
      screen.queryByTestId("skill-scan-latest"),
    ).not.toBeInTheDocument();
  });
});

describe("ScanTab — Scan now action", () => {
  it("POSTs to /api/skills/configs/<id>/scan and refreshes history", async () => {
    let scanCalls = 0;
    let historyCalls = 0;
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/skills/configs/") && init?.method === "POST") {
        scanCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: "skill-abc",
              scan_status: "passed",
              scan_updated_at: new Date().toISOString(),
            },
          }),
        } as unknown as Response;
      }
      if (url.includes("/scan-history")) {
        historyCalls += 1;
        // Return a single passed event AFTER the scan, empty before.
        const events: FakeEvent[] =
          scanCalls > 0
            ? [
                {
                  id: "ev1",
                  ts: new Date().toISOString(),
                  trigger: "manual_user_skill",
                  skill_id: "skill-abc",
                  skill_name: "Triage",
                  source: "agent_skills",
                  scan_status: "passed",
                  scan_summary: "All good",
                },
              ]
            : [];
        return {
          ok: true,
          status: 200,
          json: async () => ({ events }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ScanTab skillId="skill-abc" skillName="Triage" />);

    // Initial history fetch (1 call) + empty state visible.
    await waitFor(() => {
      expect(historyCalls).toBe(1);
    });

    fireEvent.click(screen.getByTestId("skill-scan-now"));

    await waitFor(() => {
      expect(scanCalls).toBe(1);
    });
    // Toast confirms — message includes the skill name when provided.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Scan finished.*Triage/i),
        "success",
      );
    });
    // History was re-fetched after the scan returned.
    await waitFor(() => {
      expect(historyCalls).toBeGreaterThanOrEqual(2);
    });
    // Latest-scan banner now appears with the new "passed" event.
    await waitFor(() => {
      expect(screen.getByTestId("skill-scan-latest")).toBeInTheDocument();
    });
  });

  it("surfaces a toast on scan failure and does not re-fetch history", async () => {
    let scanCalls = 0;
    let historyCalls = 0;
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/skills/configs/") && init?.method === "POST") {
        scanCalls += 1;
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: "Scanner offline" }),
        } as unknown as Response;
      }
      if (url.includes("/scan-history")) {
        historyCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ events: [] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ScanTab skillId="skill-abc" />);

    await waitFor(() => expect(historyCalls).toBe(1));

    fireEvent.click(screen.getByTestId("skill-scan-now"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.stringMatching(/Scanner offline/i),
        "error",
        expect.any(Number),
      );
    });
    // No second history fetch on failure.
    expect(historyCalls).toBe(1);
  });
});

describe("ScanTab — endpoint dispatch", () => {
  it("routes hub-crawled skills to the hub-scan endpoint", async () => {
    let lastScanUrl = "";
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/scan") && init?.method === "POST") {
        lastScanUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { scan_status: "passed" },
          }),
        } as unknown as Response;
      }
      if (url.includes("/scan-history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ events: [] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ScanTab skillId="catalog-hub-myhub-pdf-skill" />);

    await waitFor(() =>
      expect(screen.getByTestId("skill-scan-now")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("skill-scan-now"));

    await waitFor(() => {
      expect(lastScanUrl).toBe(
        "/api/skills/hub/myhub/pdf-skill/scan",
      );
    });
  });

  it("routes regular saved skills to the agent-skills scan endpoint", async () => {
    let lastScanUrl = "";
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/scan") && init?.method === "POST") {
        lastScanUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { scan_status: "passed" } }),
        } as unknown as Response;
      }
      if (url.includes("/scan-history")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ events: [] }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ScanTab skillId="agent-skill-123" />);
    await waitFor(() =>
      expect(screen.getByTestId("skill-scan-now")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("skill-scan-now"));
    await waitFor(() => {
      expect(lastScanUrl).toBe("/api/skills/configs/agent-skill-123/scan");
    });
  });
});

describe("ScanTab — onScanComplete callback", () => {
  it("invokes the parent callback after a successful scan", async () => {
    const onScanComplete = jest.fn();
    let scanCalls = 0;
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/scan") && init?.method === "POST") {
        scanCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { scan_status: "passed" } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ events: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    render(
      <ScanTab skillId="skill-x" onScanComplete={onScanComplete} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("skill-scan-now")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("skill-scan-now"));
    await waitFor(() => expect(scanCalls).toBe(1));
    await waitFor(() => expect(onScanComplete).toHaveBeenCalled());
  });
});
