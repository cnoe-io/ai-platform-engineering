/**
 * Enforce the least-privilege scope carried by the gateway-minted JWT.
 * GET/HEAD requests receive read scope; mutations receive invoke scope.
 */
export function authorizeAgenticAppRuntimeRequest({
  identity,
  appId,
  method,
  readScope,
  invokeScope,
  allowDevelopmentBypass = false,
}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const requiredScope = normalizedMethod === "GET" || normalizedMethod === "HEAD"
    ? readScope
    : invokeScope;

  // Explicit verifier opt-out is allowed only outside production by
  // createRequiredAgenticAppJwtVerifier. Keep local smoke tests ergonomic.
  if (!identity && allowDevelopmentBypass) {
    return {
      ok: true,
      requiredScope,
      mode: "development-bypass",
      summary: buildAuthorizationSummary(null, { appId, readScope, invokeScope }),
    };
  }

  if (!identity) {
    return {
      ok: false,
      status: 401,
      error: "missing_authorization",
      requiredScope,
    };
  }

  const scopes = Array.isArray(identity.scopes) ? identity.scopes.map(String) : [];
  if (identity.appId !== appId || !scopes.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: "insufficient_scope",
      requiredScope,
    };
  }

  return {
    ok: true,
    requiredScope,
    mode: "cas",
    summary: buildAuthorizationSummary(identity, { appId, readScope, invokeScope }),
  };
}

export function buildAuthorizationSummary(identity, { appId, readScope, invokeScope }) {
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes.map(String) : [];
  const decisionId = typeof identity?.decisionId === "string" ? identity.decisionId : "";
  return {
    mode: identity ? "CAS enforced" : "Development bypass",
    appResource: `agentic_app:${appId}`,
    launchAction: "use",
    launchDecision: identity ? "ALLOW" : "NOT EVALUATED",
    decisionReference: decisionId ? decisionId.slice(0, 12) : "local-only",
    tokenAudience: typeof identity?.audience === "string" ? identity.audience : `agentic-app:${appId}`,
    readScope,
    readScopeGranted: scopes.includes(readScope),
    invokeScope,
    invokeScopeGranted: scopes.includes(invokeScope),
  };
}
