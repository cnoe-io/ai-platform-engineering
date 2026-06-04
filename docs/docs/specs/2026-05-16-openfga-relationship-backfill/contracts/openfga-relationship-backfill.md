# Contract: OpenFGA Relationship Backfill

## Operator Interface

The migration is an operator-run script. It must support dry-run by default and require explicit apply intent before writing MongoDB or OpenFGA state.

### Required Configuration

- `MONGODB_URI`: MongoDB connection string.
- `MONGODB_DATABASE`: MongoDB database name.
- `OPENFGA_HTTP`: OpenFGA HTTP base URL.
- Either `OPENFGA_STORE_ID` or the existing store-name resolution inputs used by the project.

### Optional Configuration

- `APPLY=true`: Apply writes. Any other value runs dry-run mode.
- `FORCE=true`: Allow apply mode to reconcile after a completed migration record already exists.
- `DEFAULT_AGENT_ID`: Deployment fallback default agent id when no persisted platform config exists.

## Migration Modes

### Dry Run

Command intent:

```bash
APPLY=false npx tsx scripts/backfill-universal-rebac.ts
```

Expected behavior:

- Reads source data.
- Resolves default-agent source.
- Validates whether the default-agent grant can be represented.
- Prints planned relationship counts and warnings.
- Does not write OpenFGA tuples.
- Does not write active provenance records.
- Does not write a completed migration record.

### Apply

Command intent:

```bash
APPLY=true npx tsx scripts/backfill-universal-rebac.ts
```

Expected behavior:

- Exits without writes if a completed migration record already exists and `FORCE` is not set.
- Writes idempotent OpenFGA tuples.
- Upserts MongoDB relationship provenance.
- Writes a completed migration record only after required writes complete.
- Fails closed and leaves a failed migration record when required writes cannot complete.

### Forced Reconciliation

Command intent:

```bash
APPLY=true FORCE=true npx tsx scripts/backfill-universal-rebac.ts
```

Expected behavior:

- Re-checks derived relationships after a previous completed run.
- Keeps idempotent results.
- Updates migration counts and timestamp.
- Does not delete non-migration relationships.

## Default-Agent Grant Contract

When a default dynamic agent is configured, the migration must write a relationship equivalent to:

```text
user:* can_use agent:<default-agent-id>
```

Required behavior:

- The active authorization model must allow `user:*` on `agent.can_use`.
- The default id must resolve using persisted platform config before `DEFAULT_AGENT_ID`.
- Supervisor fallback means no dynamic default-agent grant is written.
- Invalid or deleted default-agent ids fail apply mode before completion is recorded.

## Output Contract

The script must print a machine-readable or consistently parseable summary with:

- `mode`: `dry-run`, `apply`, `force`
- `status`: `planned`, `completed`, `skipped`, or `failed`
- `teams_scanned`
- `tuples_planned`
- `tuples_written`
- `provenance_upserted`
- `duplicates_ignored`
- `invalid_identifiers`
- `unmapped_users`
- `default_agent.id`
- `default_agent.source`
- `default_agent.grant_status`
- `migration_record_id`

## Failure Contract

The script must exit non-zero when:

- Required MongoDB or OpenFGA configuration is missing in apply mode.
- OpenFGA store resolution fails in apply mode.
- Authorization model wildcard support is missing while a default dynamic agent grant is required.
- Required OpenFGA writes fail.
- MongoDB provenance or migration-record writes fail.

The script must not mark the migration `completed` for any non-zero failure.
