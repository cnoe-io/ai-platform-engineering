import { CREDENTIAL_COLLECTIONS, CredentialCollectionName } from "./collections";

export interface CredentialIndexSpec {
  collection: CredentialCollectionName;
  keys: Record<string, 1 | -1>;
  options?: {
    expireAfterSeconds?: number;
    name: string;
    sparse?: boolean;
    unique?: boolean;
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
      collection: CREDENTIAL_COLLECTIONS.providerConnections,
      keys: { connectorKey: 1, subject: 1 },
      options: { name: "provider_connections_connector_subject_unique", unique: true },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.providerConnections,
      keys: { status: 1, updatedAt: -1 },
      options: { name: "provider_connections_status_updated_at" },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.auditEvents,
      keys: { createdAt: -1 },
      options: { name: "credential_audit_events_created_at" },
    },
    {
      collection: CREDENTIAL_COLLECTIONS.auditEvents,
      keys: { "resource.type": 1, "resource.id": 1, createdAt: -1 },
      options: { name: "credential_audit_events_resource_created_at" },
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
