import { randomUUID } from "crypto";

import { KMSClient } from "@aws-sdk/client-kms";
import type { Document } from "mongodb";

import { getCollection } from "@/lib/mongodb";

import { CREDENTIAL_COLLECTIONS } from "./collections";
import { createAwsKmsKeyWrapper, createDevLocalKeyWrapper, createLocalCmkKeyWrapper } from "./key-wrapper";
import { MongoEnvelopeCredentialStore } from "./mongo-envelope-store";
import {
  OAuthConnectorService,
  ProviderConnectionService,
  type OAuthConnectorDocument,
  type ProviderConnectionDocument,
} from "./oauth-service";

function createOAuthKeyWrapper() {
  const keyProvider = process.env.CREDENTIAL_KEY_PROVIDER?.trim() || "local-cmk";
  if (keyProvider === "aws-kms") {
    return createAwsKmsKeyWrapper({
      client: new KMSClient({ region: process.env.CREDENTIAL_KMS_REGION }),
      cmkId: process.env.CREDENTIAL_KMS_CMK_ID || process.env.CREDENTIAL_KMS_KEY_ID || "",
    });
  }

  if (keyProvider === "local-cmk") {
    return createLocalCmkKeyWrapper({
      cmkId: process.env.CREDENTIAL_KMS_CMK_ID || "alias/caipe-local-credentials",
      nodeEnv: process.env.NODE_ENV,
    });
  }

  return createDevLocalKeyWrapper({
    masterKey:
      process.env.CREDENTIAL_DEV_LOCAL_MASTER_KEY ||
      process.env.CREDENTIAL_KMS_CMK_ID ||
      "caipe-local-development-credential-key",
    nodeEnv: process.env.NODE_ENV,
  });
}

async function getOAuthPayloadStore() {
  const encryptedPayloadsCollection = await getCollection(
    CREDENTIAL_COLLECTIONS.encryptedPayloads,
  );
  return new MongoEnvelopeCredentialStore({
    payloadCollection: encryptedPayloadsCollection,
    keyWrapper: createOAuthKeyWrapper(),
  });
}

export async function getOAuthConnectorService(): Promise<OAuthConnectorService> {
  const connectorsCollection = await getCollection<OAuthConnectorDocument & Document>(
    CREDENTIAL_COLLECTIONS.oauthConnectors,
  );
  return new OAuthConnectorService({
    connectorsCollection,
    payloadStore: await getOAuthPayloadStore(),
    idGenerator: randomUUID,
  });
}

export async function getProviderConnectionService(): Promise<ProviderConnectionService> {
  const providerConnectionsCollection = await getCollection<ProviderConnectionDocument & Document>(
    CREDENTIAL_COLLECTIONS.providerConnections,
  );
  const connectorsCollection = await getCollection<OAuthConnectorDocument & Document>(
    CREDENTIAL_COLLECTIONS.oauthConnectors,
  );
  return new ProviderConnectionService({
    providerConnectionsCollection,
    connectorsCollection,
    payloadStore: await getOAuthPayloadStore(),
    tokenClient: async (tokenUrl, body) => {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      });
      if (!response.ok) {
        throw new Error(`OAuth token refresh failed with ${response.status}`);
      }
      return response.json();
    },
  });
}
