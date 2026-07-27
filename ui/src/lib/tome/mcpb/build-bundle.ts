import fs from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import { buildTomeMcpbManifest } from "./manifest";
import { MCP_REMOTE_DEPENDENCIES } from "./mcp-remote-dependencies";

const ICON_SOURCE_PATH = path.join(process.cwd(), "public", "tome-logo.png");

// Deliberately not `require.resolve("<pkg>/package.json")`: some packages in
// the closure (e.g. bundle-name) declare a restrictive "exports" map that
// only exposes their main entry file, so resolving their package.json fails
// even though the package is installed — and more importantly, Turbopack's
// production build statically analyzes `require.resolve(...)` calls and
// rewrites them to an internal bundled module reference (breaking at
// runtime with "path argument must be of type string, received type
// number") rather than leaving them as real filesystem lookups. Both
// problems disappear by using plain, bundler-transparent `path.join` from
// `process.cwd()` (matching how `.next/standalone`'s runner lays out
// `node_modules` next to the running server — see
// build/Dockerfile.caipe-ui's WORKDIR /app) instead of any module
// resolution. This also naturally sweeps up any package's own nested
// node_modules (see mcp-remote-dependencies.ts's doc comment on
// version-conflict nesting), since addDirToZip recurses unconditionally
// into subdirectories.
const NODE_MODULES_ROOT = path.join(process.cwd(), "node_modules");

function resolvePackageDir(pkg: string): string {
  return path.join(NODE_MODULES_ROOT, pkg);
}

/** Recursively add every file under `dir` to `zip` at `zipPrefix/<relative path>`. */
async function addDirToZip(zip: JSZip, dir: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, zipPath);
    } else if (entry.isFile()) {
      zip.file(zipPath, await fs.readFile(fullPath));
    }
  }
}

async function assembleBundle(origin: string, allowHttp: boolean): Promise<Buffer> {
  const zip = new JSZip();

  zip.file("manifest.json", JSON.stringify(buildTomeMcpbManifest({ origin, allowHttp }), null, 2));

  try {
    zip.file("icon.png", await fs.readFile(ICON_SOURCE_PATH));
  } catch {
    // Icon is optional per the MCPB spec — skip rather than fail the bundle.
  }

  // mcp-remote's own dependencies (express, open, etc.) are hoisted to the
  // top-level node_modules, not nested under node_modules/mcp-remote, so the
  // full closure has to be added package-by-package for a self-contained
  // bundle Claude Desktop can run with no `npm install` step.
  for (const pkg of MCP_REMOTE_DEPENDENCIES) {
    await addDirToZip(zip, resolvePackageDir(pkg), `node_modules/${pkg}`);
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

// mcp-remote's on-disk files (and this deployment's origin) don't change
// without a process restart, so the assembled zip is cached per (origin,
// allowHttp) pair — keyed by a Promise, so concurrent first-requests share
// one in-flight build instead of racing to rebuild it independently.
const bundleCache = new Map<string, Promise<Buffer>>();

export function buildTomeMcpbBundle(options: { origin: string; allowHttp: boolean }): Promise<Buffer> {
  const cacheKey = `${options.origin}|${options.allowHttp}`;
  let cached = bundleCache.get(cacheKey);
  if (!cached) {
    cached = assembleBundle(options.origin, options.allowHttp);
    cached.catch(() => bundleCache.delete(cacheKey)); // don't cache failures
    bundleCache.set(cacheKey, cached);
  }
  return cached;
}
