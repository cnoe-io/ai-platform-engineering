// assisted-by Codex Codex-sonnet-4-6

import type { DynamicAgentConfig } from "@/types/dynamic-agent";

import {
isOpenFgaReconciliationEnabled,
readOpenFgaTuples,
writeOpenFgaTupleDiff,
type OpenFgaReconcileResult,
type OpenFgaTupleKey,
type TeamResourceTupleDiff,
} from "./openfga";
import { buildTeamGrantTuples } from "./openfga-owned-resources";

type AllowedToolsConfig = Record<string, string[] | boolean>;

export interface AgentToolTupleDiffInput {
  agentId: string;
  previousAllowedTools?: AllowedToolsConfig;
  nextAllowedTools: AllowedToolsConfig;
  ownerSubject?: string | null;
  organizationId?: string | null;
  /**
   * The current desired owner-team slug. Required for every dynamic agent
   * after 2026-05-22 (private was retired). When set, we write the
   * canonical pair of inheritance tuples that grants team members
   * `can_use` and team admins `can_manage`. When `null`/`undefined` we
   * skip team writes — used only by the legacy migration path; live
   * routes should always pass a slug.
   */
  ownerTeamSlug?: string | null;
  /**
   * Optional: the previous owner-team slug recorded on the agent before
   * this reconcile call. When provided and different from `ownerTeamSlug`,
   * we emit deletes for the stale `team:<slug>#member → agent#user` and
   * `team:<slug>#admin → agent#manager` tuples so owner-team transitions
   * (or migrations from a legacy team-less agent to a real team) do not
   * leave residue.
   *
   * Pass `undefined` for fresh creates (no previous state) and pass the
   * old value on updates. Idempotent: passing the same slug as
   * `ownerTeamSlug` is a no-op for the team tuples.
   */
  previousOwnerTeamSlug?: string | null;
  /**
   * Additional team slugs the agent is explicitly shared with (the
   * "Share with Teams" multi-select on the Agent editor — distinct from
   * the single owner team). Each entry produces the same two-tuple
   * inheritance pair as the owner team:
   *
   *   team:<slug>#member user agent:<id>     (can_use → can DM and use in any channel mapped to this team)
   *   team:<slug>#member writer agent:<id>   (can_write → can save non-destructive edits)
   *   team:<slug>#admin  manager agent:<id>  (can_manage → can edit/disable/delete the agent)
   *
   * Empty array or `undefined` means "no additional shared teams"; the
   * owner-team tuples are still written. Slugs that match the owner team
   * are deduplicated. Invalid slugs are silently skipped.
   */
  nextSharedTeamSlugs?: readonly string[] | null;
  /**
   * Optional: the previous shared-team slugs recorded on the agent before
   * this reconcile call. Slugs that appear here but NOT in
   * `nextSharedTeamSlugs` are emitted as deletes so removing a team from
   * the multi-select genuinely revokes access (instead of the current
   * silent Mongo-only behaviour where the team kept its grant forever).
   *
   * Pass `undefined` (or `[]`) for fresh creates. Pass the previously
   * persisted set on updates so the diff is symmetric with
   * `previousOwnerTeamSlug`.
   */
  previousSharedTeamSlugs?: readonly string[] | null;
  /**
   * When `true` we write `user:* user agent:<id>` so every authenticated
   * user has `can_use` on this agent. Used for `visibility === 'global'`.
   */
  globalUserAccess?: boolean;
  /**
   * When the previous reconcile was global but the next state is not, we
   * emit a delete for `user:* user agent:<id>` so the agent loses the
   * everyone-can-use grant. Mirrors `previousOwnerTeamSlug`.
   */
  previousGlobalUserAccess?: boolean;
}

export interface ReconcileAgentToolTuplesInput extends AgentToolTupleDiffInput {
  failClosed?: boolean;
}

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

function isValidOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

function uniqueTuples(tuples: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const seen = new Set<string>();
  const out: OpenFgaTupleKey[] = [];
  for (const tuple of tuples) {
    const key = `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tuple);
  }
  return out;
}

function normalizeAllowedTools(
  allowedTools?: AllowedToolsConfig,
): Map<string, Set<string>> {
  const normalized = new Map<string, Set<string>>();
  for (const [serverId, tools] of Object.entries(allowedTools ?? {})) {
    if (!isValidOpenFgaId(serverId)) continue;
    const normalizedTools = new Set<string>();
    if (!Array.isArray(tools) || tools.length === 0) {
      normalizedTools.add("*");
    } else {
      for (const tool of tools) {
        if (isValidOpenFgaId(tool)) {
          normalizedTools.add(tool);
        }
      }
    }
    if (normalizedTools.size > 0) {
      normalized.set(serverId, normalizedTools);
    }
  }
  return normalized;
}

function agentToolTuple(agentId: string, serverId: string, toolName: string): OpenFgaTupleKey {
  return {
    user: `agent:${agentId}`,
    relation: "caller",
    object: `tool:${serverId}/${toolName}`,
  };
}

export function buildAgentRelationshipTupleDiff(input: AgentToolTupleDiffInput): TeamResourceTupleDiff {
  if (!isValidOpenFgaId(input.agentId)) {
    throw new Error(`Invalid OpenFGA agent id: ${input.agentId}`);
  }

  const previous = normalizeAllowedTools(input.previousAllowedTools);
  const next = normalizeAllowedTools(input.nextAllowedTools);
  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];

  if (input.ownerSubject && isValidOpenFgaId(input.ownerSubject)) {
    writes.push({
      user: `user:${input.ownerSubject}`,
      relation: "owner",
      object: `agent:${input.agentId}`,
    });
  }
  if (input.organizationId && isValidOpenFgaId(input.organizationId)) {
    writes.push({
      user: `organization:${input.organizationId}#admin`,
      relation: "manager",
      object: `agent:${input.agentId}`,
    });
  }
  // Owner-team + shared-team grants are delegated to the shared
  // `buildTeamGrantTuples` primitive (spec 2026-06-03, US1 / FR-003). The
  // agent's member relations are `user` (granting `can_use`) and `writer`
  // (granting non-destructive edits), distinct from the `reader` default used
  // by KB/data_source. The primitive handles the
  // owner ∪ shared union, the owner-team transition delete via
  // `previousOwnerTeamSlug`, and the shared-team revoke diff — the same
  // logic this builder used to inline. A team promoted from shared → owner
  // is never deleted (it's still in the effective set).
  const teamGrants = buildTeamGrantTuples({
    object: `agent:${input.agentId}`,
    // assisted-by Codex Codex-sonnet-4-6
    // Members of owner/shared teams can edit agent config, while delete and
    // transfer stay reserved for managers through the admin tuple.
    memberRelations: ["user", "writer"],
    ownerTeamSlug: input.ownerTeamSlug,
    previousOwnerTeamSlug: input.previousOwnerTeamSlug,
    nextSharedTeamSlugs: input.nextSharedTeamSlugs,
    previousSharedTeamSlugs: input.previousSharedTeamSlugs,
  });
  writes.push(...teamGrants.writes);
  deletes.push(...teamGrants.deletes);

  // `visibility === 'global'` is encoded as a `user:* user agent:<id>`
  // tuple. We write/delete it here so the reconcile pass is the single
  // source of truth — `available/route.ts` no longer needs to repair it
  // at list time. Idempotent at the OpenFGA layer.
  if (input.globalUserAccess) {
    writes.push({
      user: "user:*",
      relation: "user",
      object: `agent:${input.agentId}`,
    });
  } else if (input.previousGlobalUserAccess) {
    deletes.push({
      user: "user:*",
      relation: "user",
      object: `agent:${input.agentId}`,
    });
  }

  for (const [serverId, tools] of next) {
    const previousTools = previous.get(serverId) ?? new Set<string>();
    for (const toolName of tools) {
      if (!previousTools.has(toolName)) {
        writes.push(agentToolTuple(input.agentId, serverId, toolName));
      }
    }
  }

  for (const [serverId, tools] of previous) {
    const nextTools = next.get(serverId) ?? new Set<string>();
    for (const toolName of tools) {
      if (!nextTools.has(toolName)) {
        deletes.push(agentToolTuple(input.agentId, serverId, toolName));
      }
    }
  }

  return {
    writes: uniqueTuples(writes),
    deletes: uniqueTuples(deletes),
  };
}

export function buildAgentToolTupleDiff(input: AgentToolTupleDiffInput): TeamResourceTupleDiff {
  return buildAgentRelationshipTupleDiff(input);
}

export async function reconcileAgentToolTuples(
  input: ReconcileAgentToolTuplesInput,
): Promise<OpenFgaReconcileResult> {
  return reconcileAgentRelationships(input);
}

export async function reconcileAgentRelationships(
  input: ReconcileAgentToolTuplesInput,
): Promise<OpenFgaReconcileResult> {
  const diff = buildAgentRelationshipTupleDiff(input);
  try {
    return await writeOpenFgaTupleDiff(diff);
  } catch (error) {
    if (input.failClosed ?? true) {
      throw error;
    }
    console.warn("[openfga-agent-tools] reconciliation failed:", error);
    return { enabled: isOpenFgaReconciliationEnabled(), writes: 0, deletes: 0 };
  }
}

export async function deleteAllAgentToolTuples(agentId: string): Promise<OpenFgaReconcileResult> {
  if (!isValidOpenFgaId(agentId)) {
    throw new Error(`Invalid OpenFGA agent id: ${agentId}`);
  }
  if (!isOpenFgaReconciliationEnabled()) {
    return { enabled: false, writes: 0, deletes: 0 };
  }

  const allTuples: OpenFgaTupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ continuationToken });
    allTuples.push(...page.tuples.map((tuple) => tuple.key));
    continuationToken = page.continuationToken;
  } while (continuationToken);

  return writeOpenFgaTupleDiff({
    writes: [],
    deletes: allTuples.filter((tuple) => tuple.user === `agent:${agentId}` || tuple.object === `agent:${agentId}`),
  });
}

export function allowedToolsFromAgent(agent: Pick<DynamicAgentConfig, "allowed_tools">): AllowedToolsConfig {
  return (agent.allowed_tools ?? {}) as AllowedToolsConfig;
}
