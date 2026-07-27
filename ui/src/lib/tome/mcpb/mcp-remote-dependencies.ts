/**
 * Full transitive npm dependency closure of `mcp-remote` (its own package
 * folder plus every package it needs at runtime — express, open, etc., and
 * *their* dependencies), so the generated .mcpb bundle is fully
 * self-contained: Claude Desktop just runs `node dist/proxy.js`, no `npm
 * install` on the end user's machine.
 *
 * `mcp-remote`'s dependencies are hoisted to the top-level `node_modules`
 * (not nested under `node_modules/mcp-remote`), so both the build-time file
 * tracing (`next.config.ts`'s `outputFileTracingIncludes`) and the
 * request-time zip assembly (`build-bundle.ts`) need this exact list of
 * package folders — kept as one shared source of truth here so they can't
 * drift apart. Each entry is a top-level package name, not a full path: a
 * handful of these (e.g. `express`, `body-parser`, `send`) have their own
 * *nested* `node_modules` for version-conflicting sub-dependencies (e.g.
 * `express/node_modules/debug@2.x` vs. the hoisted top-level `debug@4.x`) —
 * both `outputFileTracingIncludes`'s glob and `build-bundle.ts`'s recursive
 * directory copy sweep those up automatically as part of the parent
 * package's own directory tree, so they don't need separate list entries.
 *
 * Computed from `package-lock.json`, not hand-picked. Regenerate after
 * bumping the `mcp-remote` version in package.json by running this from the
 * `ui/` directory and pasting the sorted output back in below:
 *
 *   node -e '
 *   const data = require("./package-lock.json");
 *   const pkgs = data.packages;
 *   function deps(name, seen) {
 *     const key = Object.keys(pkgs).find(k => k === "node_modules/" + name || k.endsWith("/node_modules/" + name));
 *     if (!key || seen.has(name)) return;
 *     seen.add(name);
 *     const entry = pkgs[key];
 *     const d = { ...(entry.dependencies||{}), ...(entry.optionalDependencies||{}) };
 *     for (const dep of Object.keys(d)) deps(dep, seen);
 *   }
 *   const seen = new Set();
 *   deps("mcp-remote", seen);
 *   console.log(JSON.stringify([...seen].sort(), null, 2));
 *   '
 */
export const MCP_REMOTE_DEPENDENCIES: readonly string[] = [
  "accepts",
  "array-flatten",
  "body-parser",
  "bundle-name",
  "bytes",
  "call-bind-apply-helpers",
  "call-bound",
  "content-disposition",
  "content-type",
  "cookie",
  "cookie-signature",
  "debug",
  "default-browser",
  "default-browser-id",
  "define-lazy-prop",
  "depd",
  "destroy",
  "dunder-proto",
  "ee-first",
  "encodeurl",
  "es-define-property",
  "es-errors",
  "es-object-atoms",
  "escape-html",
  "etag",
  "express",
  "finalhandler",
  "forwarded",
  "fresh",
  "function-bind",
  "get-intrinsic",
  "get-proto",
  "gopd",
  "has-symbols",
  "hasown",
  "http-errors",
  "iconv-lite",
  "inherits",
  "ipaddr.js",
  "is-docker",
  "is-inside-container",
  "is-wsl",
  "math-intrinsics",
  "mcp-remote",
  "media-typer",
  "merge-descriptors",
  "methods",
  "mime",
  "mime-db",
  "mime-types",
  "ms",
  "negotiator",
  "object-inspect",
  "on-finished",
  "open",
  "parseurl",
  "path-to-regexp",
  "proxy-addr",
  "qs",
  "range-parser",
  "raw-body",
  "run-applescript",
  "safe-buffer",
  "safer-buffer",
  "send",
  "serve-static",
  "setprototypeof",
  "side-channel",
  "side-channel-list",
  "side-channel-map",
  "side-channel-weakmap",
  "statuses",
  "strict-url-sanitise",
  "toidentifier",
  "type-is",
  "undici",
  "unpipe",
  "utils-merge",
  "vary",
  "wsl-utils",
];
