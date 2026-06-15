import { randomUUID } from "crypto";

import { KMSClient } from "@aws-sdk/client-kms";

import { getCollection } from "@/lib/mongodb";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";

import { CREDENTIAL_COLLECTIONS } from "./collections";
import { createAwsKmsKeyWrapper,createDevLocalKeyWrapper,createLocalCmkKeyWrapper } from "./key-wrapper";
import { MongoEnvelopeCredentialStore } from "./mongo-envelope-store";
import {
deleteAllSecretRefRelationships,
deleteSecretRefShare,
reconcileSecretRefOwnerRelationships,
reconcileSecretRefShare,
} from "./secret-openfga";
import { SecretService,type SecretRefDocument } from "./secret-service";

function createConfiguredKeyWrapper() {
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

export async function getCredentialSecretService(): Promise<SecretService> {
  const secretRefsCollection = await getCollection<SecretRefDocument>(
    CREDENTIAL_COLLECTIONS.secretRefs,
  );
  const encryptedPayloadsCollection = await getCollection(
    CREDENTIAL_COLLECTIONS.encryptedPayloads,
  );
  const auditCollection = await getCollection(CREDENTIAL_COLLECTIONS.auditEvents);

  return new SecretService({
    secretRefsCollection,
    payloadStore: new MongoEnvelopeCredentialStore({
      payloadCollection: encryptedPayloadsCollection,
      keyWrapper: createConfiguredKeyWrapper(),
    }),
    auditCollection,
    authorize: requireResourcePermission,
    reconcileOwnerRelationships: reconcileSecretRefOwnerRelationships,
    reconcileShare: reconcileSecretRefShare,
    deleteShare: deleteSecretRefShare,
    deleteAllRelationships: deleteAllSecretRefRelationships,
    idGenerator: randomUUID,
  });
}
