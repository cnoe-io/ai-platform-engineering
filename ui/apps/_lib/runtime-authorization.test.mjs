import assert from "node:assert/strict";
import test from "node:test";

import { createRequiredAgenticAppJwtVerifier } from "./jwt-verify.mjs";
import { authorizeAgenticAppRuntimeRequest } from "./runtime-authorization.mjs";

const identity = {
  appId: "weather",
  audience: "agentic-app:weather",
  decisionId: "decision-example-1234",
  scopes: ["weather:read"],
};

test("allows GET only with the route read scope", () => {
  const result = authorizeAgenticAppRuntimeRequest({
    identity,
    appId: "weather",
    method: "GET",
    readScope: "weather:read",
    invokeScope: "weather:agent",
  });

  assert.equal(result.ok, true);
  assert.equal(result.requiredScope, "weather:read");
  assert.equal(result.summary.launchDecision, "ALLOW");
  assert.equal(result.summary.readScopeGranted, true);
  assert.equal(result.summary.invokeScopeGranted, false);
});

test("denies mutation when the token has only read scope", () => {
  const result = authorizeAgenticAppRuntimeRequest({
    identity,
    appId: "weather",
    method: "POST",
    readScope: "weather:read",
    invokeScope: "weather:agent",
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: "insufficient_scope",
    requiredScope: "weather:agent",
  });
});

test("fails closed when no verified identity reaches the scope gate", () => {
  const result = authorizeAgenticAppRuntimeRequest({
    identity: null,
    appId: "weather",
    method: "GET",
    readScope: "weather:read",
    invokeScope: "weather:agent",
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.error, "missing_authorization");
});

test("permits an explicit development bypass but forbids it in production", () => {
  const result = authorizeAgenticAppRuntimeRequest({
    identity: null,
    appId: "weather",
    method: "GET",
    readScope: "weather:read",
    invokeScope: "weather:agent",
    allowDevelopmentBypass: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "development-bypass");

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () => createRequiredAgenticAppJwtVerifier({ appId: "weather", disabled: true }),
      /cannot be disabled.*production/,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
