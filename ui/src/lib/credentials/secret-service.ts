import { ApiError } from "@/lib/api-error";
import type { ResourceAuthzSession } from "@/lib/rbac/resource-authz";

import { writeCredentialAuditEvent } from "./audit";
import { maskCredentialValue } from "./masking";
import type { CredentialOwnerRef,CredentialSecretType } from "./types";

export interface SecretRefDocument {
  id: string;
  owner: CredentialOwnerRef;
  name: string;
  type: CredentialSecretType;
  description?: string;
  maskedPreview: string;
  sharedWithTeams: string[];
  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date;
}

export interface SecretMetadata {
  id: string;
  owner: CredentialOwnerRef;
  name: string;
  type: CredentialSecretType;
  description?: string;
  maskedPreview: string;
  sharedWithTeams: string[];
  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
}

interface SecretRefsCollection {
  insertOne(doc: SecretRefDocument): Promise<unknown>;
  find(query: Record<string, unknown>): {
    sort(sort: Record<string, 1 | -1>): { toArray(): Promise<SecretRefDocument[]> };
  };
  findOne(query: Record<string, unknown>): Promise<SecretRefDocument | null>;
  updateOne(
    query: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<{ matchedCount?: number; modifiedCount?: number }>;
  deleteOne(query: Record<string, unknown>): Promise<{ deletedCount?: number }>;
}

interface PayloadStore {
  putSecret(input: { secretRefId: string; plaintext: string }): Promise<void>;
  deleteSecret?(secretRefId: string): Promise<void>;
}

type AuthorizeSecretAction = (
  session: ResourceAuthzSession,
  target: { type: "secret_ref"; id: string; action: "read-metadata" | "use" | "manage" | "share" | "audit" },
) => Promise<void>;

export interface SecretServiceOptions {
  secretRefsCollection: SecretRefsCollection;
  payloadStore: PayloadStore;
  authorize: AuthorizeSecretAction;
  reconcileOwnerRelationships?: (input: {
    secretId: string;
    owner: CredentialOwnerRef;
    ownerSubject?: string | null;
  }) => Promise<void>;
  reconcileShare?: (secretId: string, teamId: string) => Promise<void>;
  deleteShare?: (secretId: string, teamId: string) => Promise<void>;
  deleteAllRelationships?: (secretId: string) => Promise<void>;
  idGenerator: () => string;
  now?: () => Date;
}

export interface CreateSecretInput {
  session: ResourceAuthzSession;
  owner: CredentialOwnerRef;
  name: string;
  type: CredentialSecretType;
  plaintext: string;
  description?: string;
}

export interface ListSecretsInput {
  session: ResourceAuthzSession;
  owner: CredentialOwnerRef;
}

export interface RotateSecretInput {
  session: ResourceAuthzSession;
  secretId: string;
  plaintext: string;
}

export interface SecretByIdInput {
  session: ResourceAuthzSession;
  secretId: string;
}

export interface SecretShareInput extends SecretByIdInput {
  teamId: string;
}

export interface AdminUpdateSecretMetadataInput {
  secretId: string;
  name?: string;
  description?: string;
}

function requireNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError(`${field} is required`, 400, "VALIDATION_ERROR");
  }
  return trimmed;
}

function toMetadata(doc: SecretRefDocument): SecretMetadata {
  return {
    id: doc.id,
    owner: doc.owner,
    name: doc.name,
    type: doc.type,
    description: doc.description,
    maskedPreview: doc.maskedPreview,
    sharedWithTeams: doc.sharedWithTeams,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    rotatedAt: doc.rotatedAt?.toISOString(),
  };
}

export class SecretService {
  private readonly secretRefsCollection: SecretRefsCollection;
  private readonly payloadStore: PayloadStore;
  private readonly authorize: AuthorizeSecretAction;
  private readonly reconcileOwnerRelationships: NonNullable<SecretServiceOptions["reconcileOwnerRelationships"]>;
  private readonly reconcileShare: NonNullable<SecretServiceOptions["reconcileShare"]>;
  private readonly deleteShare: NonNullable<SecretServiceOptions["deleteShare"]>;
  private readonly deleteAllRelationships: NonNullable<SecretServiceOptions["deleteAllRelationships"]>;
  private readonly idGenerator: () => string;
  private readonly now: () => Date;

  constructor(options: SecretServiceOptions) {
    this.secretRefsCollection = options.secretRefsCollection;
    this.payloadStore = options.payloadStore;
    this.authorize = options.authorize;
    this.reconcileOwnerRelationships = options.reconcileOwnerRelationships ?? (async () => undefined);
    this.reconcileShare = options.reconcileShare ?? (async () => undefined);
    this.deleteShare = options.deleteShare ?? (async () => undefined);
    this.deleteAllRelationships = options.deleteAllRelationships ?? (async () => undefined);
    this.idGenerator = options.idGenerator;
    this.now = options.now ?? (() => new Date());
  }

  async createSecret(input: CreateSecretInput): Promise<SecretMetadata> {
    const name = requireNonEmptyString(input.name, "name");
    const plaintext = requireNonEmptyString(input.plaintext, "plaintext");
    const id = this.idGenerator();
    const now = this.now();

    const doc: SecretRefDocument = {
      id,
      owner: input.owner,
      name,
      type: input.type,
      description: input.description?.trim() || undefined,
      maskedPreview: maskCredentialValue(plaintext),
      sharedWithTeams: [],
      createdAt: now,
      updatedAt: now,
      rotatedAt: now,
    };

    await this.payloadStore.putSecret({ secretRefId: id, plaintext });
    await this.reconcileOwnerRelationships({
      secretId: id,
      owner: input.owner,
      ownerSubject: typeof input.session.sub === "string" ? input.session.sub : null,
    });
    await this.secretRefsCollection.insertOne(doc);
    writeCredentialAuditEvent({
      action: "credential.create",
      actor: { type: "user", id: String(input.session.sub ?? "unknown") },
      resource: { type: "secret_ref", id },
      result: "success",
    });

    return toMetadata(doc);
  }

  async listSecrets(input: ListSecretsInput): Promise<SecretMetadata[]> {
    const docs = await this.secretRefsCollection
      .find({ "owner.type": input.owner.type, "owner.id": input.owner.id })
      .sort({ name: 1 })
      .toArray();

    const visible: SecretMetadata[] = [];
    for (const doc of docs) {
      try {
        await this.authorize(input.session, {
          type: "secret_ref",
          id: doc.id,
          action: "read-metadata",
        });
        visible.push(toMetadata(doc));
      } catch {
        // Drop denied resources from list responses to avoid disclosing existence.
      }
    }
    return visible;
  }

  async listAllSecretsForAdmin(): Promise<SecretMetadata[]> {
    const docs = await this.secretRefsCollection.find({}).sort({ updatedAt: -1 }).toArray();
    return docs.map(toMetadata);
  }

  async updateSecretMetadataForAdmin(input: AdminUpdateSecretMetadataInput): Promise<SecretMetadata> {
    const doc = await this.getSecretRef(input.secretId);
    const update: Partial<SecretRefDocument> = { updatedAt: this.now() };
    if (input.name !== undefined) {
      update.name = requireNonEmptyString(input.name, "name");
    }
    if (input.description !== undefined) {
      update.description = input.description.trim() || undefined;
    }
    await this.secretRefsCollection.updateOne({ id: input.secretId }, { $set: update });
    return toMetadata({ ...doc, ...update });
  }

  async deleteSecretForAdmin(secretId: string): Promise<void> {
    await this.getSecretRef(secretId);
    await this.payloadStore.deleteSecret?.(secretId);
    await this.deleteAllRelationships(secretId);
    await this.secretRefsCollection.deleteOne({ id: secretId });
  }

  async getSecretMetadata(input: SecretByIdInput): Promise<SecretMetadata> {
    const doc = await this.getSecretRef(input.secretId);
    await this.authorize(input.session, { type: "secret_ref", id: input.secretId, action: "read-metadata" });
    return toMetadata(doc);
  }

  async rotateSecret(input: RotateSecretInput): Promise<SecretMetadata> {
    const plaintext = requireNonEmptyString(input.plaintext, "plaintext");
    const doc = await this.getSecretRef(input.secretId);
    await this.authorize(input.session, { type: "secret_ref", id: input.secretId, action: "manage" });

    const now = this.now();
    await this.payloadStore.putSecret({ secretRefId: input.secretId, plaintext });
    await this.secretRefsCollection.updateOne(
      { id: input.secretId },
      {
        $set: {
          maskedPreview: maskCredentialValue(plaintext),
          updatedAt: now,
          rotatedAt: now,
        },
      },
    );
    writeCredentialAuditEvent({
      action: "credential.rotate",
      actor: { type: "user", id: String(input.session.sub ?? "unknown") },
      resource: { type: "secret_ref", id: input.secretId },
      result: "success",
    });

    return toMetadata({
      ...doc,
      maskedPreview: maskCredentialValue(plaintext),
      updatedAt: now,
      rotatedAt: now,
    });
  }

  async shareSecret(input: SecretShareInput): Promise<void> {
    await this.getSecretRef(input.secretId);
    await this.authorize(input.session, { type: "secret_ref", id: input.secretId, action: "share" });
    const teamId = requireNonEmptyString(input.teamId, "teamId");
    await this.reconcileShare(input.secretId, teamId);
    await this.secretRefsCollection.updateOne(
      { id: input.secretId },
      { $addToSet: { sharedWithTeams: teamId } },
    );
  }

  async revokeSecretShare(input: SecretShareInput): Promise<void> {
    await this.getSecretRef(input.secretId);
    await this.authorize(input.session, { type: "secret_ref", id: input.secretId, action: "share" });
    const teamId = requireNonEmptyString(input.teamId, "teamId");
    await this.deleteShare(input.secretId, teamId);
    await this.secretRefsCollection.updateOne(
      { id: input.secretId },
      { $pull: { sharedWithTeams: teamId } },
    );
  }

  async deleteSecret(input: SecretByIdInput): Promise<void> {
    await this.getSecretRef(input.secretId);
    await this.authorize(input.session, { type: "secret_ref", id: input.secretId, action: "manage" });
    await this.payloadStore.deleteSecret?.(input.secretId);
    await this.deleteAllRelationships(input.secretId);
    await this.secretRefsCollection.deleteOne({ id: input.secretId });
  }

  private async getSecretRef(secretId: string): Promise<SecretRefDocument> {
    const doc = await this.secretRefsCollection.findOne({ id: secretId });
    if (!doc) {
      throw new ApiError("Credential secret was not found", 404, "CREDENTIAL_NOT_FOUND");
    }
    return doc;
  }
}
