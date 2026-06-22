# Research: OpenFGA Relationship Backfill

## Decision: Extend the Existing Universal ReBAC Backfill Entry Point

**Rationale**: `scripts/backfill-universal-rebac.ts` already reads MongoDB teams and writes `team_membership_sources` plus `rebac_relationships` provenance. Extending it keeps the operator command familiar and avoids introducing a second source of truth for migration behavior.

**Alternatives considered**:

- **New one-off script**: Rejected because it would duplicate team/resource derivation and increase drift risk.
- **Runtime API endpoint**: Rejected because the operation is an administrative migration, not a request-time user workflow.
- **OpenFGA init seed script only**: Rejected because it is designed for bootstrap/demo seeding and does not read production MongoDB data.

## Decision: Use Platform Default-Agent Precedence from PR #1441

**Rationale**: The merged default-agent configuration feature defines the runtime precedence: persisted `platform_config.default_agent_id`, then `DEFAULT_AGENT_ID`, then supervisor fallback. The migration should match the runtime path so the authorization grant aligns with the agent that new chats actually open.

**Alternatives considered**:

- **New `DEFAULT_DYNAMIC_AGENT_ID` setting**: Rejected because it would introduce a second default-agent convention.
- **Require only an environment variable**: Rejected because it ignores admin-selected runtime configuration.
- **Require a Mongo `is_default` flag on agents**: Rejected because the existing feature stores the default in `platform_config`.

## Decision: Use Typed Wildcard for Every-User Default-Agent Access

**Rationale**: The user selected typed wildcard semantics. A tuple equivalent to `user:* can_use agent:<default>` grants all authenticated users access without enumerating current users or requiring future-user backfills. This directly satisfies "give every user access to default agent."

**Alternatives considered**:

- **Direct tuples for known users**: Rejected because it only covers users known at migration time.
- **Synthetic `all-users` team**: Rejected because it still requires future users to be added to the userset.
- **Default-agent bypass in application code**: Rejected because it would split authorization behavior between OpenFGA and the application runtime.

## Decision: Fail Closed if the Active Authorization Model Lacks Wildcard Support

**Rationale**: Writing a typed wildcard tuple requires the authorization model to allow the wildcard subject type on `agent.can_use`. If the model does not support it, the migration should stop before marking success so operators cannot mistakenly believe every-user default access is active.

**Alternatives considered**:

- **Silently fall back to direct per-user tuples**: Rejected because it changes the selected semantics and may miss future users.
- **Skip default-agent grant silently**: Rejected because it would break the expected default chat path after PDP enforcement.

## Decision: Record Migration Status in MongoDB

**Rationale**: A durable migration record gives operators repeat protection and auditable counts. It also lets the script skip accidental re-runs unless forced.

**Alternatives considered**:

- **Infer completion from existing relationships**: Rejected because partial failures and manual writes make inference ambiguous.
- **Local marker file**: Rejected because migrations may run from different machines or containers.

## Decision: Write OpenFGA and Mongo Provenance Idempotently

**Rationale**: Production migrations must tolerate retries. Deterministic relationship keys, Mongo upserts, and duplicate-tolerant OpenFGA writes let the script converge without duplicate graph edges.

**Alternatives considered**:

- **Delete and recreate migration-created relationships**: Rejected because it is riskier and could cause transient authorization gaps.
- **Append-only provenance records**: Rejected because repeated forced runs would pollute the graph and audit views.
