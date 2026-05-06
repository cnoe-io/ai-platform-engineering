/**
 * Render-smoke + a11y regressions for the Ship Loop visualization
 * primitives. We intentionally do NOT snapshot the SVG output -- the
 * exact path coordinates are subject to design tweaks. Instead we pin
 * the contracts the rest of the codebase relies on:
 *
 *   1. ShipLoopAnimation renders all eight canonical stage labels and
 *      exposes a descriptive role/aria-label so the loop is meaningful
 *      to assistive tech.
 *   2. Under prefers-reduced-motion: reduce, the animateMotion element
 *      is omitted (CSS keyframes still no-op via motion-safe at the
 *      consumer level).
 *   3. SwimLanePreview renders all three configured lanes and the
 *      "Streaming preview" affordance.
 *   4. ShipLoopHome composes both primitives, the gradient title, and
 *      the eight stage tiles without throwing.
 */

import { render, screen, within } from "@testing-library/react";
import { ShipLoopAnimation } from "@/components/ship-loop/visualizations/ShipLoopAnimation";
import { SwimLanePreview } from "@/components/ship-loop/visualizations/SwimLanePreview";
import { ShipLoopHome } from "@/components/ship-loop/ShipLoopHome";
import {
  ORBIT_STAGES,
  STAGE_VISUALS,
} from "@/components/ship-loop/visualizations/stage-visuals";

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

describe("ShipLoopAnimation", () => {
  beforeEach(() => {
    setMatchMedia(false); // motion enabled by default
  });

  it("exposes a descriptive role + aria-label so the SVG is meaningful to assistive tech", () => {
    render(<ShipLoopAnimation />);
    const img = screen.getByRole("img", { name: /agentic sdlc ship loop/i });
    expect(img).toBeInTheDocument();
    expect(img.getAttribute("aria-label")).toMatch(/specify/i);
    expect(img.getAttribute("aria-label")).toMatch(/observe/i);
    expect(img.getAttribute("aria-label")).toMatch(/feedback arc/i);
  });

  it("renders a label for every canonical stage", () => {
    render(<ShipLoopAnimation />);
    for (const stage of ORBIT_STAGES) {
      const label = STAGE_VISUALS[stage].label;
      // Use within() over the SVG container; the label is rendered as
      // an SVG <text>, which getByText handles.
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("renders animateMotion elements for the orbiting agent tokens when motion is allowed", () => {
    const { container } = render(<ShipLoopAnimation />);
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBe(3); // three staggered agent tokens
  });

  it("omits animateMotion entirely under prefers-reduced-motion: reduce", () => {
    setMatchMedia(true);
    const { container } = render(<ShipLoopAnimation />);
    const motions = container.querySelectorAll("animateMotion");
    expect(motions.length).toBe(0);
  });

  it("can hide agent tokens entirely via the showAgents prop", () => {
    const { container } = render(<ShipLoopAnimation showAgents={false} />);
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

describe("ShipLoopHome", () => {
  beforeEach(() => {
    setMatchMedia(false);
  });

  it("renders the gradient hero title with both halves of the slogan", () => {
    render(<ShipLoopHome />);
    expect(screen.getByText(/engineers write the rules\./i)).toBeInTheDocument();
    expect(screen.getByText(/agents run the ship loop\./i)).toBeInTheDocument();
  });

  it("composes the loop animation, the swim-lane preview, and one label per orbit stage", () => {
    render(<ShipLoopHome />);
    // Animation present.
    expect(
      screen.getByRole("img", { name: /agentic sdlc ship loop/i }),
    ).toBeInTheDocument();
    // Swim-lane preview present.
    expect(
      screen.getByRole("img", { name: /swim lanes/i }),
    ).toBeInTheDocument();
    // Each canonical stage still appears in the SVG animation; the
    // separate Stage glossary was intentionally removed as redundant.
    for (const stage of ORBIT_STAGES) {
      const label = STAGE_VISUALS[stage].label;
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the preview build note demoted (small, footer-anchored)", () => {
    render(<ShipLoopHome />);
    expect(
      screen.getByText(/docs\/docs\/specs\/2026-05-05-agentic-sdlc-ship-loop-ui\/tasks\.md/i),
    ).toBeInTheDocument();
  });
});
