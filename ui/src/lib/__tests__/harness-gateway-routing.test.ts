/** @jest-environment node */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveHarnessGatewayTarget } from "../harness-gateway";

const collections = new Map<string, Map<string, Record<string, unknown>>>();
function rows(name: string): Map<string, Record<string, unknown>> {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name)!;
}
function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) =>
    value && typeof value === "object" && "$nin" in value
      ? !(value.$nin as unknown[]).includes(row[key]) : row[key] === value);
}
jest.mock("@/lib/mongodb", () => ({
  getCollection: async (name: string) => ({
    findOne: async (query: Record<string, unknown>) => [...rows(name).values()].find((row) => matches(row, query)) ?? null,
    findOneAndUpdate: async (query: { _id: string }, update: { $setOnInsert: Record<string, unknown> }) => {
      if (!rows(name).has(query._id)) rows(name).set(query._id, { _id: query._id, ...update.$setOnInsert });
      return rows(name).get(query._id);
    },
  }),
}));

const agentId = "agent-example";
const context = { conversationId: "conversation-example", admit: true };
const native = { kind: "dynamic_agents", harnessId: "dynamic_agents" };
const engine = { kind: "harness_engine", harnessId: "claude_agent_sdk" };
function legacy(owner: string, harnessId: string): string {
  const id = createHash("sha256").update(JSON.stringify([owner, agentId, context.conversationId])).digest("hex");
  rows("harness_gateway_bindings").set(id, {
    _id: id, owner_subject: owner, agent_id: agentId, conversation_id: context.conversationId, harness_id: harnessId,
  });
  return id;
}
function canonical(): Record<string, unknown> | undefined {
  return [...rows("harness_gateway_bindings").values()].find((row) => row.session_id === context.conversationId);
}

beforeEach(() => {
  collections.clear();
  process.env.HARNESS_ENGINE_URL = "http://engine.example.test";
  process.env.HARNESS_ENGINE_INTERNAL_TOKEN = "internal-test-token";
  rows("dynamic_agents").set(agentId, { _id: agentId, execution_harness_id: "dynamic_agents" });
});

it.each(["agentcore", "claude_agent_sdk"])("fails closed for selected %s when Engine settings are absent", async (harnessId) => {
  rows("dynamic_agents").get(agentId)!.execution_harness_id = harnessId;
  delete process.env.HARNESS_ENGINE_URL;
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(503);
  expect(canonical()).toBeUndefined();
});

it("adopts an owner-keyed Engine reference even after its shared definition changes", async () => {
  legacy("owner-example", "claude_agent_sdk");
  expect(await resolveHarnessGatewayTarget(agentId, context)).toEqual(engine);
  expect(canonical()).toMatchObject({ agent_id: agentId, session_id: context.conversationId, harness_id: "claude_agent_sdk" });
  rows("dynamic_agents").get(agentId)!.execution_harness_id = "agentcore";
  expect(await resolveHarnessGatewayTarget(agentId, context)).toEqual(engine);
});

it("normalizes native legacy aliases into one context claim for every authorized caller", async () => {
  legacy("owner-example", "langchain-deepagents");
  legacy("another-owner", "dynamic_agents");
  rows("dynamic_agents").get(agentId)!.execution_harness_id = "agentcore";
  delete process.env.HARNESS_ENGINE_URL;
  expect(await resolveHarnessGatewayTarget(agentId, context)).toEqual(native);
  expect(canonical()).toMatchObject({ harness_id: "dynamic_agents" });
});

it("fails closed when older callers pinned different providers for the same context", async () => {
  legacy("owner-example", "claude_agent_sdk");
  legacy("another-owner", "dynamic_agents");
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(409);
  expect(canonical()).toBeUndefined();
});

it("does not let an older Engine reference override native checkpoints", async () => {
  legacy("owner-example", "claude_agent_sdk");
  rows("checkpoints_conversation").set("checkpoint-example", { _id: "checkpoint-example", thread_id: context.conversationId });
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(409);
  expect(canonical()).toBeUndefined();
});

it("does not replace a canonical owner when an incompatible legacy reference appears", async () => {
  expect(await resolveHarnessGatewayTarget(agentId, context)).toEqual(native);
  legacy("owner-example", "claude_agent_sdk");
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(409);
  expect(canonical()).toMatchObject({ harness_id: "dynamic_agents" });
});

it("can inspect a legacy choice without creating a new admission reference", async () => {
  const id = legacy("owner-example", "claude_agent_sdk");
  expect(await resolveHarnessGatewayTarget(agentId, { conversationId: context.conversationId })).toEqual(engine);
  expect([...rows("harness_gateway_bindings").keys()]).toEqual([id]);
});

it("keeps a saved Engine owner fail closed when its service is removed", async () => {
  legacy("owner-example", "claude_agent_sdk");
  delete process.env.HARNESS_ENGINE_INTERNAL_TOKEN;
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(503);
  expect(canonical()).toBeUndefined();
});


it("does not let a legacy Engine choice override an approved custom checkpoint collection", async () => {
  legacy("owner-example", "claude_agent_sdk");
  rows("dynamic_agents").get(agentId)!.backend = { config: { checkpoint_collection: "approved_checkpoints" } };
  rows("approved_checkpoints").set("checkpoint-example", { _id: "checkpoint-example", thread_id: context.conversationId });
  expect((await resolveHarnessGatewayTarget(agentId, context) as NextResponse).status).toBe(409);
  expect(canonical()).toBeUndefined();
});
