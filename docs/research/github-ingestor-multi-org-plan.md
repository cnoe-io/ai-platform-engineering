# Plan: Multi-Org GitHub Ingestor

## Summary

Extend the GitHub ingestor to support multiple GitHub organizations within a single process. Each org becomes a separate datasource, synced sequentially. Uses a new `GITHUB_ORGS` env var for the org list, with per-org installation IDs for GitHub App auth. Fully backward compatible -- when the new env vars are not set, behavior is identical to today.

## Current State

- The GitHub ingestor handles **one org per process** via the `GITHUB_ORG` env var.
- Authentication supports two modes: Personal Access Token (PAT) or GitHub App.
- GitHub App auth requires `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID` (singular).
- The main sync function (`sync_github_entities()`, line 480) already has a `for org_login in org_logins:` loop (line 527), but `org_logins` can only ever contain one element.
- Entity primary keys already include `github_instance` (e.g., `primary_key_properties=["github_instance", "id"]`), so multi-org entities won't collide.
- The `github_instance_name` is computed at module level (line 61) as `"github_" + sanitize_instance_name(GITHUB_ORG)`.
- To ingest from multiple orgs, operators must deploy separate container instances with different `GITHUB_ORG` + credential sets.

**Key file**: `ai_platform_engineering/knowledge_bases/rag/ingestors/src/ingestors/github/ingestor.py` (895 lines)

## Prior Art

### Supervisor Layer

The supervisor (`docker-compose.dev.yaml` line 159) already has a `GITHUB_ORGS` env var (plural) used as an allowlist for self-service tasks. This is distinct from the ingestor's `GITHUB_ORG` (singular).

### GitHub Agent

The GitHub agent uses a single credential set (one PAT or one GitHub App installation) for all operations. There is no per-org credential routing in the agent itself. `GITHUB_ORGS` at the supervisor layer is an allowlist, not a credential-routing mechanism.

### VictorOps Agent (Reference Pattern)

The VictorOps agent (`ai_platform_engineering/agents/victorops/`) uses a `VICTOROPS_ORGS` JSON env var with a true multi-org registry pattern. This is a more complex approach; we use a simpler comma-separated format here.

### AWS Ingestor (Sister Implementation)

The AWS ingestor multi-account plan (`docs/research/aws-ingestor-multi-account-plan.md`) uses `AWS_ACCOUNT_LIST="name1:id1,name2:id2"` + `CROSS_ACCOUNT_ROLE_NAME`. We follow the same sequential-iteration-with-error-isolation pattern here.

## Design

### Approach

1. Add `GITHUB_ORGS` env var (comma-separated org list) as the multi-org configuration.
2. For GitHub App auth in multi-org mode, add `GITHUB_APP_INSTALLATION_IDS` env var (comma-separated, parallel to `GITHUB_ORGS`).
3. Each org becomes a separate datasource (`github_{sanitized_org_name}`), synced **sequentially** within a single ingestor process.
4. When `GITHUB_ORGS` is not set, fall back to `GITHUB_ORG` (singular) for backward compatibility.
5. Reuse the existing `for org_login in org_logins:` loop structure -- it's already shaped for multi-org, just needs to be fed multiple orgs and given per-org auth.

### Authentication in Multi-Org Mode

**PAT mode**: A single PAT works across all orgs (GitHub PATs are scoped to the user, not the org). No per-org credential routing needed. Just set `GITHUB_ORGS=org1,org2,org3` and `GITHUB_TOKEN=ghp_xxx`.

**GitHub App mode**: Each org has its own `installation_id` (the app is installed per-org). The App ID and private key are shared (it's the same GitHub App), but the installation ID differs per org. This requires parallel lists:

```
GITHUB_ORGS=org1,org2,org3
GITHUB_APP_INSTALLATION_IDS=11111111,22222222,33333333
```

Where `org1` maps to installation `11111111`, `org2` to `22222222`, etc.

### Env Var Configuration

| Variable | Format | Default | Description |
|----------|--------|---------|-------------|
| `GITHUB_ORGS` | `org1,org2,...` | `""` (empty, falls back to `GITHUB_ORG`) | Comma-separated list of org logins |
| `GITHUB_APP_INSTALLATION_IDS` | `id1,id2,...` | `""` (falls back to `GITHUB_APP_INSTALLATION_ID`) | Comma-separated installation IDs, parallel to `GITHUB_ORGS` (GitHub App mode only) |

Existing env vars continue to work unchanged:

| Variable | Behavior |
|----------|----------|
| `GITHUB_ORG` | Single-org mode (backward compat). Ignored when `GITHUB_ORGS` is set. |
| `GITHUB_TOKEN` | PAT auth. Works for all orgs in multi-org mode. |
| `GITHUB_APP_ID` | GitHub App ID. Shared across all orgs (same app). |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key. Shared across all orgs. |
| `GITHUB_APP_INSTALLATION_ID` | Single installation ID. Ignored when `GITHUB_APP_INSTALLATION_IDS` is set. |

### Example Configurations

**Multi-org with PAT:**
```bash
GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
GITHUB_ORGS="cnoe-io,my-other-org,partner-org"
```

**Multi-org with GitHub App:**
```bash
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="/path/to/app.pem"
GITHUB_ORGS="cnoe-io,my-other-org,partner-org"
GITHUB_APP_INSTALLATION_IDS="11111111,22222222,33333333"
```

**Single-org (backward compatible, no changes):**
```bash
GITHUB_TOKEN="ghp_xxxxxxxxxxxx"
GITHUB_ORG="cnoe-io"
```

### Sync Strategy

- **Sequential**: Orgs are synced one at a time within the main sync loop.
- A single global `SYNC_INTERVAL` applies to all orgs (no per-org intervals).
- Each org gets its own datasource (`github_{sanitized_org_name}`), its own job, and its own entity batch.
- If one org fails, the error is logged and the ingestor continues to the next org.
- The `all_entities` list is reset per org (not accumulated across orgs) to keep memory bounded.

### Datasource Naming

In multi-org mode, each org gets its own datasource ID:
- `github_cnoe_io` (for org `cnoe-io`)
- `github_my_other_org` (for org `my-other-org`)

This is identical to the current single-org naming (`"github_" + sanitize_instance_name(org)`), just applied per-org.

## Detailed Changes

### 1. Add Multi-Org Env Var Parsing (new code, top of `ingestor.py`)

Add after line 52 (below `FETCH_ORG_EMAILS`):

```python
# Multi-org configuration
GITHUB_ORGS = os.getenv("GITHUB_ORGS", "")  # Comma-separated org list
GITHUB_APP_INSTALLATION_IDS = os.getenv("GITHUB_APP_INSTALLATION_IDS", "")  # Parallel to GITHUB_ORGS


def parse_org_list() -> List[Dict[str, str]]:
    """
    Parse GITHUB_ORGS and GITHUB_APP_INSTALLATION_IDS into a list of org configs.
    
    Returns:
        List of dicts: [{"org": "cnoe-io", "installation_id": "11111111"}, ...]
        Empty list if GITHUB_ORGS is not set (triggers single-org fallback).
        
    For PAT mode, installation_id will be None.
    For GitHub App mode, installation_id is required per org.
    """
    if not GITHUB_ORGS:
        return []
    
    orgs = [o.strip() for o in GITHUB_ORGS.split(",") if o.strip()]
    if not orgs:
        return []
    
    # Parse installation IDs (only needed for GitHub App mode)
    installation_ids = []
    if GITHUB_APP_INSTALLATION_IDS:
        installation_ids = [i.strip() for i in GITHUB_APP_INSTALLATION_IDS.split(",") if i.strip()]
    
    # If using GitHub App and we have installation IDs, validate length match
    if GITHUB_APP_ID and installation_ids and len(installation_ids) != len(orgs):
        raise ValueError(
            f"GITHUB_ORGS has {len(orgs)} entries but GITHUB_APP_INSTALLATION_IDS has "
            f"{len(installation_ids)} entries. They must match 1:1."
        )
    
    result = []
    for i, org in enumerate(orgs):
        entry = {"org": org}
        if installation_ids:
            entry["installation_id"] = installation_ids[i]
        else:
            entry["installation_id"] = None
        result.append(entry)
    
    return result
```

### 2. Add `create_github_client()` Helper (new function)

```python
def create_github_client(installation_id: Optional[str] = None) -> GitHubClient:
    """
    Create a GitHubClient with appropriate authentication.
    
    In PAT mode: returns a client using GITHUB_TOKEN (same for all orgs).
    In GitHub App mode: returns a client using the given installation_id
    (or GITHUB_APP_INSTALLATION_ID for single-org mode).
    """
    if GITHUB_TOKEN:
        return GitHubClient(api_url=GITHUB_API_URL, token=GITHUB_TOKEN)
    else:
        effective_installation_id = installation_id or GITHUB_APP_INSTALLATION_ID or ""
        github_app_auth = GitHubAppAuth(
            app_id=GITHUB_APP_ID or "",
            private_key=GITHUB_APP_PRIVATE_KEY or "",
            installation_id=effective_installation_id,
            rest_api_url=GITHUB_REST_API_URL,
        )
        return GitHubClient(api_url=GITHUB_API_URL, github_app_auth=github_app_auth)
```

### 3. Refactor `github_instance_name` (line 61)

Currently a module-level constant. In multi-org mode, the instance name is per-org. Options:

**Option A (chosen)**: Remove the module-level `github_instance_name` constant and compute it per-org inside the sync function. Pass it to entity creation.

The module-level constant is only used in two places:
1. `sync_github_entities()` -- for datasource_id and entity properties
2. `__main__` block -- for `IngestorBuilder().name(github_instance_name)`

For `__main__`, in multi-org mode we use a generic name like `"github_ingestor_multi"`. In single-org mode, we keep the existing name.

### 4. Extract `sync_org()` (refactor from `sync_github_entities()`)

Extract lines 527-879 (the body of `for org_login in org_logins:`) into a standalone function:

```python
async def sync_org(
    client: Client,
    github_client: GitHubClient,
    org_login: str,
    instance_name: str,
) -> None:
    """
    Sync all entities for a single GitHub organization.
    
    Creates a datasource, fetches all entity types (org metadata, repos, teams, users),
    converts to StructuredEntity objects, and ingests them.
    """
    datasource_id = instance_name
    
    # 1. Create/Update the datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description=f"GitHub entities from organization: {org_login}",
        source_type="github",
        last_updated=int(time.time()),
        default_chunk_size=0,
        default_chunk_overlap=0,
        reload_interval=SYNC_INTERVAL,
        metadata={"github_api_url": GITHUB_API_URL, "organizations": [org_login]},
    )
    await client.upsert_datasource(datasource_info)
    
    # 2. Create job, fetch entities, convert, ingest
    #    (existing lines 531-879, with github_instance_name replaced by instance_name)
    ...
```

Key changes inside `sync_org()`:
- Replace all references to `github_instance_name` with the `instance_name` parameter
- `all_entities` is local to `sync_org()` (not accumulated across orgs)
- The `github_client` is passed in (not created inside)

### 5. Refactor `sync_github_entities()` (the main sync function, line 480)

```python
async def sync_github_entities(client: Client):
    """
    Sync function that fetches GitHub entities and ingests them with job tracking.
    Called periodically by the IngestorBuilder.
    """
    logging.info("Starting GitHub entity sync...")
    
    org_configs = parse_org_list()
    
    if not org_configs:
        # Single-org mode (backward compatible)
        if not GITHUB_ORG:
            logging.error("GITHUB_ORG environment variable must be set (or use GITHUB_ORGS for multi-org)")
            return
        
        instance_name = "github_" + sanitize_instance_name(GITHUB_ORG)
        github_client = create_github_client()
        await sync_org(client, github_client, GITHUB_ORG, instance_name)
    else:
        # Multi-org mode: iterate over configured orgs sequentially
        logging.info(f"Multi-org mode: syncing {len(org_configs)} organizations")
        for org_config in org_configs:
            org_login = org_config["org"]
            installation_id = org_config.get("installation_id")
            instance_name = "github_" + sanitize_instance_name(org_login)
            
            try:
                logging.info(f"Starting sync for org: {org_login}")
                github_client = create_github_client(installation_id=installation_id)
                await sync_org(client, github_client, org_login, instance_name)
                logging.info(f"Completed sync for org: {org_login}")
            except Exception as e:
                logging.error(f"Failed to sync org {org_login}: {e}", exc_info=True)
                # Continue with next org -- don't let one failure stop the rest
```

### 6. Update `__main__` Entry Point (line 882)

```python
if __name__ == "__main__":
    try:
        auth_method = "PAT" if GITHUB_TOKEN else "GitHub App"
        org_configs = parse_org_list()
        
        if org_configs:
            # Multi-org mode
            org_names = [c["org"] for c in org_configs]
            ingestor_name = "github_ingestor_multi"
            ingestor_description = f"GitHub ingestor for {len(org_configs)} orgs: {', '.join(org_names)}"
        else:
            # Single-org mode (backward compatible)
            ingestor_name = "github_" + sanitize_instance_name(GITHUB_ORG if GITHUB_ORG else "default")
            ingestor_description = "Ingestor for GitHub entities" + (
                f" from organization {GITHUB_ORG}" if GITHUB_ORG else ""
            )
        
        logging.info(f"Starting GitHub ingestor ({ingestor_name}) with {auth_method} auth...")
        
        IngestorBuilder()
            .name(ingestor_name)
            .type("github")
            .description(ingestor_description)
            .metadata({
                "github_api_url": GITHUB_API_URL,
                "organizations": [c["org"] for c in org_configs] if org_configs else [GITHUB_ORG],
                "sync_interval": SYNC_INTERVAL,
                "auth_method": auth_method,
            })
            .sync_with_fn(sync_github_entities)
            .every(SYNC_INTERVAL)
            .with_init_delay(int(os.getenv("INIT_DELAY_SECONDS", "0")))
            .run()
    except KeyboardInterrupt:
        logging.info("GitHub ingestor execution interrupted by user")
    except Exception as e:
        logging.error(f"GitHub ingestor failed: {e}", exc_info=True)
```

### 7. Move Auth Validation (line 44)

The current top-level validation:
```python
if not GITHUB_TOKEN and not (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID):
    raise ValueError(...)
```

This check references `GITHUB_APP_INSTALLATION_ID` (singular), which may not be set in multi-org mode where `GITHUB_APP_INSTALLATION_IDS` (plural) is used instead. Relax the check:

```python
has_github_app_base = GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY
has_github_app_single = has_github_app_base and GITHUB_APP_INSTALLATION_ID
has_github_app_multi = has_github_app_base and GITHUB_APP_INSTALLATION_IDS

if not GITHUB_TOKEN and not has_github_app_single and not has_github_app_multi:
    raise ValueError(
        "Authentication required: Either set GITHUB_TOKEN (for PAT) or "
        "GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID (single-org) or "
        "GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_IDS (multi-org)"
    )
```

### 8. Update `README.md`

Add a "Multi-Org Configuration" section documenting:
- `GITHUB_ORGS` format and examples
- `GITHUB_APP_INSTALLATION_IDS` for GitHub App mode
- Example configurations for PAT and GitHub App multi-org
- Note that each org becomes a separate datasource
- Error isolation behavior

### 9. Update `docker-compose.dev.yaml`

Add optional env vars to the `github_ingestor` service (around line 1671):

```yaml
github_ingestor:
  environment:
    # ... existing vars ...
    - GITHUB_ORGS=${GITHUB_ORGS:-}
    - GITHUB_APP_INSTALLATION_IDS=${GITHUB_APP_INSTALLATION_IDS:-}
```

## Files Changed

| File | Change |
|------|--------|
| `.../ingestors/src/ingestors/github/ingestor.py` | Core multi-org logic: org parsing, per-org auth, `sync_org()` extraction, multi-org iteration |
| `.../ingestors/src/ingestors/github/README.md` | Multi-org documentation section |
| `docker-compose.dev.yaml` | Add `GITHUB_ORGS` and `GITHUB_APP_INSTALLATION_IDS` env vars |

## What Stays the Same

- `GitHubClient` and `GitHubAppAuth` classes are unchanged (auth is per-instance, already designed correctly)
- `fetch_all_paginated()` helper is unchanged
- All entity conversion logic (repos, teams, users) stays the same -- just moves into `sync_org()`
- `IngestorBuilder` and `Client` (common library) are unchanged
- Entity primary keys already include `github_instance`, so no collision risk
- Single-org deployments (using `GITHUB_ORG` without `GITHUB_ORGS`) require zero changes
- All existing env vars continue to work

## Structural Advantage

The existing code is already shaped for this refactor:
- Line 527: `for org_login in org_logins:` -- the loop already exists, it just needs multiple orgs
- Entity primary keys include `github_instance` -- no collision risk
- `GitHubClient` takes auth config at construction time -- per-org clients are trivial
- The `datasource_id` is already derived from the org name -- each org naturally gets its own datasource

The main work is:
1. Extract the loop body into `sync_org()`
2. Feed it multiple orgs with per-org auth
3. Handle error isolation between orgs

## Risk Assessment

- **Low risk**: The refactor is additive. When `GITHUB_ORGS` is unset, behavior is identical to today.
- **PAT simplicity**: PAT mode requires no per-org credential handling. A single token works for all orgs the user has access to.
- **GitHub App complexity**: Moderate. Each org has its own installation_id, requiring parallel lists. But the App ID + private key are shared, and `GitHubAppAuth` already encapsulates token refresh per-instance.
- **Error isolation**: If one org fails (bad installation_id, revoked access), the others continue syncing. Each org's errors are logged independently.
- **Memory**: Entities are accumulated per-org (not across all orgs), then ingested and discarded. No memory growth across orgs.
- **No shared-library changes**: The common `IngestorBuilder` and `Client` are unchanged, so no risk to other ingestors.
- **Rate limits**: Each GitHub App installation has its own 15,000 req/hour limit. Multiple orgs with separate installations don't share limits. PAT is 5,000 req/hour total across all orgs.
