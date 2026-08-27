import { randomUUID } from "crypto";

import { KMSClient } from "@aws-sdk/client-kms";
import type { Document } from "mongodb";

import { getCollection } from "@/lib/mongodb";

import { CREDENTIAL_COLLECTIONS } from "./collections";
import { createAwsKmsKeyWrapper,createDevLocalKeyWrapper,createLocalCmkKeyWrapper } from "./key-wrapper";
import { MongoEnvelopeCredentialStore } from "./mongo-envelope-store";
import {
OAuthConnectorService,
ProviderConnectionService,
type OAuthConnectorDocument,
type ProviderConnectionDocument,
type TokenClientResponse,
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
    keyWrapper: createOAuthKeyWrapper,
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
    tokenClient: exchangeOAuthToken,
  });
}

export async function exchangeOAuthToken(
  tokenUrl: string,
  body: Record<string, string>,
): Promise<TokenClientResponse> {
  const parsedUrl = new URL(tokenUrl);
  const isFigmaOAuth =
    parsedUrl.hostname === "api.figma.com" &&
    (parsedUrl.pathname === "/v1/oauth/token" || parsedUrl.pathname === "/v1/oauth/refresh");
  const requestUrl =
    isFigmaOAuth && body.grant_type === "refresh_token"
      ? `${parsedUrl.origin}/v1/oauth/refresh`
      : tokenUrl;
  const requestBody = { ...body };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };
  // Figma requires client credentials via HTTP Basic authentication for both
  // authorization-code exchange and refresh. Other providers retain the
  // existing client_id/client_secret form-body behavior.
  if (isFigmaOAuth) {
    const clientId = requestBody.client_id ?? "";
    const clientSecret = requestBody.client_secret ?? "";
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    delete requestBody.client_id;
    delete requestBody.client_secret;
  }
  const response = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams(requestBody),
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed with ${response.status}`);
  }

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || text.trim().startsWith("{")) {
    return JSON.parse(text) as TokenClientResponse;
  }

  const params = new URLSearchParams(text);
  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? undefined;
  const expiresIn = params.get("expires_in");
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn ? Number(expiresIn) : undefined,
  };
}
