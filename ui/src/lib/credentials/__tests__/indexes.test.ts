import { CREDENTIAL_COLLECTIONS } from "@/lib/credentials/collections";
import { buildCredentialIndexSpecs } from "@/lib/credentials/indexes";

describe("credential MongoDB indexes", () => {
  it("builds stable index specs for credential collections", () => {
    expect(buildCredentialIndexSpecs()).toEqual(
      expect.arrayContaining([
        {
          collection: CREDENTIAL_COLLECTIONS.secretRefs,
          keys: { "owner.type": 1, "owner.id": 1, name: 1 },
          options: { name: "credential_secret_refs_owner_name_unique", unique: true },
        },
        {
          collection: CREDENTIAL_COLLECTIONS.encryptedPayloads,
          keys: { secretRefId: 1 },
          options: { name: "credential_encrypted_payloads_secret_ref_unique", unique: true },
        },
        {
          collection: CREDENTIAL_COLLECTIONS.oauthConnectors,
          keys: { key: 1 },
          options: { name: "oauth_connectors_key_unique", unique: true },
        },
        {
          collection: CREDENTIAL_COLLECTIONS.providerConnections,
          keys: { "owner.type": 1, "owner.id": 1, updatedAt: -1 },
          options: { name: "provider_connections_owner_updated_at" },
        },
        {
          collection: CREDENTIAL_COLLECTIONS.providerConnections,
          keys: { "owner.type": 1, "owner.id": 1, provider: 1 },
          options: {
            name: "provider_connections_owner_provider_connected_unique",
            unique: true,
            partialFilterExpression: { status: "connected" },
          },
        },
      ]),
    );
  });

  it("no longer ships the stale connectorKey/subject index (fields removed from the doc shape)", () => {
    const names = buildCredentialIndexSpecs().map((s) => s.options?.name);
    expect(names).not.toContain("provider_connections_connector_subject_unique");
  });

  it("adds cleanup indexes without storing raw credential values", () => {
    const specs = buildCredentialIndexSpecs();

    expect(specs).toEqual(
      expect.arrayContaining([
        {
          collection: CREDENTIAL_COLLECTIONS.migrationPreviews,
          keys: { expiresAt: 1 },
          options: {
            name: "credential_migration_previews_expires_at_ttl",
            expireAfterSeconds: 0,
          },
        },
      ]),
    );
    expect(JSON.stringify(specs)).not.toMatch(/plaintext|raw|secretValue/i);
  });
});
