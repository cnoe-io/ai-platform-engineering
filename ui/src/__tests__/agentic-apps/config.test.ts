/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { getServerConfig } from "@/lib/config";

describe("agentic apps host config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults the Apps Hub shell entry point off", () => {
    delete process.env.AGENTIC_APPS_INSTALL_ENABLED;
    delete process.env.AGENTIC_APPS_ENABLED;

    expect(getServerConfig().agenticAppsEnabled).toBe(false);
  });

  it("keeps the Apps Hub shell entry point off until the host install toggle is enabled", () => {
    process.env.AGENTIC_APPS_ENABLED = "finops";

    expect(getServerConfig().agenticAppsEnabled).toBe(false);
  });

  it("enables the Apps Hub shell entry point from the host install toggle", () => {
    process.env.AGENTIC_APPS_INSTALL_ENABLED = "true";

    expect(getServerConfig().agenticAppsEnabled).toBe(true);
  });

  it("does not allow the public-prefixed install toggle to enable server-side app installation", () => {
    process.env.NEXT_PUBLIC_AGENTIC_APPS_INSTALL_ENABLED = "true";

    expect(getServerConfig().agenticAppsEnabled).toBe(false);
  });
});
