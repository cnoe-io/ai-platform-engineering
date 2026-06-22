/**
 * @jest-environment node
 *
 * Unit tests for runOwnerSubject — the Phase 3 helper that extracts the workflow
 * run owner's `sub` from the forwarded Bearer token so executeSteps can run the
 * per-step CAS agent-use gate. Pure function; the heavy workflow-engine imports
 * are mocked to no-ops so the module loads in isolation.
 */
jest.mock("@/lib/mongodb", () => ({ getCollection: jest.fn() }));
jest.mock("@/lib/streaming/clients/server-agui-consumer", () => ({ consumeAgentStream: jest.fn() }));
jest.mock("@/lib/server/event-store", () => ({ readEvents: jest.fn() }));
jest.mock("@/lib/authz", () => ({ authorize: jest.fn() }));

import { runOwnerSubject } from "../workflow-engine";

/** Build a JWT (`header.payload.signature`) with a base64url-encoded payload. */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

describe("runOwnerSubject", () => {
  it("returns the sub from a valid Bearer JWT", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "alice-sub" })}` })).toBe("alice-sub");
  });

  it("reads a lowercase `authorization` header too", () => {
    expect(runOwnerSubject({ authorization: `Bearer ${jwt({ sub: "bob-sub" })}` })).toBe("bob-sub");
  });

  it("trims surrounding whitespace on the sub", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "  carol-sub  " })}` })).toBe("carol-sub");
  });

  it("returns null when there is no Authorization header (system run)", () => {
    expect(runOwnerSubject({})).toBeNull();
  });

  it("returns null for a non-Bearer scheme", () => {
    expect(runOwnerSubject({ Authorization: "Basic dXNlcjpwYXNz" })).toBeNull();
  });

  it("returns null when the token has fewer than two segments", () => {
    expect(runOwnerSubject({ Authorization: "Bearer not-a-jwt" })).toBeNull();
  });

  it("returns null when the payload is not valid base64/JSON", () => {
    expect(runOwnerSubject({ Authorization: "Bearer aaa.@@@notbase64@@@.sig" })).toBeNull();
  });

  it("returns null when the JWT carries no sub", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ email: "x@y.com" })}` })).toBeNull();
  });

  it("returns null when the sub is whitespace-only", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: "   " })}` })).toBeNull();
  });

  it("returns null when the sub is non-string", () => {
    expect(runOwnerSubject({ Authorization: `Bearer ${jwt({ sub: 12345 })}` })).toBeNull();
  });
});
