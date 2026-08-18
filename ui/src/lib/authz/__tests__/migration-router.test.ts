/** @jest-environment node */

import type { AuthorizeRequest, AuthorizeResult } from "../contract";
import {
  cohortBucket,
  modeFor,
  parseMigrationRevision,
  routeAuthorization,
  type MigrationRevision,
} from "../migration-router";

const REQUEST: AuthorizeRequest = {
  subject: { type: "user", id: "example-user" },
  resource: { type: "agent", id: "primary" },
  action: "read",
};
const ALLOW: AuthorizeResult = { decision: "ALLOW", reason: "OK", retriable: false };
const DENY: AuthorizeResult = { decision: "DENY", reason: "NO_CAPABILITY", retriable: false };

function revision(mode: MigrationRevision["default_mode"]): MigrationRevision {
  return {
    revision: "revision-1",
    default_mode: mode,
    canary_seed: "example-canary-seed-2026",
    scopes: [],
  };
}

function timed(result: AuthorizeResult) {
  return Promise.resolve({ result, durationMs: 1, error: false });
}

describe("migration rollout configuration", () => {
  it("defaults to LEGACY and rejects caller-controlled fields", () => {
    expect(parseMigrationRevision("").default_mode).toBe("LEGACY");
    expect(() => parseMigrationRevision(JSON.stringify({
      revision: "r1",
      default_mode: "AUTHZ",
      canary_seed: "example-canary-seed-2026",
      scopes: [],
      provider: "cedar",
    }))).toThrow("unknown rollout field");
  });

  it("matches the language-neutral canary vector", () => {
    expect(cohortBucket(revision("CANARY"), REQUEST)).toBe(947);
  });

  it("selects exact scope before broad scope", () => {
    const value: MigrationRevision = {
      ...revision("LEGACY"),
      scopes: [
        { surface: "bff", resource_type: "agent", action: "read", mode: "SHADOW" },
        { surface: "bff", resource_type: "agent", action: "read", exact_resources: ["primary"], mode: "AUTHZ" },
      ],
    };
    expect(modeFor(value, REQUEST)).toBe("AUTHZ");
  });
});

describe("migration authority", () => {
  it("returns legacy in SHADOW and compares asynchronously", async () => {
    const comparisons: unknown[] = [];
    const result = await routeAuthorization(
      REQUEST,
      async () => ALLOW,
      async () => timed(DENY),
      (value) => comparisons.push(value),
      revision("SHADOW"),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(result).toMatchObject({ result: ALLOW, authoritativePath: "LEGACY" });
    expect(comparisons).toHaveLength(1);
  });

  it("never falls back from an Authz deny", async () => {
    const result = await routeAuthorization(
      REQUEST,
      async () => ALLOW,
      async () => timed(DENY),
      undefined,
      revision("AUTHZ"),
    );
    expect(result).toMatchObject({ result: DENY, authoritativePath: "AUTHZ" });
  });

  it("does not invoke legacy in AUTHZ_ONLY", async () => {
    const legacy = jest.fn(async () => ALLOW);
    const result = await routeAuthorization(
      REQUEST,
      legacy,
      async () => timed(DENY),
      undefined,
      revision("AUTHZ_ONLY"),
    );
    expect(result.result).toEqual(DENY);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("replays promotion and routing rollback without mutating policy tuples", async () => {
    const policyTuples = [{
      user: "user:example-user",
      relation: "conditional_caller",
      object: "tool:issue_tracker/create_item",
    }];
    const tupleSnapshot = structuredClone(policyTuples);
    const calls: string[] = [];
    const legacy = async () => {
      calls.push("legacy");
      return ALLOW;
    };
    const authz = async (purpose: string) => {
      calls.push(`authz-${purpose}`);
      return { result: DENY, durationMs: 1, error: false };
    };

    for (const [name, mode, authority] of [
      ["legacy", "LEGACY", "LEGACY"],
      ["shadow", "SHADOW", "LEGACY"],
      ["canary", "CANARY", "AUTHZ"],
      ["authz", "AUTHZ", "AUTHZ"],
      ["authz-only", "AUTHZ_ONLY", "AUTHZ"],
      ["routing-rollback", "SHADOW", "LEGACY"],
    ] as const) {
      const value: MigrationRevision = {
        revision: name,
        default_mode: "LEGACY",
        canary_seed: "example-canary-seed-2026",
        scopes: [{
          surface: "bff",
          resource_type: "agent",
          action: "read",
          exact_resources: ["primary"],
          mode,
          canary_percent: mode === "CANARY" ? 100 : 0,
        }],
      };
      const result = await routeAuthorization(REQUEST, legacy, authz, undefined, value);
      expect(result.authoritativePath).toBe(authority);
      expect(policyTuples).toEqual(tupleSnapshot);
    }

    expect(calls).toContain("legacy");
    expect(calls).toContain("authz-shadow");
    expect(calls).toContain("authz-authoritative");
  });
});
