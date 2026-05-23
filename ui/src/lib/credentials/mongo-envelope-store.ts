import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { createCredentialError } from "./errors";
import { DataKeyContext, KeyWrapper } from "./key-wrapper";

interface EncryptedPayloadDocument {
  secretRefId: string;
  algorithm: "AES-256-GCM";
  ciphertext: string;
  encryptedDek: string;
  keyProvider: string;
  cmkId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PayloadCollection {
  findOne(query: { secretRefId: string }): Promise<Record<string, unknown> | null>;
  updateOne(
    query: { secretRefId: string },
    update: { $set: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    options: { upsert: boolean },
  ): Promise<unknown>;
  deleteOne?(query: { secretRefId: string }): Promise<unknown>;
}

interface CiphertextEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface MongoEnvelopeCredentialStoreOptions {
  payloadCollection: PayloadCollection;
  keyWrapper: KeyWrapper;
}

export interface PutSecretInput {
  secretRefId: string;
  plaintext: string;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}

function dataKeyContext(secretRefId: string): DataKeyContext {
  return {
    secretRefId,
    purpose: "credential-secret",
  };
}

function encryptPayload(plaintext: string, dataKey: Uint8Array, secretRefId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(dataKey), iv);
  cipher.setAAD(Buffer.from(secretRefId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: CiphertextEnvelope = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };

  return encodeJson(envelope);
}

function decryptPayload(ciphertextEnvelope: string, dataKey: Uint8Array, secretRefId: string): string {
  const envelope = decodeJson<CiphertextEnvelope>(ciphertextEnvelope);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(dataKey),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(secretRefId, "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function asEncryptedPayload(document: Record<string, unknown>): EncryptedPayloadDocument {
  return document as unknown as EncryptedPayloadDocument;
}

export class MongoEnvelopeCredentialStore {
  private readonly payloadCollection: PayloadCollection;
  private readonly keyWrapper: KeyWrapper;

  constructor(options: MongoEnvelopeCredentialStoreOptions) {
    this.payloadCollection = options.payloadCollection;
    this.keyWrapper = options.keyWrapper;
  }

  async putSecret(input: PutSecretInput): Promise<void> {
    const context = dataKeyContext(input.secretRefId);
    const wrappedDataKey = await this.keyWrapper.generateDataKey(context);
    if (!wrappedDataKey.plaintextDataKey) {
      throw createCredentialError({
        reasonCode: "key_wrap_failed",
        message: "Credential data key generation failed",
        status: 500,
      });
    }

    const now = new Date();
    const payload = {
      secretRefId: input.secretRefId,
      algorithm: "AES-256-GCM",
      ciphertext: encryptPayload(
        input.plaintext,
        wrappedDataKey.plaintextDataKey,
        input.secretRefId,
      ),
      encryptedDek: wrappedDataKey.encryptedDataKey,
      keyProvider: wrappedDataKey.keyProvider,
      cmkId: wrappedDataKey.cmkId,
      updatedAt: now,
    };

    await this.payloadCollection.updateOne(
      { secretRefId: input.secretRefId },
      { $set: payload, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }

  async getSecret(secretRefId: string): Promise<string> {
    const document = await this.payloadCollection.findOne({ secretRefId });
    if (!document) {
      throw createCredentialError({
        reasonCode: "credential_not_found",
        message: "Credential payload was not found",
        status: 404,
      });
    }

    const payload = asEncryptedPayload(document);
    const dataKey = await this.keyWrapper.unwrapDataKey(
      payload.encryptedDek,
      dataKeyContext(secretRefId),
    );

    try {
      return decryptPayload(payload.ciphertext, dataKey, secretRefId);
    } catch {
      throw createCredentialError({
        reasonCode: "decrypt_failed",
        message: "Credential payload decrypt failed",
        status: 500,
      });
    }
  }

  async rotateSecret(secretRefId: string): Promise<void> {
    const plaintext = await this.getSecret(secretRefId);
    await this.putSecret({ secretRefId, plaintext });
  }

  async deleteSecret(secretRefId: string): Promise<void> {
    await this.payloadCollection.deleteOne?.({ secretRefId });
  }
}
