const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
let unsafeRbacBypassWarningLogged = false;

/**
 * Dev/emergency escape hatch for deployments that need the UI to run while the
 * OpenFGA/Keycloak RBAC stack is being repaired. Keep the name intentionally
 * noisy so it is not mistaken for a normal production mode.
 */
export function isUnsafeRbacBypassEnabled(): boolean {
  const raw = process.env.CAIPE_UNSAFE_RBAC_BYPASS?.trim().toLowerCase();
  return raw ? ENABLED_VALUES.has(raw) : false;
}

export function warnUnsafeRbacBypassEnabled(context: string): void {
  if (!isUnsafeRbacBypassEnabled() || unsafeRbacBypassWarningLogged) return;
  unsafeRbacBypassWarningLogged = true;

  console.warn(
    [
      "",
      "************************************************************",
      " CAIPE_UNSAFE_RBAC_BYPASS=true",
      " RBAC IS DISABLED. ALL UI AUTHORIZATION CHECKS WILL ALLOW.",
      " ALL OPERATIONS ARE EFFECTIVELY ADMIN. DO NOT USE IN PRODUCTION.",
      ` Context: ${context}`,
      "************************************************************",
      "",
    ].join("\n")
  );
}
