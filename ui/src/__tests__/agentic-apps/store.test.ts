/**
 * @jest-environment node
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { AgenticAppManifest } from "@/types/agentic-app";

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
}));

describe("agentic app store", () => {
  const finopsManifest: AgenticAppManifest = {
    id: "finops",
    displayName: "FinOps Dashboard",
    description: "Cloud cost",
    apiVersion: "1.0",
    runtime: {
      kind: "proxied-next-zone",
      mountPath: "/apps/finops",
      origin: "http://localhost:3010",
    },
    surfaces: { showInHub: true },
    access: { tokenScopes: ["finops:read"] },
    health: { endpoint: "/healthz" },
  };

  beforeEach(() => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    getCollection.mockReset();
  });

  it("listAppPackages uses find + sort and returns docs in sorted order", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const docs = [
      { packageId: "zebra", manifest: { id: "zebra" } },
      { packageId: "alpha", manifest: { id: "alpha" } },
    ];
    const toArray = jest.fn().mockResolvedValue([docs[1], docs[0]]);
    const sort = jest.fn().mockReturnValue({ toArray });
    const find = jest.fn().mockReturnValue({ sort });

    getCollection.mockResolvedValue({ find });

    const {
      listAppPackages,
      AGENTIC_APP_PACKAGES_COLLECTION,
    } = await import("@/lib/agentic-apps/store");

    const out = await listAppPackages();

    expect(getCollection).toHaveBeenCalledWith(AGENTIC_APP_PACKAGES_COLLECTION);
    expect(find).toHaveBeenCalledWith({});
    expect(sort).toHaveBeenCalledWith({ packageId: 1 });
    expect(toArray).toHaveBeenCalled();
    expect(out).toEqual([docs[1], docs[0]]);
  });

  it("upsertAppPackageFromManifest issues $set and $unset so optional fields do not stay stale", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ updateOne });

    const { upsertAppPackageFromManifest, AGENTIC_APP_PACKAGES_COLLECTION } =
      await import("@/lib/agentic-apps/store");

    await upsertAppPackageFromManifest({
      packageId: "finops",
      source: "admin-import",
      manifest: finopsManifest,
      importedAt: "2026-05-07T00:00:00.000Z",
      importedBy: "admin@example.com",
    });

    expect(getCollection).toHaveBeenCalledWith(AGENTIC_APP_PACKAGES_COLLECTION);
    expect(updateOne).toHaveBeenCalledWith(
      { packageId: "finops" },
      expect.objectContaining({
        $set: expect.objectContaining({
          packageId: "finops",
          source: "admin-import",
          manifest: finopsManifest,
          importedAt: "2026-05-07T00:00:00.000Z",
          importedBy: "admin@example.com",
        }),
        $unset: { catalog: "" },
      }),
      { upsert: true },
    );
  });

  it("upsertAppPackageFromManifest $unsets all optional package fields when omitted", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ updateOne });

    const { upsertAppPackageFromManifest } = await import("@/lib/agentic-apps/store");

    await upsertAppPackageFromManifest({
      packageId: "finops",
      source: "builtin",
      manifest: finopsManifest,
    });

    expect(updateOne).toHaveBeenCalledWith(
      { packageId: "finops" },
      expect.objectContaining({
        $set: expect.objectContaining({
          packageId: "finops",
          source: "builtin",
          manifest: finopsManifest,
        }),
        $unset: {
          importedAt: "",
          importedBy: "",
          catalog: "",
        },
      }),
      { upsert: true },
    );
  });

  it("upsertAppPackageFromManifest throws when packageId mismatches manifest.id", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn();
    getCollection.mockResolvedValue({ updateOne });

    const { upsertAppPackageFromManifest } = await import("@/lib/agentic-apps/store");

    await expect(
      upsertAppPackageFromManifest({
        packageId: "wrong-id",
        source: "admin-import",
        manifest: finopsManifest,
      }),
    ).rejects.toThrow(/packageId "wrong-id" must match manifest.id "finops"/);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("installAppPackage upserts installation with installed and enabled true by default", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ updateOne });

    const { installAppPackage, AGENTIC_APP_INSTALLATIONS_COLLECTION } =
      await import("@/lib/agentic-apps/store");

    await installAppPackage({ appId: "finops", packageId: "finops" });

    expect(getCollection).toHaveBeenCalledWith(AGENTIC_APP_INSTALLATIONS_COLLECTION);
    expect(updateOne).toHaveBeenCalledWith(
      { appId: "finops" },
      expect.objectContaining({
        $set: expect.objectContaining({
          installed: true,
          enabled: true,
          appId: "finops",
          packageId: "finops",
        }),
      }),
      { upsert: true },
    );
    expect(updateOne.mock.calls[0][1].$set).not.toHaveProperty("isDefaultLanding");
  });

  it("installAppPackage persists explicit isDefaultLanding false", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ updateOne });

    const { installAppPackage } = await import("@/lib/agentic-apps/store");

    await installAppPackage({
      appId: "finops",
      packageId: "finops",
      isDefaultLanding: false,
    });

    expect(updateOne).toHaveBeenCalledWith(
      { appId: "finops" },
      expect.objectContaining({
        $set: expect.objectContaining({
          isDefaultLanding: false,
        }),
      }),
      { upsert: true },
    );
  });

  it("installAppPackage leaves isDefaultLanding out of $set when omitted (partial updates)", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ updateOne });

    const { installAppPackage } = await import("@/lib/agentic-apps/store");

    await installAppPackage({
      appId: "finops",
      packageId: "finops",
      enabled: false,
    });

    const $set = updateOne.mock.calls[0][1].$set as Record<string, unknown>;
    expect($set).not.toHaveProperty("isDefaultLanding");
    expect($set.enabled).toBe(false);
  });

  it("listEffectiveAppsForUser merges installations with packages and exposes launch-oriented fields", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const installationRow = {
      appId: "finops",
      packageId: "finops",
      installed: true,
      enabled: true,
      isDefaultLanding: false,
    };
    const installationFind = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([installationRow]),
    });
    const packageFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          {
            packageId: "finops",
            source: "builtin",
            manifest: finopsManifest,
          },
        ]),
    });

    const {
      listEffectiveAppsForUser,
      AGENTIC_APP_INSTALLATIONS_COLLECTION,
      AGENTIC_APP_PACKAGES_COLLECTION,
    } = await import("@/lib/agentic-apps/store");

    getCollection.mockImplementation(async (name: string) => {
      if (name === AGENTIC_APP_INSTALLATIONS_COLLECTION) {
        return { find: installationFind };
      }
      if (name === AGENTIC_APP_PACKAGES_COLLECTION) {
        return { find: packageFind };
      }
      return {};
    });

    const effective = await listEffectiveAppsForUser({
      roles: ["user"],
      groups: [],
    });

    expect(installationFind).toHaveBeenCalledWith({ installed: true, enabled: true });
    expect(packageFind).toHaveBeenCalledWith({ packageId: { $in: ["finops"] } });
    expect(effective).toEqual([
      expect.objectContaining({
        appId: "finops",
        packageId: "finops",
        manifest: finopsManifest,
        launchPath: "/apps/finops",
        runtime: finopsManifest.runtime,
        access: finopsManifest.access,
      }),
    ]);
  });

  it("listEffectiveAppsForUser excludes apps when persisted manifest.access is missing (deny by default, no throw)", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const raw = { ...finopsManifest } as Record<string, unknown>;
    delete raw.access;
    const corruptManifest = raw as unknown as AgenticAppManifest;

    const installationFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          {
            appId: "finops",
            packageId: "finops",
            installed: true,
            enabled: true,
          },
        ]),
    });
    const packageFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { packageId: "finops", source: "builtin", manifest: corruptManifest },
        ]),
    });

    const {
      listEffectiveAppsForUser,
      AGENTIC_APP_INSTALLATIONS_COLLECTION,
      AGENTIC_APP_PACKAGES_COLLECTION,
    } = await import("@/lib/agentic-apps/store");

    getCollection.mockImplementation(async (name: string) => {
      if (name === AGENTIC_APP_INSTALLATIONS_COLLECTION) {
        return { find: installationFind };
      }
      if (name === AGENTIC_APP_PACKAGES_COLLECTION) {
        return { find: packageFind };
      }
      return {};
    });

    await expect(
      listEffectiveAppsForUser({ roles: ["user"], groups: [] }),
    ).resolves.toEqual([]);
  });

  it("listEffectiveAppsForUser excludes apps when the user fails role-based access gates", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const gatedManifest: AgenticAppManifest = {
      ...finopsManifest,
      access: {
        tokenScopes: ["finops:read"],
        requiredRoles: ["admin"],
      },
    };

    const installationFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          {
            appId: "finops",
            packageId: "finops",
            installed: true,
            enabled: true,
          },
        ]),
    });
    const packageFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { packageId: "finops", source: "builtin", manifest: gatedManifest },
        ]),
    });

    const {
      listEffectiveAppsForUser,
      AGENTIC_APP_INSTALLATIONS_COLLECTION,
      AGENTIC_APP_PACKAGES_COLLECTION,
    } = await import("@/lib/agentic-apps/store");

    getCollection.mockImplementation(async (name: string) => {
      if (name === AGENTIC_APP_INSTALLATIONS_COLLECTION) {
        return { find: installationFind };
      }
      if (name === AGENTIC_APP_PACKAGES_COLLECTION) {
        return { find: packageFind };
      }
      return {};
    });

    const effective = await listEffectiveAppsForUser({
      roles: ["user"],
      groups: [],
    });

    expect(effective).toEqual([]);
  });

  it("listEffectiveAppsForUser allows admins to launch apps gated to users", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const installationFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          {
            appId: "finops",
            packageId: "finops",
            installed: true,
            enabled: true,
          },
        ]),
    });
    const packageFind = jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { packageId: "finops", source: "builtin", manifest: finopsManifest },
        ]),
    });

    const {
      listEffectiveAppsForUser,
      AGENTIC_APP_INSTALLATIONS_COLLECTION,
      AGENTIC_APP_PACKAGES_COLLECTION,
    } = await import("@/lib/agentic-apps/store");

    getCollection.mockImplementation(async (name: string) => {
      if (name === AGENTIC_APP_INSTALLATIONS_COLLECTION) {
        return { find: installationFind };
      }
      if (name === AGENTIC_APP_PACKAGES_COLLECTION) {
        return { find: packageFind };
      }
      return {};
    });

    await expect(
      listEffectiveAppsForUser({ roles: ["admin"], groups: [] }),
    ).resolves.toEqual([
      expect.objectContaining({
        appId: "finops",
      }),
    ]);
  });

  it("exports collection constants for PDP, token, webhook, assistant context, health, and audit records", async () => {
    const store = await import("@/lib/agentic-apps/store");

    expect(store.AGENTIC_APP_PDP_DECISIONS_COLLECTION).toBe("agentic_app_pdp_decisions");
    expect(store.AGENTIC_APP_TOKEN_GRANTS_COLLECTION).toBe("agentic_app_token_grants");
    expect(store.AGENTIC_APP_WEBHOOK_DELIVERIES_COLLECTION).toBe(
      "agentic_app_webhook_deliveries",
    );
    expect(store.AGENTIC_APP_ASSISTANT_CONTEXTS_COLLECTION).toBe(
      "agentic_app_assistant_contexts",
    );
    expect(store.AGENTIC_APP_HEALTH_SNAPSHOTS_COLLECTION).toBe(
      "agentic_app_health_snapshots",
    );
    expect(store.AGENTIC_APP_EVENTS_COLLECTION).toBe("agentic_app_events");
  });

  it("appends queryable platform records to their dedicated collections", async () => {
    const { getCollection } = jest.requireMock("@/lib/mongodb") as {
      getCollection: jest.Mock;
    };
    const insertOne = jest.fn().mockResolvedValue({ acknowledged: true });
    getCollection.mockResolvedValue({ insertOne });

    const store = await import("@/lib/agentic-apps/store");

    await store.appendPdpDecision({
      decisionId: "dec_1",
      correlationId: "corr_1",
      appId: "neutral-app",
      action: "app.proxy.request",
      effect: "allow",
      reasonCode: "allowed",
      issuedAt: "2026-05-09T18:00:00.000Z",
      expiresAt: "2026-05-09T18:05:00.000Z",
    });
    await store.appendAppTokenGrant({
      jti: "tok_1",
      decisionId: "dec_1",
      correlationId: "corr_1",
      appId: "neutral-app",
      audience: "agentic-app:neutral-app",
      scopes: ["neutral:read"],
      issuedAt: "2026-05-09T18:00:00.000Z",
      expiresAt: "2026-05-09T18:05:00.000Z",
      tokenHash: "sha256-token",
    });
    await store.appendWebhookDelivery({
      deliveryId: "wh_1",
      appId: "neutral-app",
      provider: "github",
      channel: "repo-events",
      status: "forwarded",
      bodySha256: "sha256-body",
      receivedAt: "2026-05-09T18:00:00.000Z",
    });
    await store.appendAssistantContext({
      contextId: "ctx_1",
      appId: "neutral-app",
      sessionId: "session_1",
      schemaVersion: "1.0",
      route: "/",
      payloadSizeBytes: 42,
      validationStatus: "accepted",
      createdAt: "2026-05-09T18:00:00.000Z",
      expiresAt: "2026-05-09T18:15:00.000Z",
    });
    await store.appendHealthSnapshot({
      appId: "neutral-app",
      status: "healthy",
      checkedAt: "2026-05-09T18:00:00.000Z",
      expiresAt: "2026-05-09T18:05:00.000Z",
    });

    expect(getCollection).toHaveBeenNthCalledWith(
      1,
      store.AGENTIC_APP_PDP_DECISIONS_COLLECTION,
    );
    expect(getCollection).toHaveBeenNthCalledWith(
      2,
      store.AGENTIC_APP_TOKEN_GRANTS_COLLECTION,
    );
    expect(getCollection).toHaveBeenNthCalledWith(
      3,
      store.AGENTIC_APP_WEBHOOK_DELIVERIES_COLLECTION,
    );
    expect(getCollection).toHaveBeenNthCalledWith(
      4,
      store.AGENTIC_APP_ASSISTANT_CONTEXTS_COLLECTION,
    );
    expect(getCollection).toHaveBeenNthCalledWith(
      5,
      store.AGENTIC_APP_HEALTH_SNAPSHOTS_COLLECTION,
    );
    expect(insertOne).toHaveBeenCalledTimes(5);
  });
});
