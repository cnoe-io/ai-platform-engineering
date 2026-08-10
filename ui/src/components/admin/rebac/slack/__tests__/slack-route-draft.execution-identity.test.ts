/**
 * @jest-environment node
 *
 * Tests for execution_identity round-trip in slack-route-draft:
 *  - emptyRouteDraft defaults to obo_user
 *  - routeToDraft reads execution_identity from route objects
 *  - draftToRoute serializes execution_identity correctly
 *  - routeDraftErrorMap validates service_account sub requirement
 */

import {
  draftToRoute,
  emptyRouteDraft,
  routeDraftErrorMap,
  routeToDraft,
  type RouteDraft,
} from "../slack-route-draft";
import type { ItemAgentRoute } from "../../connector-admin-adapter";
import type { SlackRouteExecutionIdentity } from "@/types/slack-rebac";

// Minimal valid ItemAgentRoute with execution_identity attached at runtime
function makeRoute(eid?: SlackRouteExecutionIdentity): ItemAgentRoute & { execution_identity?: SlackRouteExecutionIdentity } {
  return {
    agent_id: "agent-123",
    enabled: true,
    priority: 100,
    users: { enabled: true, listen: "mention" },
    ...(eid !== undefined ? { execution_identity: eid } : {}),
  };
}

describe("emptyRouteDraft", () => {
  it("defaults executionMode to obo_user", () => {
    const draft = emptyRouteDraft();
    expect(draft.executionMode).toBe("obo_user");
    expect(draft.executionServiceAccountSub).toBe("");
    expect(draft.executionServiceAccountName).toBe("");
  });
});

describe("routeToDraft — execution_identity deserialization", () => {
  it("defaults to obo_user when execution_identity is absent", () => {
    const draft = routeToDraft(makeRoute());
    expect(draft.executionMode).toBe("obo_user");
    expect(draft.executionServiceAccountSub).toBe("");
  });

  it("defaults to obo_user when execution_identity.mode is obo_user", () => {
    const draft = routeToDraft(makeRoute({ mode: "obo_user" }));
    expect(draft.executionMode).toBe("obo_user");
    expect(draft.executionServiceAccountSub).toBe("");
  });

  it("reads service_account mode and sub correctly", () => {
    const eid: SlackRouteExecutionIdentity = {
      mode: "service_account",
      service_account_sub: "abc-def-123",
      service_account_name: "incident-bot",
    };
    const draft = routeToDraft(makeRoute(eid));
    expect(draft.executionMode).toBe("service_account");
    expect(draft.executionServiceAccountSub).toBe("abc-def-123");
    expect(draft.executionServiceAccountName).toBe("incident-bot");
  });

  it("reads service_account mode without optional name", () => {
    const eid: SlackRouteExecutionIdentity = {
      mode: "service_account",
      service_account_sub: "abc-def-456",
    };
    const draft = routeToDraft(makeRoute(eid));
    expect(draft.executionMode).toBe("service_account");
    expect(draft.executionServiceAccountSub).toBe("abc-def-456");
    expect(draft.executionServiceAccountName).toBe("");
  });
});

describe("draftToRoute — execution_identity serialization", () => {
  function baseDraft(): RouteDraft {
    return {
      ...emptyRouteDraft(),
      agentId: "agent-abc",
      usersEnabled: true,
    };
  }

  it("serializes obo_user mode as { mode: obo_user } (no SA fields)", () => {
    const payload = draftToRoute({ ...baseDraft(), executionMode: "obo_user" });
    expect(payload.execution_identity).toEqual({ mode: "obo_user" });
    expect(payload.execution_identity?.service_account_sub).toBeUndefined();
  });

  it("serializes service_account mode with sub and name", () => {
    const payload = draftToRoute({
      ...baseDraft(),
      executionMode: "service_account",
      executionServiceAccountSub: "sub-abc-123",
      executionServiceAccountName: "incident-bot",
    });
    expect(payload.execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "sub-abc-123",
      service_account_name: "incident-bot",
    });
  });

  it("serializes service_account mode without name (omits service_account_name)", () => {
    const payload = draftToRoute({
      ...baseDraft(),
      executionMode: "service_account",
      executionServiceAccountSub: "sub-abc-456",
      executionServiceAccountName: "",
    });
    expect(payload.execution_identity?.mode).toBe("service_account");
    expect(payload.execution_identity?.service_account_sub).toBe("sub-abc-456");
    expect(payload.execution_identity?.service_account_name).toBeUndefined();
  });

  it("falls back to obo_user when executionMode is service_account but sub is empty", () => {
    // An incomplete SA selection (sub not yet chosen) must serialize to obo_user
    // so the BFF doesn't receive mode=service_account without a sub.
    const payload = draftToRoute({
      ...baseDraft(),
      executionMode: "service_account",
      executionServiceAccountSub: "  ",
      executionServiceAccountName: "",
    });
    expect(payload.execution_identity?.mode).toBe("obo_user");
    expect(payload.execution_identity?.service_account_sub).toBeUndefined();
  });
});

describe("routeDraftErrorMap — execution_identity validation", () => {
  function validDraft(): RouteDraft {
    return {
      ...emptyRouteDraft(),
      agentId: "agent-xyz",
      usersEnabled: true,
    };
  }

  it("no error when executionMode is obo_user", () => {
    const errors = routeDraftErrorMap({ ...validDraft(), executionMode: "obo_user" });
    expect(errors.executionServiceAccountSub).toBeUndefined();
  });

  it("error when executionMode is service_account but sub is empty", () => {
    const errors = routeDraftErrorMap({
      ...validDraft(),
      executionMode: "service_account",
      executionServiceAccountSub: "",
    });
    expect(errors.executionServiceAccountSub).toBeTruthy();
  });

  it("no error when executionMode is service_account with a valid sub", () => {
    const errors = routeDraftErrorMap({
      ...validDraft(),
      executionMode: "service_account",
      executionServiceAccountSub: "some-sub",
    });
    expect(errors.executionServiceAccountSub).toBeUndefined();
  });

  it("full roundtrip: route → draft → route preserves execution_identity", () => {
    const original = makeRoute({
      mode: "service_account",
      service_account_sub: "roundtrip-sub",
      service_account_name: "rt-bot",
    });
    const draft = routeToDraft(original);
    const payload = draftToRoute(draft);
    expect(payload.execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "roundtrip-sub",
      service_account_name: "rt-bot",
    });
  });
});
