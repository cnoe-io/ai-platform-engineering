/**
 * @jest-environment node
 */
import type { ChangelogRelease } from "../route";

const CHANGELOG = `## 0.5.19 (2026-06-22)

### Fix

- **identity-sync**: remove proactive Okta credential health check on page load

## 0.5.18 (2026-06-22)

### Fix

- **workflows**: allow workflow CRUD with view permission at BFF gate

## 0.5.17-dev.2 (2026-06-21)

### Feat

- **agentgateway**: add streamable HTTP default for MCP servers

## 0.5.17-dev.1 (2026-06-20)

### Fix

- **rbac**: repair Slack route diagnostics

## 0.5.17 (2026-06-18)

### Fix

- **audit**: preserve active chat state

## 0.5.16-dev.1 (2026-06-18)

### Chore

- **dev-only**: prepare next stable release

## 0.5.16 (2026-06-17)

### Fix

- **migrations**: reconcile completed runs
`;

function mockChangelog(markdown = CHANGELOG) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    text: async () => markdown,
  })) as unknown as typeof fetch;
}

async function callGet() {
  jest.resetModules();
  mockChangelog();
  const { GET } = await import("../route");
  const response = await GET();
  return response.json() as Promise<{ releases: ChangelogRelease[]; scopes: string[] }>;
}

describe("/api/changelog", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns only plain x.y.z releases and scopes from those releases", async () => {
    const data = await callGet();

    expect(data.releases.map((release) => release.version)).toEqual(["0.5.19", "0.5.18", "0.5.17", "0.5.16"]);
    expect(data.scopes).toEqual([
      "agentgateway",
      "audit",
      "dev-only",
      "identity-sync",
      "migrations",
      "rbac",
      "workflows",
    ]);
  });

  it("rolls prerelease changes between dot releases into the following stable release", async () => {
    const data = await callGet();
    const release = data.releases.find((item) => item.version === "0.5.18");

    expect(release?.sections).toEqual([
      {
        type: "Fix",
        items: [
          {
            scope: "workflows",
            text: "**workflows**: allow workflow CRUD with view permission at BFF gate",
          },
          {
            scope: "rbac",
            text: "**rbac**: repair Slack route diagnostics",
          },
        ],
      },
      {
        type: "Feat",
        items: [
          {
            scope: "agentgateway",
            text: "**agentgateway**: add streamable HTTP default for MCP servers",
          },
        ],
      },
    ]);
  });
});
