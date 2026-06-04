import { CredentialRetrievalService } from "@/lib/credentials/retrieval-service";

function service() {
  return new CredentialRetrievalService({
    expectedAudience: "caipe-credential-service",
    payloadStore: {
      getSecret: jest.fn(async () => "github-token-value"),
    },
    authorize: jest.fn(async () => undefined),
  });
}

describe("CredentialRetrievalService", () => {
  it("retrieves a secret for a non-browser service caller after use authorization", async () => {
    const retrieval = service();

    await expect(
      retrieval.retrieve({
        headers: new Headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        }),
        body: {
          secret_ref: "secret-1",
          intended_use: "mcp_server",
        },
        session: { sub: "service-sub" },
      }),
    ).resolves.toEqual({
      credential: "github-token-value",
      secret_ref: "secret-1",
    });
  });

  it("denies browser-origin retrieval before decrypting", async () => {
    const payloadStore = { getSecret: jest.fn(async () => "github-token-value") };
    const retrieval = new CredentialRetrievalService({
      expectedAudience: "caipe-credential-service",
      payloadStore,
      authorize: jest.fn(async () => undefined),
    });

    await expect(
      retrieval.retrieve({
        headers: new Headers({
          authorization: "Bearer browser-token",
          origin: "http://localhost:3000",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        }),
        body: {
          secret_ref: "secret-1",
          intended_use: "mcp_server",
        },
        session: { sub: "service-sub" },
      }),
    ).rejects.toMatchObject({ reasonCode: "browser_request_denied" });
    expect(payloadStore.getSecret).not.toHaveBeenCalled();
  });

  it("validates secret ref, caller audience, and intended use", async () => {
    const retrieval = service();

    await expect(
      retrieval.retrieve({
        headers: new Headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "wrong-audience",
        }),
        body: {
          secret_ref: "secret-1",
          intended_use: "mcp_server",
        },
        session: { sub: "service-sub" },
      }),
    ).rejects.toMatchObject({ reasonCode: "wrong_audience" });

    await expect(
      retrieval.retrieve({
        headers: new Headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service",
        }),
        body: {
          secret_ref: "",
          intended_use: "browser",
        },
        session: { sub: "service-sub" },
      }),
    ).rejects.toMatchObject({ reasonCode: "invalid_retrieval_request" });
  });
});
