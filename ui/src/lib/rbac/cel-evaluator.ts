import { evaluate as celJsEvaluate } from 'cel-js';

/**
 * Standard CEL context (FR-029): user.roles, user.teams, user.email,
 * resource.id, resource.type, resource.visibility, resource.owner_id,
 * resource.shared_with_teams, action
 */
export function evaluate(expression: string, context: Record<string, unknown>): boolean {
  if (!expression || !expression.trim()) {
    return true;
  }
  try {
    const result = celJsEvaluate(expression.trim(), context as Record<string, unknown>);
    if (typeof result === 'boolean') {
      return result;
    }
    return Boolean(result);
  } catch (e) {
    console.warn('[CEL] evaluation failed (fail-closed):', e);
    return false;
  }
}
