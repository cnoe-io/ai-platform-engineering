import { parseStandup } from "@/lib/tome/standup";

describe("parseStandup", () => {
  it("preserves structured headings and Markdown lists", () => {
    const parsed = parseStandup(`---
title: The Standup
kind: report
---
## What is this

Project summary.

## Headline

Release is ready.

## Asks / Blockers

- Need approval
- Need access

## Up next

- Deploy
`);
    expect(parsed.headline).toBe("Release is ready.");
    expect(parsed.blockers).toBe("- Need approval\n- Need access");
    expect(parsed.upNext).toBe("- Deploy");
    expect(parsed.fallback).toBe("");
  });

  it("recovers bold run-on section labels into separate sections", () => {
    const parsed = parseStandup(
      "**What is this** Project summary. **Headline:** Release ready. " +
        "**Asks / Blockers** - Need approval **Up next** - Deploy",
    );
    expect(parsed.whatIsThis).toBe("Project summary.");
    expect(parsed.headline).toBe("Release ready.");
    expect(parsed.blockers).toBe("- Need approval");
    expect(parsed.upNext).toBe("- Deploy");
  });

  it("falls back to block Markdown when no report headings are present", () => {
    const parsed = parseStandup("- First workstream\n- Second workstream");
    expect(parsed.fallback).toBe("- First workstream\n- Second workstream");
  });
});
