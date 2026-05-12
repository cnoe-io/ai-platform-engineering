/**
 * Jest-only CEL stand-in: avoids loading cel-js → chevrotain → lodash-es in Jest.
 * Mapped via jest.config.js moduleNameMapper for `@/lib/rbac/cel-evaluator`.
 * Covers expressions used in admin tab policies and API middleware tests.
 */
export function evaluate(expression: string, context: Record<string, unknown>): boolean {
  if (!expression || !expression.trim()) {
    return true;
  }
  const t = expression.trim();
  if (t === "true") return true;
  if (t === "false") return false;

  const inRoles = /^'([^']+)'\s+in\s+user\.roles$/.exec(t);
  if (inRoles) {
    const role = inRoles[1];
    const user = context.user as { roles?: string[] } | undefined;
    const roles = Array.isArray(user?.roles) ? user!.roles : [];
    return roles.includes(role);
  }

  // Permissive default matches prior jest.mock(() => true) for API route tests
  return true;
}
