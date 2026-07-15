import { startStageProgress } from "../sync-progress";

describe("sync-progress", () => {
  function collect() {
    const lines: string[] = [];
    return { log: (m: string) => lines.push(m), lines };
  }

  it("logs a header with the total up front", () => {
    const { log, lines } = collect();
    startStageProgress("resolve members", 100, log);
    expect(lines[0]).toBe("[IdpSync] resolve members: 100 to process");
  });

  it("emits roughly one line every 5% plus a final 100% line", () => {
    const { log, lines } = collect();
    const p = startStageProgress("resolve members", 100, log);
    for (let done = 1; done <= 100; done++) p.tick(done);
    p.done();

    const pctLines = lines.filter((l) => l.includes("%"));
    // 19 mid-stage boundaries (5%..95%) + one final 100% line.
    expect(pctLines).toHaveLength(20);
    expect(pctLines[0]).toBe("[IdpSync] resolve members: 5% (5/100)");
    expect(pctLines.at(-1)).toBe("[IdpSync] resolve members: 100% (100/100) complete");
  });

  it("never emits a mid-stage line at or past the total (done owns 100%)", () => {
    const { log, lines } = collect();
    const p = startStageProgress("stamp subjects", 40, log);
    for (let done = 1; done <= 40; done++) p.tick(done);
    // Before done(): no line should claim 100%.
    expect(lines.some((l) => l.includes("100%"))).toBe(false);
    p.done();
    expect(lines.at(-1)).toBe("[IdpSync] stamp subjects: 100% (40/40) complete");
  });

  it("logs the header but stays silent for an empty stage", () => {
    const { log, lines } = collect();
    const p = startStageProgress("dedupe members", 0, log);
    p.tick(0);
    p.done();
    expect(lines).toEqual(["[IdpSync] dedupe members: 0 to process"]);
  });

  it("done() is idempotent", () => {
    const { log, lines } = collect();
    const p = startStageProgress("apply", 10, log);
    p.done();
    p.done();
    expect(lines.filter((l) => l.includes("100%"))).toHaveLength(1);
  });

  it("still fires ~5% boundaries when tick is called in concurrent bursts", () => {
    // mapWithConcurrency resolves out of strict order; ticks arrive as a rising
    // counter but not one-at-a-time. A jump that crosses several boundaries
    // still logs (once) rather than being skipped.
    const { log, lines } = collect();
    const p = startStageProgress("resolve members", 200, log);
    p.tick(50); // jumps straight past 5/10/.../25% boundaries
    p.tick(120);
    p.done();
    const pctLines = lines.filter((l) => l.includes("%"));
    expect(pctLines).toContain("[IdpSync] resolve members: 25% (50/200)");
    expect(pctLines).toContain("[IdpSync] resolve members: 60% (120/200)");
    expect(pctLines.at(-1)).toBe("[IdpSync] resolve members: 100% (200/200) complete");
  });
});
