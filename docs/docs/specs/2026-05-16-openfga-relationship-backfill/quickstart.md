# Quickstart: OpenFGA Relationship Backfill

## Prerequisites

- MongoDB is reachable through `MONGODB_URI` and `MONGODB_DATABASE`.
- OpenFGA is reachable through `OPENFGA_HTTP`.
- OpenFGA store resolution is configured through `OPENFGA_STORE_ID` or the project store-name flow.
- If the installation uses a dynamic default agent, it is configured through `platform_config.default_agent_id` or `DEFAULT_AGENT_ID`.
- The active OpenFGA model supports typed wildcard users on `agent.can_use`.

## Dry Run

Run the migration without writes:

```bash
APPLY=false npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Verify the output includes:

- Teams scanned.
- OpenFGA tuples planned.
- Mongo provenance records planned.
- Unmapped users.
- Invalid identifiers.
- Default-agent grant status.
- Migration record status is not `completed`.

## Apply

Apply the backfill:

```bash
APPLY=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Verify:

- Exit code is zero.
- Migration record is `completed`.
- Counts match or explain the dry-run output.
- OpenFGA contains team/resource tuples.
- OpenFGA contains `user:* can_use agent:<default-agent-id>` when a dynamic default agent is configured.

## Repeat Protection

Run apply again without force:

```bash
APPLY=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Expected result:

- Script exits cleanly.
- Output reports that the completed migration already exists.
- No duplicate relationships are written.

## Forced Reconciliation

Use force only when intentionally reconciling:

```bash
APPLY=true FORCE=true npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/backfill-universal-rebac.ts
```

Expected result:

- Script re-checks derived relationships.
- Duplicate tuples are treated as already converged.
- Migration record counts and timestamps are updated.

## Authorization Verification

After apply, verify default-agent access for a user with no team membership:

```text
Check user:<subject> can_use agent:<default-agent-id>
```

Expected result:

- Allowed when a dynamic default agent is configured.
- Skipped or not applicable when the platform falls back to the supervisor.

Verify a non-default agent remains relationship-gated:

```text
Check user:<subject> can_use agent:<non-default-agent-id>
```

Expected result:

- Denied unless the user has a direct or team-derived relationship.

## Suggested Focused Tests

```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/__tests__/backfill-universal-rebac.test.ts
python3 scripts/validate-rbac-matrix.py --print
```

If the final test location differs, use the concrete test path created during implementation.
