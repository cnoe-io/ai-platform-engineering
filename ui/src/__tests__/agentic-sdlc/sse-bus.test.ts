/**
 * @jest-environment node
 */
import {
  _resetBusForTest,
  _subscriberCountForTest,
  epicTopic,
  inboxTopic,
  portfolioTopic,
  publish,
  repoTopic,
  subscribe,
  type SseSubscriber,
} from "@/lib/agentic-sdlc/sse-bus";

function makeSub(userId: string, id: string = "s"): {
  sub: SseSubscriber;
  received: { event: string; data: unknown }[];
  closed: string[];
} {
  const received: { event: string; data: unknown }[] = [];
  const closed: string[] = [];
  const sub: SseSubscriber = {
    id,
    userId,
    send: (m) => received.push({ event: m.event, data: m.data }),
    close: (reason) => closed.push(reason ?? "closed"),
  };
  return { sub, received, closed };
}

describe("Agentic SDLC SSE bus", () => {
  beforeEach(() => _resetBusForTest());

  it("delivers published messages to all subscribers on the topic", () => {
    const topic = epicTopic("repo1", "epic1");
    const a = makeSub("u1", "a");
    const b = makeSub("u2", "b");
    subscribe(topic, a.sub);
    subscribe(topic, b.sub);

    publish(topic, { event: "artifact_upserted", data: { x: 1 } });
    expect(a.received).toEqual([{ event: "artifact_upserted", data: { x: 1 } }]);
    expect(b.received).toEqual([{ event: "artifact_upserted", data: { x: 1 } }]);
  });

  it("isolates topics: epic and inbox don't cross-bleed", () => {
    const epic = epicTopic("repo1", "epic1");
    const inbox = inboxTopic("u1");
    const eSub = makeSub("u1", "e");
    const iSub = makeSub("u1", "i");
    subscribe(epic, eSub.sub);
    subscribe(inbox, iSub.sub);

    publish(epic, { event: "stage_transition", data: 1 });
    expect(eSub.received).toHaveLength(1);
    expect(iSub.received).toHaveLength(0);
  });

  it("isolates repo-level streams from epic-level streams", () => {
    const repo = repoTopic("repo1");
    const epic = epicTopic("repo1", "epic1");
    const repoSub = makeSub("u1", "repo");
    const epicSub = makeSub("u1", "epic");
    subscribe(repo, repoSub.sub);
    subscribe(epic, epicSub.sub);

    publish(repo, { event: "artifact_upserted", data: { artifact_id: "I_1" } });

    expect(repoSub.received).toEqual([
      { event: "artifact_upserted", data: { artifact_id: "I_1" } },
    ]);
    expect(epicSub.received).toHaveLength(0);
  });

  it("isolates portfolio-level streams from repo-level streams", () => {
    const portfolio = portfolioTopic();
    const repo = repoTopic("repo1");
    const portfolioSub = makeSub("u1", "portfolio");
    const repoSub = makeSub("u1", "repo");
    subscribe(portfolio, portfolioSub.sub);
    subscribe(repo, repoSub.sub);

    publish(portfolio, { event: "event_appended", data: { repo_id: "repo1" } });

    expect(portfolioSub.received).toEqual([
      { event: "event_appended", data: { repo_id: "repo1" } },
    ]);
    expect(repoSub.received).toHaveLength(0);
  });

  it("dispose() removes the subscriber", () => {
    const topic = epicTopic("r", "e");
    const a = makeSub("u1");
    const { dispose } = subscribe(topic, a.sub);
    publish(topic, { event: "heartbeat", data: "x" });
    dispose();
    publish(topic, { event: "heartbeat", data: "y" });
    expect(a.received).toHaveLength(1);
    expect(_subscriberCountForTest(topic)).toBe(0);
  });

  it("rejects subscriptions exceeding per-user cap of 10", () => {
    const subs = Array.from({ length: 11 }, (_, i) =>
      makeSub("hot-user", `h${i}`),
    );
    const results = subs.map((s, i) => subscribe(epicTopic("r", `e${i}`), s.sub));
    const rejected = results.filter((r) => r.rejected === "user_quota_exceeded");
    expect(rejected).toHaveLength(1);
  });

  it("isolates a thrown send: other subscribers still receive", () => {
    const topic = epicTopic("r", "e");
    const bad = makeSub("u1", "bad");
    bad.sub.send = () => {
      throw new Error("nope");
    };
    const good = makeSub("u2", "good");
    subscribe(topic, bad.sub);
    subscribe(topic, good.sub);
    publish(topic, { event: "heartbeat", data: 1 });
    expect(good.received).toHaveLength(1);
  });
});
