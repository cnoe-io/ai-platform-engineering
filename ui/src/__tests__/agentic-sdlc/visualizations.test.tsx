/**
 * Render-smoke + a11y regressions for the Agentic SDLC visualization
 * primitives. We intentionally do NOT snapshot the SVG output -- the
 * exact path coordinates are subject to design tweaks. Instead we pin
 * the contracts the rest of the codebase relies on:
 *
 *   1. AgenticSdlcAnimation renders all ten canonical stage labels and
 *      exposes a descriptive role/aria-label so the loop is meaningful
 *      to assistive tech.
 *   2. Under prefers-reduced-motion: reduce, the animateMotion element
 *      is omitted (CSS keyframes still no-op via motion-safe at the
 *      consumer level).
 *   3. SwimLanePreview renders all three configured lanes and the
 *      "Streaming preview" affordance.
 *   4. AgenticSdlcHome composes both primitives, the gradient title, and
 *      the ten stage tiles without throwing.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgenticSdlcAnimation } from "@/components/agentic-sdlc/visualizations/AgenticSdlcAnimation";
import { SwimLanePreview } from "@/components/agentic-sdlc/visualizations/SwimLanePreview";
import { AgenticSdlcHome } from "@/components/agentic-sdlc/AgenticSdlcHome";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/agentic-sdlc/visualizations/stage-visuals";

const mockRouterPush = jest.fn();
let mockSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  usePathname: () => "/agentic-sdlc",
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => mockSearchParams,
}));

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

describe("AgenticSdlcAnimation", () => {
  beforeEach(() => {
    setMatchMedia(false); // motion enabled by default
  });

  it("exposes a descriptive role + aria-label so the SVG is meaningful to assistive tech", () => {
    render(<AgenticSdlcAnimation />);
    const img = screen.getByRole("img", { name: /agentic sdlc delivery loop/i });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("aria-label")).toMatch(/specify/i);
    expect(img.getAttribute("aria-label")).toMatch(/observe/i);
    expect(img.getAttribute("aria-label")).toMatch(/feedback arc/i);
  });

  it("renders a label for every canonical stage", () => {
    render(<AgenticSdlcAnimation />);
    expect(ORBIT_STAGES).toEqual([
      "specify",
      "plan",
      "tasks",
      "implement",
      "unit_test",
      "review_hitl",
      "merge",
      "deploy",
      "validate",
      "observe",
    ]);
    for (const stage of ORBIT_STAGES) {
      const label = STAGE_VISUALS[stage].label;
      // Use within() over the SVG container; the label is rendered as
      // an SVG <text>, which getByText handles.
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders animateMotion elements for the orbiting agent tokens when motion is allowed", () => {
    const { container } = render(<AgenticSdlcAnimation />);
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBe(3); // three staggered agent tokens
  });

  it("omits animateMotion entirely under prefers-reduced-motion: reduce", () => {
    setMatchMedia(true);
    const { container } = render(<AgenticSdlcAnimation />);
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBe(0);
  });

  it("can hide agent tokens entirely via the showAgents prop", () => {
    const { container } = render(<AgenticSdlcAnimation showAgents={false} />);
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBe(0);
  });
});

describe("SwimLanePreview", () => {
  beforeEach(() => {
    setMatchMedia(false);
  });

  it("renders all three configured lanes with their stage labels", () => {
    render(<SwimLanePreview />);
    const root = screen.getByRole("img", { name: /swim lanes/i });
    // Lane headers render the exact label text (anchored regex avoids
    // collisions with card titles like "Approve PR #482" that contain
    // similar substrings).
    expect(within(root).getByText(/^implement$/i)).toBeInTheDocument();
    expect(within(root).getByText(/^review$/i)).toBeInTheDocument();
    expect(within(root).getByText(/^deploy$/i)).toBeInTheDocument();
  });

  it("surfaces the Streaming preview live affordance", () => {
    render(<SwimLanePreview />);
    expect(screen.getByText(/streaming preview/i)).toBeInTheDocument();
  });

  it("classifies cards as Agent vs You so the AI-native split is visible", () => {
    render(<SwimLanePreview />);
    expect(screen.getAllByText(/^agent$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^you$/i).length).toBeGreaterThan(0);
  });
});

describe("AgenticSdlcHome", () => {
  beforeEach(() => {
    setMatchMedia(false);
    mockRouterPush.mockClear();
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
    global.fetch = jest.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders the gradient hero title with both halves of the slogan", () => {
    render(<AgenticSdlcHome />);
    expect(screen.getByText(/engineers write the rules\./i)).toBeInTheDocument();
    expect(screen.getByText(/agents run the sdlc\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Agentic SDLC delivery loop\./i)).not.toBeInTheDocument();
  });

  it("composes the loop animation and one label per orbit stage", () => {
    render(<AgenticSdlcHome />);
    // Animation present.
    expect(
      screen.getByRole("img", { name: /agentic sdlc delivery loop/i }),
    ).toBeInTheDocument();
    // Each canonical stage still appears in the SVG animation; the
    // separate Stage glossary was intentionally removed as redundant.
    for (const stage of ORBIT_STAGES) {
      const label = STAGE_VISUALS[stage].label;
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not show internal delivery tracking docs on the product page", () => {
    render(<AgenticSdlcHome />);
    expect(
      screen.queryByText(/docs\/docs\/specs\/2026-05-05-agentic-sdlc-ship-loop-ui\/tasks\.md/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/track delivery/i)).not.toBeInTheDocument();
  });

  it("replaces roadmap cards with an actionable onboarding wizard", () => {
    render(<AgenticSdlcHome />);
    expect(screen.getByRole("tab", { name: /^overview$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: /agentic sdlc views/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /agentic sdlc preview/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /preview/i }),
    ).not.toBeInTheDocument();
    const footerNote = screen.getByText(
      "Agentic SDLC is an experimental feature. UI will evolve based on user feedback.",
    );
    expect(footerNote).toBeInTheDocument();
    expect(footerNote).toHaveClass("text-center");
    expect(footerNote).toHaveClass("mt-auto");
    expect(screen.getByText(/onboard a new repo/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /projects/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/what ships next/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/— agentic sdlc/i)).not.toBeInTheDocument();
  });

  it("shows the repos-first navigation model with metrics and settings tabs", () => {
    render(<AgenticSdlcHome />);
    expect(screen.getByRole("tab", { name: /repos/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /metrics/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /repos/i }));
    expect(
      screen.getByText(/visibility based on team rbac/i),
    ).toBeInTheDocument();
  });

  it("opens an Agentic SDLC tab from the tab query parameter", () => {
    mockSearchParams = new URLSearchParams("tab=metrics");
    render(<AgenticSdlcHome />);
    expect(
      screen.getByText(/portfolio signal across repo delivery loops/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /metrics/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("updates the tab query parameter when a tab is selected", () => {
    render(<AgenticSdlcHome />);
    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/agentic-sdlc?tab=settings",
      { scroll: false },
    );
  });

  it("presents Agentic SDLC home actions for onboarding, metrics, and repo permissions", () => {
    render(<AgenticSdlcHome />);
    expect(screen.getByText(/onboard a new repo/i)).toBeInTheDocument();
    expect(screen.getByText(/see metrics/i)).toBeInTheDocument();
    expect(screen.getByText(/manage repo permissions/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/pin the repos you care about/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(
      screen.getByRole("heading", { name: /rbac setup/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /overview/i }));
    fireEvent.click(screen.getByRole("button", { name: /open metrics/i }));
    expect(
      screen.getByText(/portfolio signal across repo delivery loops/i),
    ).toBeInTheDocument();
  });

  it("shows starred repos first in the active repos row on the overview tab", async () => {
    window.localStorage.setItem(
      "agentic-sdlc-starred-repos",
      JSON.stringify(["demoorg/starred-repo"]),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            repo_id: "2",
            owner: "demoorg",
            name: "recent-repo",
            full_name: "demoorg/recent-repo",
            sandbox_environment: "sandbox",
            webhook_status: "healthy",
            last_activity_at: "2026-05-05T22:00:00.000Z",
            counts: {
              open_epics: 1,
              in_flight_subtasks: 3,
              prs_awaiting_review: 0,
              deploys_24h: 1,
            },
          },
          {
            repo_id: "1",
            owner: "demoorg",
            name: "starred-repo",
            full_name: "demoorg/starred-repo",
            sandbox_environment: "sandbox",
            webhook_status: "healthy",
            last_activity_at: "2026-05-05T20:00:00.000Z",
            counts: {
              open_epics: 4,
              in_flight_subtasks: 8,
              prs_awaiting_review: 2,
              deploys_24h: 0,
            },
          },
        ],
      }),
    }) as unknown as typeof fetch;

    render(<AgenticSdlcHome />);

    expect(await screen.findByText(/your active repos/i)).toBeInTheDocument();
    expect(screen.getByText(/starred first, then recently updated/i)).toBeInTheDocument();
    expect(await screen.findByText(/^starred$/i)).toBeInTheDocument();

    const starred = screen.getByRole("link", { name: /starred-repo/i });
    const recent = screen.getByRole("link", { name: /recent-repo/i });
    expect(
      starred.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps launch content isolated to the dedicated Home tab", () => {
    render(<AgenticSdlcHome />);
    fireEvent.click(screen.getByRole("tab", { name: /repos/i }));
    expect(screen.getByText(/repo tiles/i)).toBeInTheDocument();
    expect(screen.queryByText(/engineers write the rules/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/onboard a new repo/i)).not.toBeInTheDocument();
  });

  it("keeps repo-specific swim lanes off the top-level repo tiles dashboard", () => {
    render(<AgenticSdlcHome />);
    expect(screen.queryByText(/live repo swim lanes/i)).not.toBeInTheDocument();
  });

  it("shows a richer metrics dashboard with visual operating signals", () => {
    render(<AgenticSdlcHome />);
    fireEvent.click(screen.getByRole("tab", { name: /metrics/i }));
    expect(
      screen.getByText(/portfolio signal across repo delivery loops/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/stage pressure heatmap/i)).toBeInTheDocument();
    expect(screen.getByText(/velocity ribbon/i)).toBeInTheDocument();
  });

  it("renders live metrics data instead of static placeholder values", async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/agentic-sdlc/metrics")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            generated_at: "2026-05-05T22:10:00.000Z",
            summary: {
              repos_in_scope: 2,
              hitl_queue_count: 3,
              velocity_30d: 5,
              token_spend_total: 12345,
            },
            stage_pressure: [
              {
                repo_id: "1",
                repo_name: "cnoe-io/ai-platform-engineering",
                stage: "implement",
                count: 4,
              },
              {
                repo_id: "1",
                repo_name: "cnoe-io/ai-platform-engineering",
                stage: "review_hitl",
                count: 2,
              },
            ],
            velocity_series: [
              { date: "2026-05-03", count: 2 },
              { date: "2026-05-04", count: 5 },
            ],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response);
    }) as unknown as typeof fetch;

    render(<AgenticSdlcHome />);
    fireEvent.click(screen.getByRole("tab", { name: /metrics/i }));

    expect(await screen.findByText("12.3K")).toBeInTheDocument();
    expect(screen.getAllByText("5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/cnoe-io\/ai-platform-engineering/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("RBAC")).not.toBeInTheDocument();
    expect(screen.queryByText("Trend")).not.toBeInTheDocument();
  });
});
