describe("Okta directory connector", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      IDENTITY_SYNC_OKTA_ORG_URL: "https://example.okta.com",
      IDENTITY_SYNC_OKTA_API_TOKEN: "test-token",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("fetches Okta groups and members as identity sync external groups", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
      const value = url.toString();
      if (value.endsWith("/api/v1/groups?limit=200")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [
            {
              id: "00g-platform",
              profile: { name: "Engineering Platform Users", description: "Platform team users" },
              lastUpdated: "2026-05-12T00:00:00.000Z",
            },
          ],
        } as Response;
      }
      if (value.endsWith("/api/v1/groups/00g-platform/users?limit=200")) {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => [
            {
              id: "00u-bob",
              status: "ACTIVE",
              profile: {
                email: "bob@example.test",
                displayName: "Bob Example",
              },
            },
          ],
        } as Response;
      }
      throw new Error(`Unexpected URL ${value}`);
    });

    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");

    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).resolves.toEqual([
      expect.objectContaining({
        provider_id: "okta-main",
        external_group_id: "00g-platform",
        display_name: "Engineering Platform Users",
        members: [
          {
            subject: undefined,
            email: "bob@example.test",
            display_name: "Bob Example",
            active: true,
          },
        ],
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.okta.com/api/v1/groups?limit=200",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "SSWS test-token" }),
      })
    );
  });

  it("fails closed when Okta credentials are not configured", async () => {
    delete process.env.IDENTITY_SYNC_OKTA_API_TOKEN;
    const { fetchOktaExternalGroups } = await import("../../okta-directory-connector");

    await expect(fetchOktaExternalGroups({ providerId: "okta-main" })).rejects.toThrow(
      "Okta directory connector is not configured"
    );
  });
});
