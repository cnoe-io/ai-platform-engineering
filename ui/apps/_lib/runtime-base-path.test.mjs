import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAgenticAppRuntimeBasePath,
  resolveAgenticAppSurface,
} from "./runtime-base-path.mjs";

test("accepts the gateway-owned runtime prefix for the requested app", () => {
  assert.equal(
    resolveAgenticAppRuntimeBasePath(
      { "x-forwarded-prefix": "/api/agentic-apps/runtime/example-app" },
      "/apps/example-app",
      "example-app",
    ),
    "/api/agentic-apps/runtime/example-app",
  );
});

test("rejects a forwarded prefix for another app", () => {
  assert.equal(
    resolveAgenticAppRuntimeBasePath(
      { "x-forwarded-prefix": "/api/agentic-apps/runtime/secondary-app" },
      "/apps/example-app/",
      "example-app",
    ),
    "/apps/example-app",
  );
});

test("selects the hosted surface only from the trusted gateway header", () => {
  assert.equal(resolveAgenticAppSurface({ "x-caipe-surface": "hosted" }), "hosted");
  assert.equal(resolveAgenticAppSurface({ "x-caipe-surface": "unexpected" }), "standalone");
});
