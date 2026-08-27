import {
  AGENTIC_APP_AGENT_ID_PATTERN,
  validateAgenticAppManifest,
} from "../manifest-validation";
import { FINOPS_MANIFEST } from "../../../../apps/agentic-apps/finops/manifest.mjs";
import { LITELLM_MANIFEST } from "../../../../apps/agentic-apps/litellm/manifest.mjs";
import { OSS_REPO_MANAGEMENT_MANIFEST } from "../../../../apps/agentic-apps/oss-repo-management/manifest.mjs";
import { WEATHER_MANIFEST } from "../../../../apps/agentic-apps/weather/manifest.mjs";
import { JIRA_PROJECT_DASHBOARD_MANIFEST } from "../../../../apps/agentic-apps/jira-project-dashboard/manifest.mjs";
import { AGENTIC_SDLC_MANIFEST } from "../../../../apps/agentic-sdlc/manifest.mjs";
import { SPEAKERS_COLLECTIVE_MANIFEST } from "../../../../apps/agentic-apps/speakers-collective/manifest.mjs";

function manifest(): Record<string, unknown> {
  return {
    id: "example-app",
    displayName: "Example App",
    description: "Example hosted dashboard.",
    apiVersion: "1.0",
    runtime: {
      kind: "proxied-next-zone",
      mountPath: "/apps/example-app",
      chrome: "iframe",
    },
    ui: {
      contractVersion: "1.0",
      surface: "hosted",
      routes: ["/", "/reports"],
      preferences: {
        schemaVersion: "1.0",
        fields: [
          {
            key: "density",
            label: "Density",
            type: "enum",
            default: "compact",
            options: [
              { label: "Compact", value: "compact" },
              { label: "Comfortable", value: "comfortable" },
            ],
          },
        ],
      },
    },
    authorization: { resourceType: "agentic_app", launchAction: "use" },
    surfaces: { showInHub: true },
    access: { tokenScopes: ["example-app:read"] },
    health: { endpoint: "/healthz", timeoutMs: 1000 },
  };
}

describe("Agentic App manifest microfrontend contract", () => {
  const builtInManifests = [
    AGENTIC_SDLC_MANIFEST,
    FINOPS_MANIFEST,
    WEATHER_MANIFEST,
    LITELLM_MANIFEST,
    OSS_REPO_MANAGEMENT_MANIFEST,
    JIRA_PROJECT_DASHBOARD_MANIFEST,
    SPEAKERS_COLLECTIVE_MANIFEST,
  ];

  it.each([
    ["agentic-sdlc", AGENTIC_SDLC_MANIFEST],
    ["finops", FINOPS_MANIFEST],
    ["weather", WEATHER_MANIFEST],
    ["litellm", LITELLM_MANIFEST],
    ["oss-repo-management", OSS_REPO_MANAGEMENT_MANIFEST],
    ["jira-project-dashboard", JIRA_PROJECT_DASHBOARD_MANIFEST],
    ["speakers-collective", SPEAKERS_COLLECTIVE_MANIFEST],
  ])("declares a valid fail-closed action and scope contract for %s", (_appId, candidate) => {
    const result = validateAgenticAppManifest(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(", "));
    expect(result.manifest.authorization).toEqual({
      resourceType: "agentic_app",
      launchAction: "use",
    });
    expect(result.manifest.access.policyActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "proxy:GET", requiredScopes: expect.any(Array) }),
        expect.objectContaining({ action: "proxy:HEAD", requiredScopes: expect.any(Array) }),
      ]),
    );
  });

  it("gives every built-in assistant one unique required dynamic agent", () => {
    const agentIds = builtInManifests.map((candidate) => {
      const result = validateAgenticAppManifest(candidate);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.errors.join(", "));
      const agentId = result.manifest.assistant?.agentId;
      expect(agentId).toBeTruthy();
      expect(
        result.manifest.agents?.filter(
          (agent) => agent.required && agent.dynamicAgentId === agentId,
        ),
      ).toHaveLength(1);
      return agentId;
    });

    expect(new Set(agentIds).size).toBe(agentIds.length);
  });

  it.each([
    ["finops", FINOPS_MANIFEST],
    ["weather", WEATHER_MANIFEST],
    ["litellm", LITELLM_MANIFEST],
    ["oss-repo-management", OSS_REPO_MANAGEMENT_MANIFEST],
    ["speakers-collective", SPEAKERS_COLLECTIVE_MANIFEST],
  ])("offers a consistent text-size preference for %s", (_appId, candidate) => {
    const result = validateAgenticAppManifest(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(", "));
    expect(result.manifest.ui?.preferences?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "textScale", default: "default" }),
      ]),
    );
  });

  it("accepts the MCP-backed LiteLLM dashboard manifest", () => {
    const result = validateAgenticAppManifest(LITELLM_MANIFEST);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(", "));
    expect(result.manifest).toMatchObject({
      id: "litellm",
      runtime: { mountPath: "/apps/litellm" },
      authorization: { resourceType: "agentic_app", launchAction: "use" },
    });
  });

  it("preserves an exact assistant agent binding", () => {
    const candidate = manifest();
    candidate.assistant = {
      enabled: true,
      agentId: "example-agent",
      agentName: "Example Agent",
    };
    candidate.agents = [
      {
        id: "primary-agent",
        displayName: "Example Agent",
        required: true,
        dynamicAgentId: "example-agent",
      },
    ];

    const result = validateAgenticAppManifest(candidate);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(", "));
    expect(result.manifest.assistant).toMatchObject({
      enabled: true,
      agentId: "example-agent",
      agentName: "Example Agent",
    });
  });

  it("rejects an invalid assistant agent ID", () => {
    const candidate = manifest();
    candidate.assistant = { enabled: true, agentId: "Invalid Agent ID" };

    const result = validateAgenticAppManifest(candidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected manifest validation to fail");
    expect(result.errors).toContain(
      `assistant.agentId must match ${AGENTIC_APP_AGENT_ID_PATTERN} when present`,
    );
  });

  it("requires every enabled assistant to bind one required dynamic agent", () => {
    const missingId = manifest();
    missingId.assistant = { enabled: true, agentName: "Example Agent" };
    const missingIdResult = validateAgenticAppManifest(missingId);
    expect(missingIdResult.ok).toBe(false);
    if (missingIdResult.ok) throw new Error("expected missing agent ID to fail");
    expect(missingIdResult.errors).toContain(
      "assistant.agentId is required when the assistant is enabled",
    );

    const unmatched = manifest();
    unmatched.assistant = { enabled: true, agentId: "example-agent" };
    unmatched.agents = [
      {
        id: "different-agent",
        displayName: "Different Agent",
        required: true,
        dynamicAgentId: "agent-different",
      },
    ];
    const unmatchedResult = validateAgenticAppManifest(unmatched);
    expect(unmatchedResult.ok).toBe(false);
    if (unmatchedResult.ok) throw new Error("expected unmatched agent ID to fail");
    expect(unmatchedResult.errors).toContain(
      "assistant.agentId must match a required agents[].dynamicAgentId dependency",
    );
  });

  it("preserves action-specific scopes and rejects scopes outside the token contract", () => {
    const valid = manifest();
    valid.access = {
      tokenScopes: ["example-app:read"],
      policyActions: [
        { action: "proxy:GET", requiredScopes: ["example-app:read"] },
      ],
    };
    const validResult = validateAgenticAppManifest(valid);
    expect(validResult.ok).toBe(true);
    if (!validResult.ok) throw new Error(validResult.errors.join(", "));
    expect(validResult.manifest.access.policyActions?.[0].requiredScopes).toEqual([
      "example-app:read",
    ]);

    const invalid = manifest();
    invalid.access = {
      tokenScopes: ["example-app:read"],
      policyActions: [
        { action: "proxy:POST", requiredScopes: ["example-app:admin"] },
      ],
    };
    const invalidResult = validateAgenticAppManifest(invalid);
    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) throw new Error("expected validation to fail");
    expect(invalidResult.errors).toContain(
      'access.policyActions[0].requiredScopes contains undeclared scope "example-app:admin"',
    );
  });

  it("accepts a versioned hosted UI and CAS target", () => {
    const result = validateAgenticAppManifest(manifest());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.errors.join(", "));
    expect(result.manifest.ui?.preferences?.fields[0]).toMatchObject({
      key: "density",
      default: "compact",
    });
    expect(result.manifest.authorization).toEqual({
      resourceType: "agentic_app",
      launchAction: "use",
    });
  });

  it("rejects unversioned UI contracts and unsupported authorization targets", () => {
    const candidate = manifest();
    candidate.ui = { contractVersion: "2.0", surface: "hosted" };
    candidate.authorization = { resourceType: "agent", launchAction: "use" };

    const result = validateAgenticAppManifest(candidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected manifest validation to fail");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "ui.contractVersion must be 1.0",
        'authorization must declare resourceType "agentic_app" and launchAction "use"',
      ]),
    );
  });
});
