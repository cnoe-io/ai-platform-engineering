import { grantAgentAccessGaps } from "../agent-access-grants";

const ok = { ok: true, json: async () => ({ granted: true }) } as Response;

describe("grantAgentAccessGaps", () => {
  it("writes everyone grants for global workflow gaps and team grants for team gaps", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok);

    await grantAgentAccessGaps(
      [
        { agentId: "hello-world", agentName: "Hello World", teamsWithoutAccess: ["(all users)"] },
        { agentId: "platform-engineer", agentName: "Platform Engineer", teamsWithoutAccess: ["eng"] },
      ],
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/authz/v1/grants",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          resource: { type: "agent", id: "hello-world" },
          grantee: { type: "everyone" },
          capability: "use",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "/api/authz/v1/grants",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          resource: { type: "agent", id: "platform-engineer" },
          grantee: { type: "team", id: "eng" },
          capability: "use",
        }),
      }),
    );
  });

  it("throws on non-2xx grant responses so save can stay blocked", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "You must have manage permission" }),
    } as Response);

    await expect(
      grantAgentAccessGaps(
        [{ agentId: "hello-world", agentName: "Hello World", teamsWithoutAccess: ["(all users)"] }],
        fetchImpl,
      ),
    ).rejects.toThrow("You must have manage permission");
  });
});
