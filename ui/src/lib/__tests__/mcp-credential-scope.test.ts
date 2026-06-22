import {
  effectiveConnectionScope,
  findPinnedCredentialSource,
  normalizeCustomProviderCredentialSource,
} from "@/lib/mcp-credential-scope";
import type { MCPCredentialSource } from "@/types/dynamic-agent";

describe("mcp-credential-scope", () => {
  it("defaults legacy provider-only sources to caller scope", () => {
    const source: MCPCredentialSource = {
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      provider: "github",
    };
    expect(effectiveConnectionScope(source)).toBe("caller");
  });

  it("treats legacy connection-id-only sources as pinned", () => {
    const source: MCPCredentialSource = {
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      provider_connection_id: "conn-admin",
    };
    expect(effectiveConnectionScope(source)).toBe("pinned");
  });

  it("normalizes pinned custom sources without provider", () => {
    expect(
      normalizeCustomProviderCredentialSource(
        {
          kind: "provider_connection",
          target: "header",
          name: "X-CAIPE-Provider-Token",
          connection_scope: "pinned",
          provider_connection_id: "conn-admin",
          provider: "atlassian",
        },
        [{ id: "conn-admin", provider: "atlassian" }],
      ),
    ).toEqual({
      kind: "provider_connection",
      target: "header",
      name: "X-CAIPE-Provider-Token",
      connection_scope: "pinned",
      provider_connection_id: "conn-admin",
    });
  });

  it("finds pinned credential source on server config", () => {
    const sources: MCPCredentialSource[] = [
      {
        kind: "provider_connection",
        target: "header",
        name: "X-CAIPE-Provider-Token",
        connection_scope: "pinned",
        provider_connection_id: "conn-admin",
      },
    ];
    expect(findPinnedCredentialSource(sources, "conn-admin")).toBeTruthy();
    expect(findPinnedCredentialSource(sources, "conn-other")).toBeUndefined();
  });
});
