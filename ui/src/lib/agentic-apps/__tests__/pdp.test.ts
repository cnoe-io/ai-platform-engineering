import { WEATHER_MANIFEST } from "../../../../apps/agentic-apps/weather/manifest.mjs";
import type {
  AgenticAppInstallationRecord,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

import { decideAgenticAppPdp } from "../pdp";

jest.mock("@/lib/agentic-apps/store", () => ({
  userPassesAgenticAppAccessGates: jest.fn(() => true),
}));

const pkg: AgenticAppPackageRecord = {
  packageId: "weather",
  source: "builtin",
  manifest: WEATHER_MANIFEST,
};
const installation: AgenticAppInstallationRecord = {
  appId: "weather",
  packageId: "weather",
  installed: true,
  enabled: true,
  visible: true,
  runtimeHealth: "healthy",
};
const caller = {
  user: { email: "test-user@example.com", name: "Test User", role: "user" },
  session: { role: "user" },
  pkg,
  installation,
};

describe("Agentic App PDP action scopes", () => {
  it("mints only the read scope declared for proxy GET", () => {
    const decision = decideAgenticAppPdp({
      ...caller,
      action: "proxy:GET",
    });

    expect(decision).toMatchObject({
      effect: "allow",
      reasonCode: "allowed",
      scopes: ["weather:read"],
    });
  });

  it("fails closed for an undeclared action", () => {
    const decision = decideAgenticAppPdp({
      ...caller,
      action: "proxy:DELETE",
    });

    expect(decision).toMatchObject({
      effect: "deny",
      reasonCode: "action_not_declared",
      scopes: [],
    });
  });

  it("rejects a declared app scope that is not allowed for the action", () => {
    const decision = decideAgenticAppPdp({
      ...caller,
      action: "proxy:GET",
      scopes: ["weather:agent"],
    });

    expect(decision).toMatchObject({
      effect: "deny",
      reasonCode: "scope_not_allowed",
      scopes: [],
    });
  });
});
