import {
  assertCredentialServiceCaller,
  classifyCredentialRequest,
} from "@/lib/credentials/internal-caller";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("credential internal caller guard", () => {
  it("allows service callers with the expected audience and caller type", () => {
    const result = assertCredentialServiceCaller({
      headers: headers({
        authorization: "Bearer service-token",
        "x-caipe-credential-caller": "internal_service",
        "x-caipe-credential-audience": "caipe-credential-service-local",
      }),
      expectedAudience: "caipe-credential-service-local",
    });

    expect(result).toEqual({
      callerType: "internal_service",
      audience: "caipe-credential-service-local",
      browserAccessible: false,
    });
  });

  it("rejects session-only browser requests before decrypt", () => {
    expect(() =>
      assertCredentialServiceCaller({
        headers: headers({
          cookie: "next-auth.session-token=abc",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        }),
        expectedAudience: "caipe-credential-service-local",
      }),
    ).toThrow("Browser clients cannot retrieve credential material");
  });

  it("rejects browser-origin and CSRF-shaped requests even with bearer tokens", () => {
    for (const requestHeaders of [
      {
        authorization: "Bearer browser-accessible-token",
        origin: "http://localhost:3000",
        "x-caipe-credential-caller": "internal_service",
        "x-caipe-credential-audience": "caipe-credential-service-local",
      },
      {
        authorization: "Bearer browser-accessible-token",
        cookie: "next-auth.session-token=abc",
        origin: "http://localhost:3000",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-caipe-credential-caller": "internal_service",
        "x-caipe-credential-audience": "caipe-credential-service-local",
      },
    ]) {
      expect(() =>
        assertCredentialServiceCaller({
          headers: headers(requestHeaders),
          expectedAudience: "caipe-credential-service-local",
        }),
      ).toThrow("Browser clients cannot retrieve credential material");
    }
  });

  it("rejects wrong-audience service requests before decrypt", () => {
    expect(() =>
      assertCredentialServiceCaller({
        headers: headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "some-other-service",
        }),
        expectedAudience: "caipe-credential-service-local",
      }),
    ).toThrow("Credential service audience mismatch");
  });

  it("rejects missing caller, missing bearer, and missing audience service requests", () => {
    expect(() =>
      assertCredentialServiceCaller({
        headers: headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-audience": "caipe-credential-service-local",
        }),
        expectedAudience: "caipe-credential-service-local",
      }),
    ).toThrow("Credential service caller is not allowed");

    expect(() =>
      assertCredentialServiceCaller({
        headers: headers({
          "x-caipe-credential-caller": "dynamic_agent",
          "x-caipe-credential-audience": "caipe-credential-service-local",
        }),
        expectedAudience: "caipe-credential-service-local",
      }),
    ).toThrow("Credential service calls require a bearer token");

    expect(() =>
      assertCredentialServiceCaller({
        headers: headers({
          authorization: "Bearer service-token",
          "x-caipe-credential-caller": "dynamic_agent",
        }),
        expectedAudience: "caipe-credential-service-local",
      }),
    ).toThrow("Credential service audience mismatch");
  });

  it("classifies browser-accessible requests using fetch metadata and origin headers", () => {
    expect(
      classifyCredentialRequest(
        headers({
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toEqual({ browserAccessible: true });
  });
});
