import { exchangeOAuthToken } from "@/lib/credentials/oauth-service-factory";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

jest.mock("@aws-sdk/client-kms", () => ({
  KMSClient: jest.fn(),
}));

function tokenResponse(body: string, contentType = "application/json") {
  return {
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  } as Response;
}

describe("exchangeOAuthToken", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requests JSON from GitHub-style token endpoints", async () => {
    const fetchMock = jest.fn(async () => tokenResponse(JSON.stringify({ access_token: "access-token" })));
    global.fetch = fetchMock as typeof fetch;

    await expect(
      exchangeOAuthToken("https://github.com/login/oauth/access_token", {
        grant_type: "authorization_code",
        code: "code-1",
      }),
    ).resolves.toEqual({ access_token: "access-token" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
      }),
    );
  });

  it("parses form-encoded token responses when a provider ignores the Accept header", async () => {
    global.fetch = jest.fn(async () =>
      tokenResponse("access_token=access-token&expires_in=3600", "application/x-www-form-urlencoded"),
    ) as typeof fetch;

    await expect(
      exchangeOAuthToken("https://github.com/login/oauth/access_token", {
        grant_type: "authorization_code",
        code: "code-1",
      }),
    ).resolves.toEqual({ access_token: "access-token", expires_in: 3600 });
  });
});
