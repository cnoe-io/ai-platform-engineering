import type { ConfiguredAgenticApp } from "@/types/agentic-app";

import { buildConfiguredAgenticAppCasTupleDiff } from "../cas-reconcile";

function configuredApp(id: string): ConfiguredAgenticApp {
  return {
    manifest: {
      id,
      displayName: id,
      description: "Example",
      apiVersion: "1.0",
      runtime: {
        kind: "proxied-next-zone",
        origin: "https://app.example.test",
        mountPath: `/apps/${id}`,
      },
      authorization: { resourceType: "agentic_app", launchAction: "use" },
      surfaces: { showInHub: true },
      access: {
        tokenScopes: ["example:read"],
        policyActions: [{ action: "proxy:GET", defaultEffect: "allow" }],
      },
    },
    installation: {
      appId: id,
      packageId: id,
      installed: true,
      enabled: true,
      visible: true,
    },
  };
}

describe("configured External App CAS reconciliation", () => {
  it("preserves global, team, and private sharing across restarts", () => {
    const diff = buildConfiguredAgenticAppCasTupleDiff(
      [configuredApp("global-app"), configuredApp("team-app"), configuredApp("private-app")],
      new Map([
        ["global-app", "global"],
        ["team-app", "team"],
        ["private-app", "private"],
      ]),
    );

    expect(diff.writes).toEqual(
      expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:global-app",
        },
        expect.objectContaining({
          relation: "manager",
          object: "agentic_app:team-app",
        }),
      ]),
    );
    expect(diff.deletes).toEqual(
      expect.arrayContaining([
        {
          user: "user:*",
          relation: "user",
          object: "agentic_app:team-app",
        },
        expect.objectContaining({
          relation: "manager",
          object: "agentic_app:private-app",
        }),
      ]),
    );
  });
});
