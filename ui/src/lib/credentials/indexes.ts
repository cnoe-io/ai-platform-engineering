import { CREDENTIAL_COLLECTIONS,CredentialCollectionName } from "./collections";

export interface CredentialIndexSpec {
  collection: CredentialCollectionName;
  keys: Record<string, 1 | -1>;
  options?: {
    expireAfterSeconds?: number;
    name: string;
    sparse?: boolean;
    unique?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  };
}

export function buildCredentialIndexSpecs(): CredentialIndexSpec[] {
  return [
    {
      collection: CREDENTIAL_COLLECTIONS.secretRefs,
      keys: { "owner.type": 1, "owner.id": 1, name: 1 },
      options: { name: "credential_secret_refs_owner_name_unique", unique: true },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.secretRefs,
      keys: { updatedAt: -1 },
      options: { name: "credential_secret_refs_updated_at" },
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
      // Owner-keyed lookup index. listConnections filters by
      // { "owner.type", "owner.id" }; without this the read scans the whole
      // collection. (Replaces the old connectorKey/subject index, which
      // referenced fields that no longer exist on ProviderConnectionDocument
      // — connectorId/owner — and so was never used.)
      collection: CREDENTIAL_COLLECTIONS.providerConnections,
      keys: { "owner.type": 1, "owner.id": 1, updatedAt: -1 },
      options: { name: "provider_connections_owner_updated_at" },
    },
    {
      // At most one CONNECTED connection per (owner, provider). Closes the
      // check-then-act race in the add-token POST: two concurrent inserts for
      // the same SA+provider now collide at the DB (E11000) instead of both
      // landing. Partial so revoked/disabled rows don't block re-adding.
      collection: CREDENTIAL_COLLECTIONS.providerConnections,
      keys: { "owner.type": 1, "owner.id": 1, provider: 1 },
      options: {
        name: "provider_connections_owner_provider_connected_unique",
        unique: true,
        partialFilterExpression: { status: "connected" },
      },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.providerConnections,
      keys: { status: 1, updatedAt: -1 },
      options: { name: "provider_connections_status_updated_at" },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.migrationPreviews,
      keys: { expiresAt: 1 },
      options: {
        name: "credential_migration_previews_expires_at_ttl",
        expireAfterSeconds: 0,
      },
    },
  ];
}
