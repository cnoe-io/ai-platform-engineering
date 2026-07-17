import {
  bootstrapSecretsFromEnv,
  buildSecretBootstrapInputs,
} from "../secret-bootstrap";

const descriptor = {
  id: "shared-service-token",
  name: "Shared service token",
  type: "bearer_token",
  valueEnv: "SHARED_SERVICE_TOKEN",
  description: "Shared service credential",
  owner: { type: "team", id: "super-admins" },
  sharedWithTeams: ["platform-users"],
};

describe("credential secret bootstrap", () => {
  it("resolves secret values from env without retaining the env key in service input", () => {
    expect(buildSecretBootstrapInputs({
      CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON: JSON.stringify([descriptor]),
      SHARED_SERVICE_TOKEN: "service-token-value",
    })).toEqual([
      {
        id: "shared-service-token",
        name: "Shared service token",
        type: "bearer_token",
        plaintext: "service-token-value",
        description: "Shared service credential",
        owner: { type: "team", id: "super-admins" },
        sharedWithTeams: ["platform-users"],
      },
    ]);
  });

  it("rejects inline values and missing referenced environment variables", () => {
    expect(() => buildSecretBootstrapInputs({
      CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON: JSON.stringify([
        { ...descriptor, value: "must-not-be-rendered" },
      ]),
      SHARED_SERVICE_TOKEN: "service-token-value",
    })).toThrow("inline secret values are not allowed");

    expect(() => buildSecretBootstrapInputs({
      CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON: JSON.stringify([descriptor]),
    })).toThrow("missing environment variable SHARED_SERVICE_TOKEN");
  });

  it("upserts every configured secret and reports bootstrap outcomes", async () => {
    const upsertBootstrapSecret = jest.fn()
      .mockResolvedValueOnce("created")
      .mockResolvedValueOnce("unchanged");
    const second = { ...descriptor, id: "another-token", name: "Another token" };

    await expect(bootstrapSecretsFromEnv({
      env: {
        CREDENTIAL_BOOTSTRAP_SECRET_REFS_JSON: JSON.stringify([descriptor, second]),
        SHARED_SERVICE_TOKEN: "service-token-value",
      },
      service: { upsertBootstrapSecret },
    })).resolves.toEqual({ created: 1, updated: 0, unchanged: 1 });
    expect(upsertBootstrapSecret).toHaveBeenCalledTimes(2);
  });
});
