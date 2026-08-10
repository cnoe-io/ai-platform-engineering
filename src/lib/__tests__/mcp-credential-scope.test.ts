import {
  effectiveConnectionScope,
  normalizeCustomProviderCredentialSource,
} from "@/lib/mcp-credential-scope";
import type { MCPCredentialSource } from "@/types/dynamic-agent";

describe("mcp-credential-scope", () => {
  it("always reports caller scope for provider-only sources", () => {
    const source: MCPCredentialSource = {
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      provider: "github",
    };
    expect(effectiveConnectionScope(source)).toBe("caller");
  });

  it("reports caller scope even for legacy connection-id-only sources", () => {
    // Legacy documents that used the removed "pinned" scope are coerced to
    // caller-scoped — a shared all-callers connection is never honored.
    const source: MCPCredentialSource = {
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      provider_connection_id: "conn-admin",
    };
    expect(effectiveConnectionScope(source)).toBe("caller");
  });

  it("reports caller scope for sources explicitly marked pinned (legacy)", () => {
    const source: MCPCredentialSource = {
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      connection_scope: "pinned",
      provider_connection_id: "conn-admin",
    };
    expect(effectiveConnectionScope(source)).toBe("caller");
  });

  it("normalizes provider sources to caller scope keyed by provider", () => {
    expect(
      normalizeCustomProviderCredentialSource(
        {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          provider: "atlassian",
        },
        [],
      ),
    ).toEqual({
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      connection_scope: "caller",
      provider: "atlassian",
    });
  });

  it("derives the provider from a legacy pinned connection id and caller-scopes it", () => {
    // A legacy "pinned" source carried only a connection id. We resolve the
    // provider from the known connections and rewrite it as caller-scoped so it
    // resolves each caller's OWN connection rather than the admin's.
    expect(
      normalizeCustomProviderCredentialSource(
        {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          connection_scope: "pinned",
          provider_connection_id: "conn-admin",
        },
        [{ id: "conn-admin", provider: "atlassian" }],
      ),
    ).toEqual({
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      connection_scope: "caller",
      provider: "atlassian",
    });
  });

  it("returns null when no provider can be resolved", () => {
    expect(
      normalizeCustomProviderCredentialSource(
        {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          provider_connection_id: "conn-unknown",
        },
        [],
      ),
    ).toBeNull();
  });
});
