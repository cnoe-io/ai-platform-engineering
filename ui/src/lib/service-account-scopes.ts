/**
 * Shared scope helpers for the Service Accounts BFF routes.
 *
 * A "scope" is an agent grant or a tool grant. These helpers centralize:
 *  - boundary validation of a scope ref (constitution VII)
 *  - the OpenFGA tuple the EDITOR must hold to grant it (FR-006/008/015)
 *  - the BASE OpenFGA tuple written for the service account (writeOpenFgaTuples
 *    rejects materialized `can_*` relations — agent→`user`, tool→`caller`)
 *
 * Spec: docs/docs/specs/2026-06-05-service-accounts/.
 */

import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";

/** OpenFGA-safe id segment (agent id, tool server, tool name). */
export const ID_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * One segment of a tool ref. Either a bare `*`, or an OpenFGA-safe id
 * (alphanumerics + `. _ -`) with an OPTIONAL trailing `*` wildcard. The trailing
 * star covers the underscore-wildcard form `<server>_*` (legacy team-resources)
 * as well as plain ids (`jira_search`, `dynamic-agents-builtin`). A star is only
 * valid as a whole segment or as a single trailing char — never embedded.
 */
const TOOL_SEGMENT = /^(?:\*|[A-Za-z0-9][A-Za-z0-9._-]*\*?)$/;

export interface ScopeRef {
  type: "agent" | "tool";
  /** agent id, or a tool object id — see {@link isValidToolRef}. */
  ref: string;
}

/**
 * Validate a tool ref. A tool ref is just an OpenFGA-safe `tool:` object id —
 * the create route's job is to reject GENUINELY malformed input, NOT to mandate
 * a single `<server>/<tool>` convention (the tool namespace doesn't follow one).
 * Real shapes that all exist in the model + must be accepted (#43, #44):
 *   - `jira/search`            slash server/tool
 *   - `jira/*`                 slash server wildcard (the form the bridge enforces)
 *   - `jira_search`            underscore (MCP-server-prefixed tool id)
 *   - `knowledge-base_*`       underscore wildcard (legacy team-resources form)
 *   - `dynamic-agents-builtin` no separator
 *   - `*`                      bare wildcard
 * Rejected: empty, anything with whitespace / disallowed chars, or more than one
 * slash. The real authorization bound is the per-scope `can_call` check, not this
 * shape filter.
 */
export function isValidToolRef(ref: string): boolean {
  if (!ref) return false;
  if (ref === "*") return true;
  const slashCount = (ref.match(/\//g) ?? []).length;
  if (slashCount > 1) return false;
  if (slashCount === 0) {
    // Single segment (underscore / no-separator / bare-name forms).
    return TOOL_SEGMENT.test(ref);
  }
  // Exactly one slash: `<server>/<tool>` or `<server>/*`.
  const slash = ref.indexOf("/");
  const server = ref.slice(0, slash);
  const tool = ref.slice(slash + 1);
  return TOOL_SEGMENT.test(server) && TOOL_SEGMENT.test(tool);
}

/**
 * Validate + normalize a raw scope object from a request body. Returns the
 * typed scope, or an error string for a 400.
 */
export function parseScope(raw: unknown): { scope?: ScopeRef; error?: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "scope must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  const ref = typeof obj.ref === "string" ? obj.ref.trim() : "";
  if (obj.type === "agent") {
    if (!ID_SEGMENT.test(ref)) return { error: `malformed agent ref: ${ref}` };
    return { scope: { type: "agent", ref } };
  }
  if (obj.type === "tool") {
    if (!isValidToolRef(ref)) return { error: `malformed tool ref: ${ref}` };
    return { scope: { type: "tool", ref } };
  }
  return { error: "scope.type must be 'agent' or 'tool'" };
}

/** The (relation, object) an EDITOR must hold to grant this scope (FR-006/008/015). */
export function scopeCheckTuple(scope: ScopeRef, editorSubject: string): OpenFgaTupleKey {
  return scope.type === "agent"
    ? { user: editorSubject, relation: "can_use", object: `agent:${scope.ref}` }
    : { user: editorSubject, relation: "can_call", object: `tool:${scope.ref}` };
}

/**
 * The BASE OpenFGA tuple to write/delete for a service-account scope grant.
 * `writeOpenFgaTuples`/`deleteExactOpenFgaTuples` reject materialized `can_*`
 * relations, so agent grants write the `user` relation and tool grants write
 * `caller` (mirrors team-resource grant writes).
 */
export function scopeWriteTuple(scope: ScopeRef, saSubject: string): OpenFgaTupleKey {
  return scope.type === "agent"
    ? { user: saSubject, relation: "user", object: `agent:${scope.ref}` }
    : { user: saSubject, relation: "caller", object: `tool:${scope.ref}` };
}
