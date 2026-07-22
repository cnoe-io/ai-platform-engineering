import {
  buildDependencyQueries,
  buildOverviewQueries,
  buildRuntimeQueries,
  resolveMetricsRange,
} from "../metrics-query-plan";

describe("MetricsTab PromQL planning", () => {
  it("uses adaptive sampling and rate windows for long presets", () => {
    const range = resolveMetricsRange("90d");

    expect(range.seconds).toBe(90 * 24 * 60 * 60);
    expect(range.stepSeconds).toBeGreaterThan(60 * 60);
    expect(range.rateWindowSeconds).toBeGreaterThan(5 * 60);

    const turnRate = buildRuntimeQueries(range).find((query) => query.id === "turn_rate_by_agent");
    expect(turnRate?.query).toContain(`[${range.rateWindowSeconds}s]`);
    expect(turnRate?.rangeSeconds).toBe(range.seconds);
  });

  it("preserves absolute custom bounds for range and instant queries", () => {
    const range = resolveMetricsRange("custom", {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-03T00:00:00.000Z",
    });
    const overview = buildOverviewQueries(range);
    const runtime = buildRuntimeQueries(range);

    expect(range.start).toBe(String(Date.parse("2026-06-01T00:00:00.000Z") / 1000));
    expect(range.end).toBe(String(Date.parse("2026-06-03T00:00:00.000Z") / 1000));
    expect(overview.every((query) => query.time === range.end)).toBe(true);
    expect(runtime.filter((query) => query.type === "range").every((query) => (
      query.start === range.start
      && query.end === range.end
      && query.rangeSeconds === undefined
    ))).toBe(true);
  });

  it("uses selected-window increases instead of lifetime counters", () => {
    const range = resolveMetricsRange("24h");
    const overview = buildOverviewQueries(range);
    const runtime = buildRuntimeQueries(range);

    expect(overview.find((query) => query.id === "turn_volume")?.query).toContain("increase(da_turns_total[86400s])");
    expect(runtime.find((query) => query.id === "turn_outcomes")?.query).toContain("increase(da_turns_total[86400s])");
    expect(runtime.find((query) => query.id === "agent_turn_volume")?.query).toContain("increase(da_turns_total[86400s])");
  });

  it("keeps expected pauses out of the reliability denominator", () => {
    const reliability = buildOverviewQueries(resolveMetricsRange("7d"))
      .find((query) => query.id === "turn_reliability")?.query;

    expect(reliability).toContain('status="success"');
    expect(reliability).toContain('status=~"success|error"');
    expect(reliability).not.toContain("interrupted");
    expect(reliability).not.toContain("cancelled");
  });

  it("retains model identity for usage, latency, errors, and tokens", () => {
    const queries = buildDependencyQueries(resolveMetricsRange("30d"));

    expect(queries.find((query) => query.id === "llm_calls_by_model")?.query).toContain("by (model_id)");
    expect(queries.find((query) => query.id === "llm_input_tokens_by_model")?.query).toContain("by (model_id)");
    expect(queries.find((query) => query.id === "llm_p95_by_agent_model")?.query).toContain("agent_name, model_id");
    expect(queries.find((query) => query.id === "llm_error_rate_by_agent_model")?.query).toContain("agent_name, model_id");
  });

  it("keeps every async section under the batch endpoint limit", () => {
    const range = resolveMetricsRange("24h");

    expect(buildOverviewQueries(range).length).toBeLessThanOrEqual(20);
    expect(buildRuntimeQueries(range).length).toBeLessThanOrEqual(20);
    expect(buildDependencyQueries(range).length).toBeLessThanOrEqual(20);
  });
});
