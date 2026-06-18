import { SecretService } from "@/lib/credentials/secret-service";

interface MemorySecretRefDoc extends Record<string, unknown> {
  id?: string;
  owner?: { type?: string; id?: string };
  sharedWithTeams?: string[];
}

class MemorySecretRefsCollection {
  docs: MemorySecretRefDoc[] = [];

  async insertOne(doc: MemorySecretRefDoc) {
    this.docs.push(doc);
    return { acknowledged: true };
  }

  find(query: Record<string, unknown>) {
    const docs = this.docs.filter((doc) =>
      Object.entries(query).every(([key, value]) => {
        if (key === "owner.type") return doc.owner?.type === value;
        if (key === "owner.id") return doc.owner?.id === value;
        return doc[key] === value;
      }),
    );
    return {
      sort: () => ({
        toArray: async () => docs,
      }),
    };
  }

  async findOne(query: Record<string, unknown>) {
    return (
      this.docs.find((doc) =>
        Object.entries(query).every(([key, value]) => doc[key] === value),
      ) ?? null
    );
  }

  async updateOne(
    query: Record<string, unknown>,
    update: {
      $set?: Record<string, unknown>;
      $addToSet?: { sharedWithTeams?: string };
      $pull?: { sharedWithTeams?: string };
    },
  ) {
    const doc = await this.findOne(query);
    if (!doc) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(doc, update.$set ?? {});
    if (update.$addToSet?.sharedWithTeams) {
      doc.sharedWithTeams = [...new Set([...(doc.sharedWithTeams ?? []), update.$addToSet.sharedWithTeams])];
    }
    if (update.$pull?.sharedWithTeams) {
      doc.sharedWithTeams = (doc.sharedWithTeams ?? []).filter(
        (team: string) => team !== update.$pull.sharedWithTeams,
      );
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(query: Record<string, unknown>) {
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => doc.id !== query.id);
    return { deletedCount: before - this.docs.length };
  }
}

function createService() {
  const refs = new MemorySecretRefsCollection();
  const payloadStore = {
    putSecret: jest.fn(async () => undefined),
    getSecret: jest.fn(async () => "github-token-value"),
    rotateSecret: jest.fn(async () => undefined),
    deleteSecret: jest.fn(async () => undefined),
  };
  const audit = { insertOne: jest.fn(async () => ({ acknowledged: true })) };
  const authorize = jest.fn(async () => undefined);
  const reconcileOwnerRelationships = jest.fn(async () => undefined);
  const reconcileShare = jest.fn(async () => undefined);
  const deleteShare = jest.fn(async () => undefined);
  const deleteAllRelationships = jest.fn(async () => undefined);

  return {
    refs,
    payloadStore,
    audit,
    authorize,
    reconcileOwnerRelationships,
    reconcileShare,
    deleteShare,
    deleteAllRelationships,
    service: new SecretService({
      secretRefsCollection: refs,
      payloadStore,
      auditCollection: audit,
      authorize,
      reconcileOwnerRelationships,
      reconcileShare,
      deleteShare,
      deleteAllRelationships,
      idGenerator: () => "secret-1",
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    }),
  };
}

describe("SecretService", () => {
  it("creates a secret ref and stores raw material only in the encrypted payload store", async () => {
    const { refs, payloadStore, reconcileOwnerRelationships, service } = createService();

    const result = await service.createSecret({
      session: { sub: "alice-sub" },
      owner: { type: "user", id: "alice-sub" },
      name: "GitHub token",
      type: "bearer_token",
      plaintext: "github-token-value",
    });

    expect(result).toMatchObject({
      id: "secret-1",
      name: "GitHub token",
      maskedPreview: "gith...alue",
    });
    expect(payloadStore.putSecret).toHaveBeenCalledWith({
      secretRefId: "secret-1",
      plaintext: "github-token-value",
    });
    expect(reconcileOwnerRelationships).toHaveBeenCalledWith({
      secretId: "secret-1",
      owner: { type: "user", id: "alice-sub" },
      ownerSubject: "alice-sub",
    });
    expect(JSON.stringify(refs.docs)).not.toContain("github-token-value");
  });

  it("lists only masked secret metadata for an owner", async () => {
    const { service } = createService();
    await service.createSecret({
      session: { sub: "alice-sub" },
      owner: { type: "user", id: "alice-sub" },
      name: "GitHub token",
      type: "bearer_token",
      plaintext: "github-token-value",
    });

    await expect(
      service.listSecrets({
        session: { sub: "alice-sub" },
        owner: { type: "user", id: "alice-sub" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "secret-1",
        maskedPreview: "gith...alue",
      }),
    ]);
  });

  it("rotates, shares, revokes, and deletes without returning raw material", async () => {
    const { refs, payloadStore, reconcileShare, deleteShare, deleteAllRelationships, service } = createService();
    await service.createSecret({
      session: { sub: "alice-sub" },
      owner: { type: "user", id: "alice-sub" },
      name: "GitHub token",
      type: "bearer_token",
      plaintext: "github-token-value",
    });

    await service.rotateSecret({
      session: { sub: "alice-sub" },
      secretId: "secret-1",
      plaintext: "new-token-value",
    });
    await service.shareSecret({
      session: { sub: "alice-sub" },
      secretId: "secret-1",
      teamId: "platform-team",
    });
    await service.revokeSecretShare({
      session: { sub: "alice-sub" },
      secretId: "secret-1",
      teamId: "platform-team",
    });
    await service.deleteSecret({ session: { sub: "alice-sub" }, secretId: "secret-1" });

    expect(payloadStore.putSecret).toHaveBeenLastCalledWith({
      secretRefId: "secret-1",
      plaintext: "new-token-value",
    });
    expect(reconcileShare).toHaveBeenCalledWith("secret-1", "platform-team");
    expect(deleteShare).toHaveBeenCalledWith("secret-1", "platform-team");
    expect(deleteAllRelationships).toHaveBeenCalledWith("secret-1");
    expect(refs.docs).toEqual([]);
  });

  it("supports admin listing and metadata edits without exposing plaintext", async () => {
    const { refs, service } = createService();
    await service.createSecret({
      session: { sub: "alice-sub" },
      owner: { type: "user", id: "alice-sub" },
      name: "GitHub token",
      type: "bearer_token",
      plaintext: "github-token-value",
    });

    await expect(service.listAllSecretsForAdmin()).resolves.toEqual([
      expect.objectContaining({
        id: "secret-1",
        owner: { type: "user", id: "alice-sub" },
        maskedPreview: "gith...alue",
      }),
    ]);

    await service.updateSecretMetadataForAdmin({
      secretId: "secret-1",
      name: "Renamed token",
      description: "Used by GitHub MCP",
    });
    expect(refs.docs[0]).toMatchObject({
      name: "Renamed token",
      description: "Used by GitHub MCP",
    });
    expect(JSON.stringify(refs.docs)).not.toContain("github-token-value");
  });
});
