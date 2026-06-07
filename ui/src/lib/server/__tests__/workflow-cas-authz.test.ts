/**
 * @jest-environment node
 */

const mockAuthorize = jest.fn();
const mockAuthorizeMany = jest.fn();

jest.mock("@/lib/authz", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  authorizeMany: (...a: unknown[]) => mockAuthorizeMany(...a),
}));

import {
  filterAccessibleWorkflowConfigs,
  requireWorkflowAccess,
  workflowAccessAllowed,
} from "../workflow-cas-authz";

const ALLOW = { decision: "ALLOW", reason: "OK", retriable: false };
const DENY = { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };
const session = { sub: "alice", org: "acme" };

beforeEach(() => jest.clearAllMocks());

describe("workflowAccessAllowed", () => {
  it("returns false (no PDP call) when there is no subject", async () => {
    expect(await workflowAccessAllowed({}, "wf-1", "read")).toBe(false);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("allows org admins without a per-workflow check", async () => {
    mockAuthorize.mockResolvedValueOnce(ALLOW); // org-admin check
    expect(await workflowAccessAllowed(session, "wf-1", "read")).toBe(true);
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ resource: { type: "organization", id: "caipe" }, action: "manage" }),
      expect.anything(),
    );
  });

  it("falls back to the per-workflow task check for non-admins", async () => {
    mockAuthorize
      .mockResolvedValueOnce(DENY) // not org admin
      .mockResolvedValueOnce(ALLOW); // task#read allowed
    expect(await workflowAccessAllowed(session, "wf-1", "read")).toBe(true);
    expect(mockAuthorize).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: { type: "task", id: "wf-1" }, action: "read" }),
      expect.anything(),
    );
  });

  it("returns false when both org-admin and task checks deny", async () => {
    mockAuthorize.mockResolvedValue(DENY);
    expect(await workflowAccessAllowed(session, "wf-1", "delete")).toBe(false);
  });

  it("graphs a service-account caller and tolerates a missing org", async () => {
    mockAuthorize.mockResolvedValueOnce(DENY).mockResolvedValueOnce(ALLOW);
    expect(await workflowAccessAllowed({ sub: "bot", isServiceAccount: true }, "wf-1", "read")).toBe(true);
    expect(mockAuthorize).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { type: "service_account", id: "bot" } }),
      expect.anything(),
    );
  });
});

describe("requireWorkflowAccess", () => {
  it("throws 401 (NO_SUBJECT) when subject is missing", async () => {
    await expect(requireWorkflowAccess({}, "wf-1", "read")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("throws 403 with a clean code (no task#read leak) on deny", async () => {
    mockAuthorize.mockResolvedValue(DENY);
    await expect(requireWorkflowAccess(session, "wf-1", "read")).rejects.toMatchObject({
      statusCode: 403,
      code: "WORKFLOW_FORBIDDEN",
      reason: "forbidden",
    });
  });

  it("resolves when access is allowed", async () => {
    mockAuthorize.mockResolvedValueOnce(DENY).mockResolvedValueOnce(ALLOW);
    await expect(requireWorkflowAccess(session, "wf-1", "read")).resolves.toBeUndefined();
  });
});

describe("filterAccessibleWorkflowConfigs", () => {
  const configs = [{ _id: "wf-a" }, { _id: "wf-b" }, { _id: "wf-c" }];
  const getId = (c: { _id: string }) => c._id;

  it("returns everything for org admins (one batched call avoided)", async () => {
    mockAuthorize.mockResolvedValueOnce(ALLOW); // org admin
    const out = await filterAccessibleWorkflowConfigs(session, configs, getId, "read");
    expect(out).toEqual(configs);
    expect(mockAuthorizeMany).not.toHaveBeenCalled();
  });

  it("filters non-admins to the accessible subset via one batch call", async () => {
    mockAuthorize.mockResolvedValueOnce(DENY); // not admin
    mockAuthorizeMany.mockResolvedValue(
      new Map([
        ["wf-a", ALLOW],
        ["wf-b", DENY],
        ["wf-c", ALLOW],
      ]),
    );
    const out = await filterAccessibleWorkflowConfigs(session, configs, getId, "read");
    expect(out).toEqual([{ _id: "wf-a" }, { _id: "wf-c" }]);
    expect(mockAuthorizeMany).toHaveBeenCalledWith(
      { type: "user", id: "alice" },
      "read",
      "task",
      ["wf-a", "wf-b", "wf-c"],
      expect.anything(),
    );
  });

  it("returns [] when there is no subject", async () => {
    expect(await filterAccessibleWorkflowConfigs({}, configs, getId)).toEqual([]);
  });

  it("returns [] for an empty config list without consulting the PDP", async () => {
    expect(await filterAccessibleWorkflowConfigs(session, [], getId)).toEqual([]);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });
});
