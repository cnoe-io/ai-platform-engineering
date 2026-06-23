/**
 * @jest-environment node
 */
import type { ChangelogRelease } from "../route";

const CHANGELOG = `## 0.5.19 (2026-06-22)

### Fix

- **identity-sync**: remove proactive Okta credential health check on page load

## 0.5.18-dev.1 (2026-06-22)

### Feat

- **dev-only**: prepare unreleased work

## 0.5.18-rc.1 (2026-06-22)

### Fix

- **rc-only**: candidate release fix

## 0.5.18 (2026-06-22)

### Fix

- **workflows**: allow workflow CRUD with view permission at BFF gate
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

    expect(data.releases.map((release) => release.version)).toEqual(["0.5.19", "0.5.18"]);
    expect(data.scopes).toEqual(["identity-sync", "workflows"]);
  });
});
