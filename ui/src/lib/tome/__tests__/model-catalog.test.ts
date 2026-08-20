import {
  MODEL_PROFILE_VERSION,
  modelProfile,
  recommendedUpperBoundEvaluator,
  upperBoundEvaluatorError,
} from "@/lib/tome/model-catalog";

const HAIKU = "bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0";
const SONNET_45 = "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0";
const SONNET_46 = "bedrock/global.anthropic.claude-sonnet-4-6";
const SONNET_5 = "bedrock/global.anthropic.claude-sonnet-5";
const OPUS_48 = "bedrock/global.anthropic.claude-opus-4-8";
const OPUS_5 = "bedrock/global.anthropic.claude-opus-5";

describe("TOME upper-bound evaluator profiles", () => {
  it("recommends the least expensive strictly stronger eligible evaluator", () => {
    expect(recommendedUpperBoundEvaluator(HAIKU, SONNET_46)).toBe(SONNET_5);
    expect(recommendedUpperBoundEvaluator(SONNET_5, OPUS_48)).toBe(OPUS_5);
  });

  it("rejects self-judging and judges that are not strictly stronger", () => {
    expect(upperBoundEvaluatorError(HAIKU, SONNET_46, SONNET_46))
      .toMatch(/independent/);
    expect(upperBoundEvaluatorError(HAIKU, SONNET_46, SONNET_45))
      .toMatch(/strictly more capable/);
  });

  it("rejects unverified custom models", () => {
    expect(upperBoundEvaluatorError("provider/custom", SONNET_46, OPUS_5))
      .toMatch(/Candidate models/);
    expect(upperBoundEvaluatorError(HAIKU, SONNET_46, "provider/custom"))
      .toMatch(/evaluator must have/);
  });

  it("snapshots versioned capacity limits", () => {
    expect(modelProfile(OPUS_5)).toMatchObject({
      profile_version: MODEL_PROFILE_VERSION,
      context_window_tokens: 1_000_000,
      max_output_tokens: 128_000,
      supports_structured_output: true,
    });
  });
});
