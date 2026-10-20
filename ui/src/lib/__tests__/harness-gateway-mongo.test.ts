/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { resolveHarnessGatewayTarget } from "../harness-gateway";

let database: Db;
let pauseFirstDefinition: (() => void) | undefined;
let releaseFirstDefinition: Promise<void> | undefined;
let didPause = false;
jest.mock("@/lib/mongodb", () => ({
  getCollection: async (name: string) => {
    const collection = database.collection(name);
    if (name !== "dynamic_agents") return collection;
    return { findOne: async (...args: Parameters<typeof collection.findOne>) => {
      const snapshot = await collection.findOne(...args);
      if (!didPause && pauseFirstDefinition) {
        didPause = true;
        pauseFirstDefinition();
        await releaseFirstDefinition;
      }
      return snapshot;
    } };
  },
}));
const uri = process.env.HARNESS_GATEWAY_TEST_MONGODB_URI;
const describeMongo = uri ? describe : describe.skip;

describeMongo("atomic gateway execution-owner admission on standalone Mongo", () => {
  let client: MongoClient;
  beforeAll(async () => {
    client = await new MongoClient(uri!).connect();
    database = client.db(`gateway_route_cas_${randomUUID().replace(/-/g, "")}`);
    process.env.HARNESS_ENGINE_URL = "http://engine.example.test";
    process.env.HARNESS_ENGINE_INTERNAL_TOKEN = "internal-test-token";
  });
  afterAll(async () => {
    await database.dropDatabase();
    await client.close();
  });

  it("gives concurrent first turns one owner even when the agent changes between their reads", async () => {
    await database.collection("dynamic_agents").insertOne({ _id: "agent-example" as never, execution_harness_id: "dynamic_agents" });
    let observedFirst!: () => void;
    const firstRead = new Promise<void>((resolve) => { observedFirst = resolve; });
    let release!: () => void;
    releaseFirstDefinition = new Promise<void>((resolve) => { release = resolve; });
    pauseFirstDefinition = observedFirst;
    const context = { conversationId: "approved-context", admit: true };
    const first = resolveHarnessGatewayTarget("agent-example", context);
    await firstRead;
    await database.collection("dynamic_agents").updateOne({ _id: "agent-example" as never }, { $set: { execution_harness_id: "agentcore" } });
    const second = await resolveHarnessGatewayTarget("agent-example", context);
    release();
    expect(await first).toEqual(second);
    expect(second).toEqual({ kind: "harness_engine", harnessId: "agentcore" });
    const claims = await database.collection("harness_gateway_bindings").find({}).toArray();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ agent_id: "agent-example", session_id: "approved-context", harness_id: "agentcore" });
  });
});
