/**
 * assisted-by Codex Codex-sonnet-4-6
 */

import { decideAgenticAppPdp } from "@/lib/agentic-apps/pdp";
import type {
  AgenticAppInstallationRecord,
  AgenticAppManifest,
  AgenticAppPackageRecord,
} from "@/types/agentic-app";

jest.mock("@/lib/agentic-apps/store", () => ({
  userPassesAgenticAppAccessGates: jest.fn((manifestArg, context) => {
    const requiredRoles = manifestArg.access.requiredRoles ?? [];
    return requiredRoles.length === 0 || requiredRoles.some((role: string) => context.roles.includes(role));
  }),
}));

const manifest: AgenticAppManifest = {
  id: "finops",
  displayName: "FinOps",
  description: "Cost controls",
  apiVersion: "1.0",
  runtime: { kind: "proxied-next-zone", mountPath: "/apps/finops", origin: "http://localhost:3010" },
  surfaces: { showInHub: true },
  access: { requiredRoles: ["user"], tokenScopes: ["finops:read", "agents:invoke"] },
  health: { endpoint: "/healthz" },
};

const pkg: AgenticAppPackageRecord = {
  packageId: "finops",
  source: "builtin",
  manifest,
};

const installation: AgenticAppInstallationRecord = {
  appId: "finops",
  packageId: "finops",
  installed: true,
  enabled: true,
  runtimeHealth: "healthy",
};

const user = { email: "user@example.com", name: "User", role: "user" };
const session = { role: "user" };

describe("agentic app PDP", () => {
  it("allows launch/proxy actions and scopes to manifest-declared scopes", () => {
    const decision = decideAgenticAppPdp({
      action: "proxy:GET",
      user,
      session,
      pkg,
      installation,
      scopes: ["finops:read", "admin:root"],
    });

    expect(decision.effect).toBe("allow");
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.scopes).toEqual(["finops:read"]);
    expect(decision.decisionId).toBeTruthy();
  });

  it("denies by default when app install context is absent", () => {
    const decision = decideAgenticAppPdp({
      action: "proxy:GET",
      user,
      session,
      pkg: null,
      installation: null,
    });

    expect(decision.effect).toBe("deny");
    expect(decision.reasonCode).toBe("not_installed");
    expect(decision.scopes).toEqual([]);
  });

  it("denies when an explicit manifest policy action defaults to deny", () => {
    const decision = decideAgenticAppPdp({
      action: "repo:delete",
      user,
      session,
      pkg: {
        ...pkg,
        manifest: {
          ...manifest,
          access: {
            ...manifest.access,
            policyActions: [
              { action: "repo:delete", defaultEffect: "deny", reasonCode: "destructive_action" },
            ],
          },
        },
      },
      installation,
    });

    expect(decision.effect).toBe("deny");
    expect(decision.reasonCode).toBe("destructive_action");
  });
});
