/**
 * @jest-environment node
 */
import {
  registerWorkflowRun,
  unregisterWorkflowRun,
  workflowDelegationPreCheck,
} from "../domains/workflow";
import type { AuthorizeRequest } from "../contract";

function agentUse(subjectId: string, agentId: string, runId?: string): AuthorizeRequest {
  return {
    subject: { type: "user", id: subjectId },
    resource: { type: "agent", id: agentId },
    action: "use",
    ...(runId ? { context: { workflow_run_id: runId } } : {}),
  };
}

describe("workflowDelegationPreCheck", () => {
  afterEach(() => unregisterWorkflowRun("run-1"));

  it("returns null when there is no workflow_run_id in context", () => {
    expect(workflowDelegationPreCheck(agentUse("alice", "pe"))).toBeNull();
  });

  it("returns null for an unknown run", () => {
    expect(workflowDelegationPreCheck(agentUse("alice", "pe", "ghost"))).toBeNull();
  });

  it("ALLOWs a delegated agent for the run owner", () => {
    registerWorkflowRun({
      workflowRunId: "run-1",
      ownerSubjectId: "alice",
      delegatedAgentIds: new Set(["pe"]),
    });
    expect(workflowDelegationPreCheck(agentUse("alice", "pe", "run-1"))).toEqual({
      decision: "ALLOW",
      reason: "OK",
      retriable: false,
    });
  });

  it("does NOT delegate to a different subject than the run owner", () => {
    registerWorkflowRun({
      workflowRunId: "run-1",
      ownerSubjectId: "alice",
      delegatedAgentIds: new Set(["pe"]),
    });
    expect(workflowDelegationPreCheck(agentUse("mallory", "pe", "run-1"))).toBeNull();
  });

  it("does NOT delegate an agent outside the run's delegated set", () => {
    registerWorkflowRun({
      workflowRunId: "run-1",
      ownerSubjectId: "alice",
      delegatedAgentIds: new Set(["pe"]),
    });
    expect(workflowDelegationPreCheck(agentUse("alice", "other-agent", "run-1"))).toBeNull();
  });

  it("ignores non-agent / non-use requests", () => {
    registerWorkflowRun({
      workflowRunId: "run-1",
      ownerSubjectId: "alice",
      delegatedAgentIds: new Set(["pe"]),
    });
    const readReq: AuthorizeRequest = {
      subject: { type: "user", id: "alice" },
      resource: { type: "agent", id: "pe" },
      action: "read",
      context: { workflow_run_id: "run-1" },
    };
    expect(workflowDelegationPreCheck(readReq)).toBeNull();
  });
});
