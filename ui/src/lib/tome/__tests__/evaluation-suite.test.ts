import {
  DETERMINISTIC_EVALUATION_CASES,
  DETERMINISTIC_EVALUATION_SUITE,
} from "@/lib/tome/evaluation-fixtures";
import { defaultRubricPolicy } from "@/lib/tome/evaluation-store";
import { calculateRubrics } from "@/lib/tome/rubric-evaluator";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

describe("TOME deterministic no-external-model evaluation suite", () => {
  it("is versioned and carries immutable source/expectation contracts", () => {
    expect(DETERMINISTIC_EVALUATION_SUITE).toMatchObject({
      id: "grounding-calibration",
      version: 1,
    });
    for (const fixture of DETERMINISTIC_EVALUATION_SUITE.cases) {
      expect(Object.keys(fixture.sourceFixtures).length).toBeGreaterThan(0);
      expect(fixture.expectedClaims).toBeDefined();
      expect(fixture.forbiddenClaims).toBeDefined();
      expect(fixture.expectedTbdSections).toBeDefined();
    }
  });

  it.each(DETERMINISTIC_EVALUATION_CASES)("$id: $description", (fixture) => {
    const results = calculateRubrics(defaultRubricPolicy(), fixture.input);
    for (const rubricId of fixture.expectedFailedRubrics) {
      expect(results.find((result) => result.id === rubricId)?.passed).toBe(false);
    }
    if (fixture.expectedFailedRubrics.length === 0) {
      const explicitGap = results.find((result) => result.id === "explicit_gaps");
      expect(explicitGap?.passed).toBe(true);
      expect(results.find((result) => result.id === "unsupported_critical_claims")?.passed)
        .toBe(true);
      expect(results.filter((result) => result.enabled && result.blocking && result.passed !== true))
        .toEqual([]);
    }
  });

  it("calibrates all five claim classifications independently", () => {
    const classifications = [
      "supported",
      "partially_supported",
      "unsupported",
      "contradicted",
      "unverifiable",
    ] as const;
    const fixture = DETERMINISTIC_EVALUATION_CASES[0];
    const claims = classifications.map((classification, index) => ({
      ...fixture.input.claims[0],
      id: `claim-${classification}`,
      classification,
      fabricated_quantitative_details: index === 0 ? [] : undefined,
      critical_kind: null,
    }));
    const results = calculateRubrics(defaultRubricPolicy(), { ...fixture.input, claims });
    expect(results.find((result) => result.id === "grounding")).toMatchObject({
      numerator: 1.5,
      denominator: 5,
      score: 0.3,
    });
    expect(results.find((result) => result.id === "contradictions")?.count).toBe(1);
    expect(results.find((result) => result.id === "unverifiable_claims")?.count).toBe(1);
  });
});
