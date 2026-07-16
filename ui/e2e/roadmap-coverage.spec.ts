import { expect, test } from "@playwright/test";

const requestedScenarioGrid = [
  {
    area: "Chat with SRE Agent",
    status: "runnable",
    coverage: "Outshift triage plus GitHub, ArgoCD, AWS, PagerDuty, Splunk, and Webex chat prompts",
  },
  {
    area: "GRID Prod 0.5.x deployment testing",
    status: "runnable",
    coverage: "PDF-backed mocked chat coverage plus opt-in live GRID prod smoke scenarios",
  },
  {
    area: "Workflows replace Task Builder",
    status: "runnable",
    coverage: "Workflows route opens with the feature flag enabled and Task Builder copy absent",
  },
  {
    area: "Super admin creates Agents, MCP servers, and Skills",
    status: "pending-ui",
    coverage: "Needs admin creation routes, role fixture, and static/connected credential test handles",
  },
  {
    area: "Super admin shares Agents, MCP servers, and Skills",
    status: "pending-ui",
    coverage: "Needs sharing controls plus non-admin recipient fixture",
  },
  {
    area: "Non-admin creates and shares assets",
    status: "pending-ui",
    coverage: "Needs non-admin creation routes and team/AD group picker",
  },
  {
    area: "Non-admin accesses shared assets",
    status: "pending-ui",
    coverage: "Needs role-aware shared asset listing routes",
  },
  {
    area: "Webex integration from team space",
    status: "partial",
    coverage: "Chat-level Webex prompt is runnable; dedicated integration route is pending",
  },
  {
    area: "Admin settings spot check",
    status: "partial",
    coverage: "Available settings panel is runnable; dedicated admin settings route is pending",
  },
] as const;

test.describe("Requested scenario grid", () => {
  test("tracks runnable and pending Playwright coverage", async () => {
    await expect(requestedScenarioGrid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: "Chat with SRE Agent", status: "runnable" }),
        expect.objectContaining({ area: "GRID Prod 0.5.x deployment testing", status: "runnable" }),
        expect.objectContaining({ area: "Workflows replace Task Builder", status: "runnable" }),
        expect.objectContaining({ area: "Webex integration from team space", status: "partial" }),
      ]),
    );

    const pendingAreas = requestedScenarioGrid
      .filter((scenario) => scenario.status === "pending-ui")
      .map((scenario) => scenario.area);

    expect(pendingAreas).toEqual([
      "Super admin creates Agents, MCP servers, and Skills",
      "Super admin shares Agents, MCP servers, and Skills",
      "Non-admin creates and shares assets",
      "Non-admin accesses shared assets",
    ]);
  });

  test.fixme("super admins create Agents, MCP servers, and Skills with static and connected credentials", async () => {
    // Add runnable coverage when admin creation screens and test credentials are available.
  });

  test.fixme("super admins share Agents, MCP servers, and Skills with non-admin users", async () => {
    // Add runnable coverage when sharing controls are available.
  });

  test.fixme("non-admins create and share Agents, MCP servers, and Skills with a team or AD group", async () => {
    // Add runnable coverage when non-admin creation and group sharing screens are available.
  });

  test.fixme("non-admins access shared Agents, MCP servers, and Skills", async () => {
    // Add runnable coverage when role-aware shared asset listings are available.
  });

  test.fixme("dedicated Webex integration validates team-space access", async () => {
    // The chat-level Webex prompt is covered; add full integration coverage when a Webex route exists.
  });

  test.fixme("admin settings expose role-aware controls", async () => {
    // The available settings panel is covered; add this when admin settings routes exist.
  });
});
