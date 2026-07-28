/**
 * @jest-environment node
 */
import JSZip from "jszip";

import { buildTomeMcpbBundle } from "../build-bundle";

// These tests intentionally traverse and compress the installed mcp-remote
// dependency closure. That work can exceed Jest's 5-second default when the
// full test suite is running concurrently on CI.
jest.setTimeout(30_000);

describe("buildTomeMcpbBundle", () => {
  it("produces a zip with a valid manifest.json and a self-contained mcp-remote", async () => {
    const buffer = await buildTomeMcpbBundle({ origin: "http://localhost:3000", allowHttp: true });
    const zip = await JSZip.loadAsync(buffer);

    const manifestFile = zip.file("manifest.json");
    expect(manifestFile).not.toBeNull();
    const manifest = JSON.parse(await manifestFile!.async("string"));

    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.name).toBe("tome-mcp");
    expect(manifest.server.entry_point).toBe("node_modules/mcp-remote/dist/proxy.js");
    expect(manifest.server.mcp_config.args).toEqual(
      expect.arrayContaining(["http://localhost:3000/api/tome/mcp", "8085", "--allow-http"]),
    );

    const proxyEntry = zip.file("node_modules/mcp-remote/dist/proxy.js");
    expect(proxyEntry).not.toBeNull();
    const proxySource = await proxyEntry!.async("string");
    expect(proxySource.length).toBeGreaterThan(0);

    // Self-contained: mcp-remote's own dependencies (hoisted, not nested)
    // must be present too, not just mcp-remote's own folder.
    expect(zip.file("node_modules/express/package.json")).not.toBeNull();
    expect(zip.file("node_modules/open/package.json")).not.toBeNull();

    // express pins an older `debug` than the hoisted top-level copy, so npm
    // nests its own node_modules/debug — must survive as a nested entry,
    // not get silently skipped or collapsed to the (incompatible) top-level
    // version.
    expect(zip.file("node_modules/express/node_modules/debug/package.json")).not.toBeNull();
  });

  it("omits --allow-http for a real https:// origin", async () => {
    const buffer = await buildTomeMcpbBundle({
      origin: "https://caipe.example.com",
      allowHttp: false,
    });
    const zip = await JSZip.loadAsync(buffer);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));

    expect(manifest.server.mcp_config.args).not.toContain("--allow-http");
    expect(manifest.server.mcp_config.args).toContain("https://caipe.example.com/api/tome/mcp");
  });

  it("caches the built buffer per (origin, allowHttp)", async () => {
    const first = await buildTomeMcpbBundle({ origin: "http://localhost:4000", allowHttp: true });
    const second = await buildTomeMcpbBundle({ origin: "http://localhost:4000", allowHttp: true });
    expect(second).toBe(first);
  });
});
