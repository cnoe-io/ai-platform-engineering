// One-off migration for the legacy Webex Settings -> Integrations token store.
//
// Copies legacy Webex rows from `vendor_connections` into the newer
// Credentials -> Connected Apps `provider_connections` store as Webex (Pam).
// The source rows are left intact.
//
// Dry-run (default):
//   cd ui
//   MONGODB_URI=... MONGODB_DATABASE=caipe npx ts-node --project tsconfig.json \
//     --compiler-options '{"module":"CommonJS"}' \
//     ../scripts/migrate-webex-vendor-connections-to-provider-connections.ts
//
// Apply:
//   cd ui
//   APPLY=true MONGODB_URI=... MONGODB_DATABASE=caipe npx ts-node --project tsconfig.json \
//     --compiler-options '{"module":"CommonJS"}' \
//     ../scripts/migrate-webex-vendor-connections-to-provider-connections.ts

import { randomUUID } from "crypto";

import { MongoClient, type Db } from "mongodb";

import { BUILT_IN_OAUTH_CONNECTORS } from "../ui/src/lib/credentials/built-in-oauth-connectors";
import { createDevLocalKeyWrapper, createLocalCmkKeyWrapper } from "../ui/src/lib/credentials/key-wrapper";
import { MongoEnvelopeCredentialStore } from "../ui/src/lib/credentials/mongo-envelope-store";

const MIGRATION_ID = "webex_vendor_connections_to_webex_pam_provider_connections_v1";
const SOURCE_VENDOR = "webex";
const TARGET_PROVIDER = "webex_pam";
const TARGET_CONNECTOR_NAME = "Webex (Pam)";

interface VendorConnectionDoc {
  _id?: unknown;
  user_email?: unknown;
  vendor?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  scopes?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface UserDoc {
  email?: unknown;
  keycloak_sub?: unknown;
  metadata?: {
    keycloak_sub?: unknown;
  };
}

interface OAuthConnectorDoc {
  id: string;
  provider?: string;
  enabled?: boolean;
}

interface ProviderConnectionDoc {
  id: string;
  provider?: string;
  owner?: {
    type?: string;
    id?: string;
  };
  status?: string;
}

interface MigrationStats {
  scanned: number;
  planned: number;
  migrated: number;
  skippedExisting: number;
  skippedInvalid: number;
  skippedUnresolvedOwner: number;
}

function flag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() || null : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return undefined;
}

function asScopes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const scopes = value.map(asString).filter((scope): scope is string => Boolean(scope));
  return scopes.length > 0 ? Array.from(new Set(scopes)) : undefined;
}

function splitScopes(value: string | undefined, fallback: string[]): string[] {
  const raw = value?.trim();
  if (!raw) return fallback;
  const scopes = raw.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  return scopes.length > 0 ? Array.from(new Set(scopes)) : fallback;
}

function normalizeWebexRedirectUri(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    const legacyLocalCallback =
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.port === "3001" &&
      url.pathname === "/oauth/webex/callback";
    const legacySettingsCallback = url.pathname === "/api/integrations/webex/callback";
    if (!legacyLocalCallback && !legacySettingsCallback) {
      return redirectUri;
    }

    const fallbackBase = legacyLocalCallback ? "http://localhost:3000" : url.origin;
    const base = (process.env.NEXTAUTH_URL?.trim() || fallbackBase).replace(/\/$/, "");
    return `${base}/api/credentials/oauth/webex/callback`;
  } catch {
    return redirectUri;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createPayloadStore(db: Db): MongoEnvelopeCredentialStore {
  const keyProvider = process.env.CREDENTIAL_KEY_PROVIDER?.trim() || "local-cmk";
  if (keyProvider === "local-cmk") {
    return new MongoEnvelopeCredentialStore({
      payloadCollection: db.collection("credential_encrypted_payloads"),
      keyWrapper: createLocalCmkKeyWrapper({
        cmkId: process.env.CREDENTIAL_KMS_CMK_ID || "alias/caipe-local-credentials",
        nodeEnv: process.env.NODE_ENV,
        allowInsecureProductionKeyWrap: flag("CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP"),
      }),
    });
  }
  if (keyProvider === "dev-local") {
    return new MongoEnvelopeCredentialStore({
      payloadCollection: db.collection("credential_encrypted_payloads"),
      keyWrapper: createDevLocalKeyWrapper({
        masterKey:
          process.env.CREDENTIAL_DEV_LOCAL_MASTER_KEY ||
          process.env.CREDENTIAL_KMS_CMK_ID ||
          "caipe-local-development-credential-key",
        nodeEnv: process.env.NODE_ENV,
        allowInsecureProductionKeyWrap: flag("CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP"),
      }),
    });
  }
  throw new Error(
    `Unsupported CREDENTIAL_KEY_PROVIDER=${keyProvider}. This one-off script supports local-cmk/dev-local; run the UI credential bootstrap path for aws-kms.`,
  );
}

async function findOwnerSubject(db: Db, email: string): Promise<string | null> {
  const users = db.collection<UserDoc>("users");
  const user = await users.findOne(
    { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } },
    { projection: { email: 1, keycloak_sub: 1, "metadata.keycloak_sub": 1 } },
  );
  return (
    asString(user?.keycloak_sub) ??
    asString(user?.metadata?.keycloak_sub)
  );
}

async function ensureWebexConnector(
  db: Db,
  payloadStore: MongoEnvelopeCredentialStore,
  apply: boolean,
): Promise<OAuthConnectorDoc | null> {
  const connectors = db.collection<OAuthConnectorDoc>("oauth_connectors");
  const existing = await connectors.findOne({ provider: TARGET_PROVIDER, enabled: true });
  if (existing) return existing;

  const descriptor =
    BUILT_IN_OAUTH_CONNECTORS.find((candidate) => candidate.provider === TARGET_PROVIDER) ??
    BUILT_IN_OAUTH_CONNECTORS.find((candidate) => candidate.provider === SOURCE_VENDOR);
  if (!descriptor) {
    throw new Error("Built-in Webex (Pam) connector descriptor was not found");
  }

  const clientId = process.env.WEBEX_CLIENT_ID || process.env.WEBEX_OAUTH_CLIENT_ID;
  const clientSecret = process.env.WEBEX_CLIENT_SECRET || process.env.WEBEX_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.WEBEX_REDIRECT_URI || process.env.WEBEX_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    console.warn(
      "No enabled Webex (Pam) oauth_connectors row exists and Webex connector env is incomplete; skipping migration. Redeploy with CREDENTIAL_BOOTSTRAP_OAUTH_CONNECTORS=true first, or provide WEBEX_CLIENT_ID/WEBEX_CLIENT_SECRET/WEBEX_REDIRECT_URI to this script.",
    );
    return null;
  }

  const id = randomUUID();
  const clientSecretRef = `oauth_connector:${id}:client_secret`;
  const now = new Date();
  const doc = {
    id,
    name: TARGET_CONNECTOR_NAME,
    provider: TARGET_PROVIDER,
    clientId,
    clientSecretRef,
    authorizationUrl: descriptor.authorizationUrl,
    tokenUrl: descriptor.tokenUrl,
    scopes: splitScopes(process.env.WEBEX_PAM_SCOPES || process.env.WEBEX_SCOPES || process.env.WEBEX_OAUTH_SCOPES, descriptor.scopes),
    redirectUri: normalizeWebexRedirectUri(redirectUri),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  if (!apply) {
    console.log(`[dry-run] would create Webex (Pam) oauth_connectors row id=${id}`);
    return { id, provider: TARGET_PROVIDER, enabled: true };
  }

  await payloadStore.putSecret({ secretRefId: clientSecretRef, plaintext: clientSecret });
  await connectors.insertOne(doc);
  console.log(`created Webex (Pam) oauth_connectors row id=${id}`);
  return doc;
}

async function hasActiveWebexConnection(db: Db, ownerId: string): Promise<boolean> {
  const connections = db.collection<ProviderConnectionDoc>("provider_connections");
  const existing = await connections.findOne({
    provider: TARGET_PROVIDER,
    "owner.type": "user",
    "owner.id": ownerId,
    status: { $in: ["connected", "needs_reauth"] },
  });
  return Boolean(existing);
}

async function disableExistingWebexConnections(db: Db, ownerId: string): Promise<void> {
  await db.collection("provider_connections").updateMany(
    {
      provider: TARGET_PROVIDER,
      "owner.type": "user",
      "owner.id": ownerId,
      status: { $in: ["connected", "needs_reauth"] },
    },
    {
      $set: {
        status: "disabled",
        updatedAt: new Date(),
        disabledByMigration: MIGRATION_ID,
      },
    },
  );
}

async function migrateOne(input: {
  db: Db;
  payloadStore: MongoEnvelopeCredentialStore;
  connector: OAuthConnectorDoc;
  vendor: VendorConnectionDoc;
  ownerId: string;
  apply: boolean;
  force: boolean;
}): Promise<"planned" | "migrated" | "skippedExisting"> {
  const email = asString(input.vendor.user_email)?.toLowerCase();
  const accessToken = asString(input.vendor.access_token);
  if (!email || !accessToken) {
    throw new Error("invalid vendor connection");
  }

  if (!input.force && await hasActiveWebexConnection(input.db, input.ownerId)) {
    console.log(`skip ${email}: active Webex (Pam) provider_connection already exists`);
    return "skippedExisting";
  }

  const id = randomUUID();
  const accessTokenRef = `provider_connection:${id}:access_token`;
  const refreshTokenRef = `provider_connection:${id}:refresh_token`;
  const refreshToken = asString(input.vendor.refresh_token);
  const now = new Date();
  const scopes = asScopes(input.vendor.scopes);
  const doc = {
    id,
    connectorId: input.connector.id,
    provider: TARGET_PROVIDER,
    owner: { type: "user", id: input.ownerId },
    status: refreshToken ? "connected" : "needs_reauth",
    accessTokenRef,
    refreshTokenRef: refreshToken ? refreshTokenRef : "",
    expiresAt: asDate(input.vendor.expires_at),
    connectedAt: asDate(input.vendor.created_at) ?? now,
    updatedAt: now,
    migratedFrom: "vendor_connections",
    migrationId: MIGRATION_ID,
    sourceUserEmail: email,
    ...(scopes ? { requestedScopes: scopes, grantedScopes: scopes } : {}),
  };

  if (!input.apply) {
    console.log(`[dry-run] would migrate ${email} -> owner user:${input.ownerId}`);
    return "planned";
  }

  if (input.force) {
    await disableExistingWebexConnections(input.db, input.ownerId);
  }
  await input.payloadStore.putSecret({ secretRefId: accessTokenRef, plaintext: accessToken });
  if (refreshToken) {
    await input.payloadStore.putSecret({ secretRefId: refreshTokenRef, plaintext: refreshToken });
  }
  await input.db.collection("provider_connections").insertOne(doc);
  console.log(`migrated ${email} -> provider_connection ${id}`);
  return "migrated";
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "caipe";
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required");
  }
  const apply = flag("APPLY") || process.argv.includes("--apply");
  const force = flag("FORCE") || process.argv.includes("--force");
  const allowEmailOwnerFallback =
    flag("ALLOW_EMAIL_OWNER_FALLBACK") || process.argv.includes("--allow-email-owner-fallback");
  const userEmailFilter = (process.env.USER_EMAIL || argValue("user-email") || "").trim().toLowerCase();

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000, retryWrites: false });
  await client.connect();
  try {
    const db = client.db(databaseName);
    const payloadStore = createPayloadStore(db);
    const connector = await ensureWebexConnector(db, payloadStore, apply);
    if (!connector) return;

    const query: Record<string, unknown> = { vendor: SOURCE_VENDOR };
    if (userEmailFilter) {
      query.user_email = userEmailFilter;
    }
    const vendors = await db
      .collection<VendorConnectionDoc>("vendor_connections")
      .find(query)
      .sort({ updated_at: -1 })
      .toArray();

    const stats: MigrationStats = {
      scanned: vendors.length,
      planned: 0,
      migrated: 0,
      skippedExisting: 0,
      skippedInvalid: 0,
      skippedUnresolvedOwner: 0,
    };

    for (const vendor of vendors) {
      const email = asString(vendor.user_email)?.toLowerCase();
      const accessToken = asString(vendor.access_token);
      if (!email || !accessToken) {
        stats.skippedInvalid++;
        console.warn(`skip ${String(vendor._id ?? "<unknown>")}: missing user_email or access_token`);
        continue;
      }

      let ownerId = await findOwnerSubject(db, email);
      if (!ownerId && allowEmailOwnerFallback) {
        ownerId = email;
      }
      if (!ownerId) {
        stats.skippedUnresolvedOwner++;
        console.warn(
          `skip ${email}: no users.keycloak_sub mapping found. Have the user sign in once, or rerun with ALLOW_EMAIL_OWNER_FALLBACK=true only if session.sub is the email in this environment.`,
        );
        continue;
      }

      const outcome = await migrateOne({
        db,
        payloadStore,
        connector,
        vendor,
        ownerId,
        apply,
        force,
      }).catch((error) => {
        stats.skippedInvalid++;
        console.warn(`skip ${email}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (outcome === "planned") stats.planned++;
      if (outcome === "migrated") stats.migrated++;
      if (outcome === "skippedExisting") stats.skippedExisting++;
    }

    console.log(JSON.stringify({ migration: MIGRATION_ID, apply, force, stats }, null, 2));
    if (!apply) {
      console.log("Dry-run only. Re-run with APPLY=true to write provider_connections.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
