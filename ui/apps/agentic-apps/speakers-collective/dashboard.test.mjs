import assert from "node:assert/strict";
import test from "node:test";

import {
  EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG,
  normalizeSpeakersCollectiveConfig,
  resolveEventState,
} from "./dashboard.mjs";

test("normalizes the neutral example source", () => {
  const config = normalizeSpeakersCollectiveConfig(EXAMPLE_SPEAKERS_COLLECTIVE_CONFIG, { fixture: true });
  assert.equal(config.title, "Speakers Collective");
  assert.equal(config.fixture, true);
  assert.equal(config.events.length, 3);
  assert.deepEqual(config.teams, ["Platform", "Research", "Open Source"]);
});

test("rejects an empty event source", () => {
  assert.throws(
    () => normalizeSpeakersCollectiveConfig({ events: [] }),
    /at least one event/,
  );
});

test("drops unsafe links and normalizes legacy artifact fields", () => {
  const config = normalizeSpeakersCollectiveConfig({
    events: [{
      name: "Example Event",
      org: "Example Organization",
      teams: ["Platform"],
      link: "javascript:alert(1)",
      pub: { status: "Held", since: "2026-01-02" },
      routeExec: true,
      pinned: true,
    }],
  });
  assert.equal(config.events[0].organization, "Example Organization");
  assert.equal(config.events[0].link, "");
  assert.equal(config.events[0].publication.status, "Held");
  assert.equal(config.events[0].routeExecutive, true);
  assert.equal(config.events[0].priority, true);
});

test("computes deadline state from the viewer date", () => {
  const event = { deadline: "2026-02-08", end: "2026-02-12", rolling: false };
  assert.deepEqual(resolveEventState(event, new Date("2026-02-01T12:00:00Z")), {
    closed: false,
    closedDaysAgo: null,
    deadlineDays: 7,
    urgency: "critical",
  });
  assert.equal(resolveEventState(event, new Date("2026-02-09T12:00:00Z")).closed, true);
});
