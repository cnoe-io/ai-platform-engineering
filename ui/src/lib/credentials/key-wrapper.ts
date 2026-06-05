import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";

import { createCredentialError } from "./errors";

export type CredentialKeyProvider = "aws-kms" | "local-cmk" | "dev-local";

export interface DataKeyContext {
  secretRefId: string;
  purpose: string;
}

export interface WrappedDataKey {
  plaintextDataKey?: Uint8Array;
  encryptedDataKey: string;
  keyProvider: CredentialKeyProvider;
  cmkId: string | null;
}

export interface KeyWrapper {
  readonly keyProvider: CredentialKeyProvider;
  readonly cmkId: string | null;
  generateDataKey(context: DataKeyContext): Promise<WrappedDataKey>;
  wrapDataKey(dataKey: Uint8Array, context?: DataKeyContext): Promise<WrappedDataKey>;
  unwrapDataKey(encryptedDataKey: string, context?: DataKeyContext): Promise<Uint8Array>;
}

export interface DevLocalKeyWrapperOptions {
  masterKey: string;
  nodeEnv?: string;
  keyProvider?: Exclude<CredentialKeyProvider, "aws-kms">;
  cmkId?: string | null;
  /**
   * Local prod-parity escape hatch. When the runtime is NODE_ENV=production the
   * local (`dev-local`/`local-cmk`) wrappers refuse to run, because they derive
   * the key-encryption key from local material instead of a real KMS/HSM and
   * must never silently protect credentials in a real production deployment.
   *
   * Setting this to `true` (or env `CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP=true`)
   * relaxes that guard so a developer can exercise the credential store against
   * the prod-parity UI image locally. It is INSECURE and must never be enabled
   * in a real production environment.
   */
  allowInsecureProductionKeyWrap?: boolean;
}

/** Env var name for the local prod-parity key-wrap escape hatch (dev-only). */
export const ALLOW_INSECURE_LOCAL_KEY_WRAP_ENV = "CREDENTIAL_ALLOW_INSECURE_LOCAL_KEY_WRAP";

function insecureLocalKeyWrapAllowed(optionOverride?: boolean): boolean {
  if (typeof optionOverride === "boolean") {
    return optionOverride;
  }
  return process.env[ALLOW_INSECURE_LOCAL_KEY_WRAP_ENV]?.trim().toLowerCase() === "true";
}

export interface AwsKmsKeyWrapperOptions {
  client: { send(command: object): Promise<unknown> };
  cmkId: string;
}

interface DevLocalEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}

function deriveDevLocalKek(masterKey: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(masterKey, "utf8"),
      Buffer.from("caipe-credential-store", "utf8"),
      Buffer.from("dev-local-key-wrapper", "utf8"),
      32,
    ),
  );
}

function deriveLocalCmkMaterial(cmkId: string): string {
  return `caipe-local-cmk:${cmkId}`;
}

function encryptionContext(context?: DataKeyContext): Record<string, string> | undefined {
  if (!context) {
    return undefined;
  }

  return {
    purpose: context.purpose,
    secretRefId: context.secretRefId,
  };
}

function kmsFailure(error: unknown, fallbackReason: "decrypt_failed" | "key_wrap_failed"): Error {
  const name = error instanceof Error ? error.name : "";
  if (name === "AccessDeniedException" || name === "KMSAccessDeniedException") {
    return createCredentialError({
      reasonCode: "kms_access_denied",
      message: "KMS access denied for credential key wrapping",
      status: 403,
    });
  }

  if (name === "ServiceUnavailableException" || name === "ThrottlingException") {
    return createCredentialError({
      reasonCode: "kms_unavailable",
      message: "KMS is unavailable for credential key wrapping",
      status: 503,
    });
  }

  return createCredentialError({
    reasonCode: fallbackReason,
    message:
      fallbackReason === "decrypt_failed"
        ? "Credential data key unwrap failed"
        : "Credential data key wrap failed",
    status: 500,
  });
}

export function createDevLocalKeyWrapper(options: DevLocalKeyWrapperOptions): KeyWrapper {
  const keyProvider = options.keyProvider ?? "dev-local";
  if ((options.nodeEnv ?? process.env.NODE_ENV) === "production") {
    if (!insecureLocalKeyWrapAllowed(options.allowInsecureProductionKeyWrap)) {
      throw new Error(`${keyProvider} key wrapping is not allowed in production`);
    }
    // Explicit dev-only opt-in: warn loudly on every wrapper construction so
    // this can never be mistaken for a safe production posture.
    console.warn(
      `[credentials] SECURITY WARNING: ${keyProvider} key wrapping is running under ` +
        `NODE_ENV=production because ${ALLOW_INSECURE_LOCAL_KEY_WRAP_ENV}=true. Credential ` +
        `data keys are wrapped with locally-derived material, NOT a real KMS/HSM. This is ` +
        `intended for LOCAL prod-parity testing ONLY — never enable it in a real ` +
        `production deployment.`,
    );
  }

  const kek = deriveDevLocalKek(options.masterKey);

  async function wrapDataKey(dataKey: Uint8Array): Promise<WrappedDataKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", kek, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(dataKey)), cipher.final()]);
    const envelope: DevLocalEnvelope = {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };

    return {
      encryptedDataKey: encodeJson(envelope),
      keyProvider,
      cmkId: options.cmkId ?? null,
    };
  }

  return {
    keyProvider,
    cmkId: options.cmkId ?? null,
    async generateDataKey(): Promise<WrappedDataKey> {
      const plaintextDataKey = randomBytes(32);
      const wrapped = await wrapDataKey(plaintextDataKey);
      return { ...wrapped, plaintextDataKey };
    },
    wrapDataKey,
    async unwrapDataKey(encryptedDataKey: string): Promise<Uint8Array> {
      const envelope = decodeJson<DevLocalEnvelope>(encryptedDataKey);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        kek,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final(),
      ]);
    },
  };
}

export function createLocalCmkKeyWrapper(options: {
  cmkId: string;
  nodeEnv?: string;
  allowInsecureProductionKeyWrap?: boolean;
}): KeyWrapper {
  return createDevLocalKeyWrapper({
    masterKey: deriveLocalCmkMaterial(options.cmkId),
    nodeEnv: options.nodeEnv,
    keyProvider: "local-cmk",
    cmkId: options.cmkId,
    allowInsecureProductionKeyWrap: options.allowInsecureProductionKeyWrap,
  });
}

export function createAwsKmsKeyWrapper(options: AwsKmsKeyWrapperOptions): KeyWrapper {
  return {
    keyProvider: "aws-kms",
    cmkId: options.cmkId,
    async generateDataKey(context: DataKeyContext): Promise<WrappedDataKey> {
      try {
        const response = (await options.client.send(
          new GenerateDataKeyCommand({
            KeyId: options.cmkId,
            NumberOfBytes: 32,
            EncryptionContext: encryptionContext(context),
          }),
        )) as { CiphertextBlob?: Uint8Array; Plaintext?: Uint8Array };

        if (!response.Plaintext || !response.CiphertextBlob) {
          throw new Error("KMS GenerateDataKey response is missing key material");
        }

        return {
          plaintextDataKey: response.Plaintext,
          encryptedDataKey: Buffer.from(response.CiphertextBlob).toString("base64"),
          keyProvider: "aws-kms",
          cmkId: options.cmkId,
        };
      } catch (error) {
        throw kmsFailure(error, "key_wrap_failed");
      }
    },
    async wrapDataKey(): Promise<WrappedDataKey> {
      throw createCredentialError({
        reasonCode: "key_wrap_failed",
        message: "AWS KMS key wrapping requires GenerateDataKey",
        status: 500,
      });
    },
    async unwrapDataKey(encryptedDataKey: string, context?: DataKeyContext): Promise<Uint8Array> {
      try {
        const response = (await options.client.send(
          new DecryptCommand({
            CiphertextBlob: Buffer.from(encryptedDataKey, "base64"),
            EncryptionContext: encryptionContext(context),
          }),
        )) as { Plaintext?: Uint8Array };

        if (!response.Plaintext) {
          throw new Error("KMS Decrypt response is missing key material");
        }

        return response.Plaintext;
      } catch (error) {
        throw kmsFailure(error, "decrypt_failed");
      }
    },
  };
}
