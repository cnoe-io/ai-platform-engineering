export type CredentialOwnerType = "organization" | "team" | "user";
export type CredentialSecretType = "api_key" | "basic_auth" | "bearer_token" | "custom";
export type ProviderConnectionStatus =
  | "connected"
  | "disabled"
  | "expired"
  | "reauthorization_required"
  | "revoked";

export interface CredentialOwnerRef {
  type: CredentialOwnerType;
  id: string;
}

export interface CredentialSecretRef {
  id: string;
  owner: CredentialOwnerRef;
  name: string;
  type: CredentialSecretType;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
}

export interface CredentialEncryptedPayload {
  secretRefId: string;
  ciphertext: string;
  encryptedDek: string;
  keyProvider: "aws-kms" | "local-cmk" | "dev-local";
  cmkId: string | null;
  algorithm: "AES-256-GCM";
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthConnectorDescriptor {
  key: string;
  displayName: string;
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  enabled: boolean;
  builtIn: boolean;
}

export interface ProviderConnection {
  id: string;
  connectorKey: string;
  subject: string;
  owner: CredentialOwnerRef;
  status: ProviderConnectionStatus;
  scopes: string[];
  connectedAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}
