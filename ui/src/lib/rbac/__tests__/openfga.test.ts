import {
  buildTeamResourceTupleDiff,
  buildUniversalRebacTupleDiff,
  checkUniversalRebacRelationship,
  isOpenFgaReconciliationEnabled,
  readOpenFgaTuples,
  writeOpenFgaTupleDiff,
  writeUniversalRebacTupleDiff,
} from "../openfga";

describe("OpenFGA team resource tuple reconciliation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.OPENFGA_RECONCILE_ENABLED;
    delete process.env.OPENFGA_HTTP;
    delete process.env.OPENFGA_STORE_NAME;
  });

  it("maps team members and resource diffs to OpenFGA tuples", () => {
    const diff = buildTeamResourceTupleDiff({
      teamSlug: "platform-engineering",
      memberUserIds: ["sub-alice", "sub-bob"],
      agents: { added: ["agent-1"], removed: ["agent-old"] },
      agentAdmins: { added: ["agent-admin"], removed: [] },
      tools: { added: ["jira_*"], removed: ["github_*"] },
      toolWildcard: { added: true, removed: false },
    });

    expect(diff.writes).toEqual([
      { user: "user:sub-alice", relation: "member", object: "team:platform-engineering" },
      { user: "user:sub-bob", relation: "member", object: "team:platform-engineering" },
      { user: "team:platform-engineering#member", relation: "can_use", object: "agent:agent-1" },
      {
        user: "team:platform-engineering#member",
        relation: "can_manage",
        object: "agent:agent-admin",
      },
      { user: "team:platform-engineering#member", relation: "can_call", object: "tool:jira_*" },
      { user: "team:platform-engineering#member", relation: "can_call", object: "tool:*" },
    ]);
    expect(diff.deletes).toEqual([
      {
        user: "team:platform-engineering#member",
        relation: "can_use",
        object: "agent:agent-old",
      },
      {
        user: "team:platform-engineering#member",
        relation: "can_call",
        object: "tool:github_*",
      },
    ]);
  });

  it("requires explicit opt-in and an OpenFGA URL", () => {
    const previousEnabled = process.env.OPENFGA_RECONCILE_ENABLED;
    const previousUrl = process.env.OPENFGA_HTTP;
    try {
      delete process.env.OPENFGA_RECONCILE_ENABLED;
      process.env.OPENFGA_HTTP = "http://openfga:8080";
      expect(isOpenFgaReconciliationEnabled()).toBe(false);

      process.env.OPENFGA_RECONCILE_ENABLED = "true";
      delete process.env.OPENFGA_HTTP;
      expect(isOpenFgaReconciliationEnabled()).toBe(false);

      process.env.OPENFGA_HTTP = "http://openfga:8080";
      expect(isOpenFgaReconciliationEnabled()).toBe(true);
    } finally {
      if (previousEnabled === undefined) delete process.env.OPENFGA_RECONCILE_ENABLED;
      else process.env.OPENFGA_RECONCILE_ENABLED = previousEnabled;
      if (previousUrl === undefined) delete process.env.OPENFGA_HTTP;
      else process.env.OPENFGA_HTTP = previousUrl;
    }
  });

  it("filters existing writes and absent deletes before calling OpenFGA write", async () => {
    process.env.OPENFGA_RECONCILE_ENABLED = "true";
    process.env.OPENFGA_HTTP = "http://openfga:8080";
    process.env.OPENFGA_STORE_NAME = "caipe-openfga";

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stores: [{ id: "store-1", name: "caipe-openfga" }] }),
      })
      // write tuple already exists -> do not include in write call
      .mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true }) })
      // delete tuple is absent -> do not include in write call
      .mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: false }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await writeOpenFgaTupleDiff({
      writes: [{ user: "team:demo#member", relation: "can_use", object: "agent:a1" }],
      deletes: [{ user: "team:demo#member", relation: "can_call", object: "tool:jira_*" }],
    });

    expect(result).toEqual({ enabled: true, writes: 0, deletes: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://openfga:8080/stores/store-1/write",
      expect.anything()
    );
  });

  it("caps tuple reads at OpenFGA's maximum page size", async () => {
    process.env.OPENFGA_HTTP = "http://openfga:8080";
    process.env.OPENFGA_STORE_NAME = "caipe-openfga";

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stores: [{ id: "store-1", name: "caipe-openfga" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tuples: [], continuation_token: "" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await readOpenFgaTuples({ pageSize: 200 });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      page_size: 100,
    });
  });

  it("builds universal relationship tuple diffs without changing the wire format", () => {
    expect(
      buildUniversalRebacTupleDiff({
        writes: [
          {
            subject: { type: "team", id: "platform", relation: "member" },
            action: "call",
            resource: { type: "tool", id: "argocd" },
          },
        ],
        deletes: [
          {
            subject: { type: "team", id: "platform", relation: "member" },
            action: "use",
            resource: { type: "agent", id: "legacy-agent" },
          },
        ],
      })
    ).toEqual({
      writes: [{ user: "team:platform#member", relation: "can_call", object: "tool:argocd" }],
      deletes: [{ user: "team:platform#member", relation: "can_use", object: "agent:legacy-agent" }],
    });
  });

  it("checks universal relationships through the OpenFGA check endpoint", async () => {
    process.env.OPENFGA_HTTP = "http://openfga:8080";
    process.env.OPENFGA_STORE_NAME = "caipe-openfga";
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stores: [{ id: "store-1", name: "caipe-openfga" }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: true }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      checkUniversalRebacRelationship({
        subject: { type: "user", id: "alice-sub" },
        action: "read",
        resource: { type: "knowledge_base", id: "platform-runbooks" },
      })
    ).resolves.toEqual({ allowed: true });

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      tuple_key: {
        user: "user:alice-sub",
        relation: "can_read",
        object: "knowledge_base:platform-runbooks",
      },
    });
  });

  it("writes universal relationship tuple diffs through reconciliation", async () => {
    process.env.OPENFGA_RECONCILE_ENABLED = "true";
    process.env.OPENFGA_HTTP = "http://openfga:8080";
    process.env.OPENFGA_STORE_NAME = "caipe-openfga";
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ stores: [{ id: "store-1", name: "caipe-openfga" }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ allowed: false }) })
      .mockResolvedValueOnce({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      writeUniversalRebacTupleDiff({
        writes: [
          {
            subject: { type: "team", id: "platform", relation: "member" },
            action: "use",
            resource: { type: "agent", id: "platform-engineer" },
          },
        ],
        deletes: [],
      })
    ).resolves.toEqual({ enabled: true, writes: 1, deletes: 0 });

    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      writes: {
        tuple_keys: [
          {
            user: "team:platform#member",
            relation: "can_use",
            object: "agent:platform-engineer",
          },
        ],
      },
    });
  });
});
