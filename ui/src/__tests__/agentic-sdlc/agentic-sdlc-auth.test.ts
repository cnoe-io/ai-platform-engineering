/**
 * @jest-environment node
 */
import {
  isAgenticSdlcMockAuthAllowed,
  requireAgenticSdlcReader,
} from "@/lib/agentic-sdlc/agentic-sdlc-auth";

jest.mock("next-auth", () => ({
  __esModule: true,
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth-config", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";

describe("isAgenticSdlcMockAuthAllowed", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFlag = process.env.SHIP_LOOP_ALLOW_NO_AUTH;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalFlag === undefined) delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    else process.env.SHIP_LOOP_ALLOW_NO_AUTH = originalFlag;
  });

  it("returns true when flag is set in non-production", () => {
    process.env.NODE_ENV = "development";
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "true";
    expect(isAgenticSdlcMockAuthAllowed()).toBe(true);
  });

  it("ALWAYS returns false in production, even when the flag is set", () => {
    process.env.NODE_ENV = "production";
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "true";
    expect(isAgenticSdlcMockAuthAllowed()).toBe(false);
  });

  it("returns false when the flag is unset", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    expect(isAgenticSdlcMockAuthAllowed()).toBe(false);
  });

  it("requires the literal string 'true' (any other value is off)", () => {
    process.env.NODE_ENV = "development";
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "1";
    expect(isAgenticSdlcMockAuthAllowed()).toBe(false);
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "TRUE";
    expect(isAgenticSdlcMockAuthAllowed()).toBe(false);
  });
});

describe("requireAgenticSdlcReader", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.SHIP_LOOP_ALLOW_NO_AUTH;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    else process.env.SHIP_LOOP_ALLOW_NO_AUTH = originalFlag;
    (getServerSession as jest.Mock).mockReset();
  });

  function makeReq(): Request {
    return new Request("http://localhost/api/agentic-sdlc/repos");
  }

  it("returns a mock reader when SHIP_LOOP_ALLOW_NO_AUTH=true in dev", async () => {
    process.env.NODE_ENV = "development";
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "true";
    const reader = await requireAgenticSdlcReader(makeReq());
    expect(reader).toEqual({
      kind: "mock",
      user: expect.objectContaining({ email: "ship-loop-mock@local" }),
    });
    // Crucially: the session lookup is NOT made. Otherwise
    // production mistakes (e.g. someone leaving the flag on in a
    // staging build) would still hit auth and could mask config drift.
    expect(getServerSession).not.toHaveBeenCalled();
  });

  it("falls back to NextAuth session when the bypass flag is unset", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { email: "alice@example.com", name: "Alice" },
    });
    const reader = await requireAgenticSdlcReader(makeReq());
    expect(reader).toEqual({
      kind: "session",
      user: { email: "alice@example.com", name: "Alice" },
    });
  });

  it("returns null when no session is present and bypass is off (route should 401)", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const reader = await requireAgenticSdlcReader(makeReq());
    expect(reader).toBeNull();
  });

  it("ignores the bypass flag in production and falls through to session auth", async () => {
    process.env.NODE_ENV = "production";
    process.env.SHIP_LOOP_ALLOW_NO_AUTH = "true";
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const reader = await requireAgenticSdlcReader(makeReq());
    expect(reader).toBeNull();
    expect(getServerSession).toHaveBeenCalled();
  });

  it("uses the session email as fallback name when name is missing", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SHIP_LOOP_ALLOW_NO_AUTH;
    (getServerSession as jest.Mock).mockResolvedValue({
      user: { email: "no-name@example.com" },
    });
    const reader = await requireAgenticSdlcReader(makeReq());
    expect(reader?.user.name).toBe("no-name@example.com");
  });
});
