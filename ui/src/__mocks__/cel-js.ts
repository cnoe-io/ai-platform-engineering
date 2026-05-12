/**
 * Jest mock for cel-js (ESM module that cannot be loaded by Jest directly).
 * Provides a minimal evaluate() that handles common CEL expressions used in tests.
 */
export class CelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CelParseError';
  }
}

export function evaluate(expression: string, context: Record<string, unknown>): unknown {
  if (!expression || !expression.trim()) return true;
  const t = expression.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;

  const inRoles = /^'([^']+)'\s+in\s+user\.roles$/.exec(t);
  if (inRoles) {
    const role = inRoles[1];
    const user = context.user as { roles?: string[] } | undefined;
    return Array.isArray(user?.roles) ? user!.roles.includes(role) : false;
  }

  return true;
}
