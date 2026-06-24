/**
 * Unit tests for buildRubricGuidance — the pure renderer that turns a review
 * config's criteria into AI Assist guidance. The Mongo-backed loader
 * (loadRubricGuidance) is not exercised here; this covers ordering, labeling,
 * and verbatim micro_prompt passthrough.
 */

import { buildRubricGuidance } from "../rubric-guidance";
import type { ReviewConfig, ReviewCriterion } from "@/types/ai-review";

function criterion(over: Partial<ReviewCriterion>): ReviewCriterion {
  return {
    id: "c",
    name: "Crit",
    severity: "warning",
    weight: 1,
    micro_prompt: "Does it pass?",
    expects_fix: false,
    ...over,
  };
}

function config(criteria: ReviewCriterion[]): ReviewConfig {
  return {
    _id: "agent-system-prompt",
    target: "agent-system-prompt",
    label: "Agent",
    enabled: true,
    enforcement: "blocking",
    min_score: 0.85,
    grade_thresholds: { A: 0.9, B: 0.8, C: 0.7, D: 0.6 },
    criteria,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildRubricGuidance", () => {
  it("passes each micro_prompt through verbatim", () => {
    const out = buildRubricGuidance(
      config([
        criterion({ id: "role", name: "Role", micro_prompt: "Defines the role?" }),
      ]),
    );
    expect(out).toContain("Defines the role?");
    expect(out).toContain("Role");
  });

  it("orders error criteria before warning before info", () => {
    const out = buildRubricGuidance(
      config([
        criterion({ id: "i", name: "Info", severity: "info", weight: 5 }),
        criterion({ id: "e", name: "Err", severity: "error", weight: 1 }),
        criterion({ id: "w", name: "Warn", severity: "warning", weight: 1 }),
      ]),
    );
    const idxErr = out.indexOf("Err");
    const idxWarn = out.indexOf("Warn");
    const idxInfo = out.indexOf("Info");
    expect(idxErr).toBeLessThan(idxWarn);
    expect(idxWarn).toBeLessThan(idxInfo);
  });

  it("orders by descending weight within a severity", () => {
    const out = buildRubricGuidance(
      config([
        criterion({ id: "light", name: "Light", severity: "error", weight: 5 }),
        criterion({ id: "heavy", name: "Heavy", severity: "error", weight: 15 }),
      ]),
    );
    expect(out.indexOf("Heavy")).toBeLessThan(out.indexOf("Light"));
  });

  it("labels criteria by severity (must/should/nice-to-have)", () => {
    const out = buildRubricGuidance(
      config([
        criterion({ id: "e", name: "E", severity: "error" }),
        criterion({ id: "w", name: "W", severity: "warning" }),
        criterion({ id: "i", name: "I", severity: "info" }),
      ]),
    );
    expect(out).toContain("[must] E");
    expect(out).toContain("[should] W");
    expect(out).toContain("[nice-to-have] I");
  });
});
