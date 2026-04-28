# Plan: Multi-Account AWS Ingestor

## Summary

Extend the AWS ingestor to support multiple AWS accounts within a single process. Each account becomes a separate datasource, configured via environment variables. Uses the same `AWS_ACCOUNT_LIST` and `CROSS_ACCOUNT_ROLE_NAME` env var format already used by the AWS agent.

## Current State

- The AWS ingestor handles **one AWS account per process**.
- Account identity is discovered at startup via `sts:GetCallerIdentity` using whatever credentials are in the environment.
- All boto3 clients are created with `boto3.client("service", region_name=region)`, using the default credential chain.
- To ingest from multiple accounts, operators must deploy separate container instances with different AWS credentials.
- The Helm chart supports this (one Deployment per `ingestors[]` entry), but it's operationally heavy.

**Key file**: `ai_platform_engineering/knowledge_bases/rag/ingestors/src/ingestors/aws/ingestor.py` (678 lines)

## Prior Art: AWS Agent

The AWS agent (`ai_platform_engineering/agents/aws/agent_aws/tools.py`) already handles cross-account operations using:

- `AWS_ACCOUNT_LIST` env var -- format: `name1:id1,name2:id2,...`
- `CROSS_ACCOUNT_ROLE_NAME` env var -- default: `caipe-read-only`
- Generates `~/.aws/config` at startup with one `[profile ...]` section per account
- Each profile uses `role_arn` + `credential_source = Environment` for transparent STS AssumeRole
- The AWS CLI then uses `--profile <name>` to operate in the target account

The ingestor can use the same env vars and profile generation, but with `boto3.Session(profile_name=...)` instead of shelling out to the AWS CLI.

## Design

### Approach

1. Reuse `AWS_ACCOUNT_LIST` and `CROSS_ACCOUNT_ROLE_NAME` env var format from the AWS agent.
2. Generate `~/.aws/config` profiles at startup (same logic as `tools.py:setup_aws_profiles()`).
3. Use `boto3.Session(profile_name=...)` to create per-account sessions. boto3 natively understands `role_arn` + `credential_source = Environment` in `~/.aws/config`, so no manual STS AssumeRole code is needed.
4. Each account becomes a separate datasource (`aws-account-{account_id}`), synced **sequentially** within a single ingestor process.
5. When `AWS_ACCOUNT_LIST` is not set, fall back to current single-account behavior (zero-change backward compatibility).

### Env Var Configuration

| Variable | Format | Default | Description |
|----------|--------|---------|-------------|
| `AWS_ACCOUNT_LIST` | `name1:id1,name2:id2,...` | `""` (empty, single-account mode) | Comma-separated list of `name:account_id` pairs |
| `CROSS_ACCOUNT_ROLE_NAME` | string | `caipe-read-only` | IAM role name to assume in each target account |

Example:
```bash
AWS_ACCOUNT_LIST="prod:123456789012,staging:234567890123,dev:345678901234"
CROSS_ACCOUNT_ROLE_NAME="caipe-read-only"
```

This generates `~/.aws/config`:
```ini
[profile prod]
role_arn = arn:aws:iam::123456789012:role/caipe-read-only
credential_source = Environment

[profile staging]
role_arn = arn:aws:iam::234567890123:role/caipe-read-only
credential_source = Environment

[profile dev]
role_arn = arn:aws:iam::345678901234:role/caipe-read-only
credential_source = Environment
```

And boto3 transparently handles STS AssumeRole when `boto3.Session(profile_name="prod")` is used.

### Sync Strategy

- **Sequential**: Accounts are synced one at a time within the main sync loop.
- A single global `SYNC_INTERVAL` applies to all accounts (no per-account intervals).
- If one account fails, the error is logged and the ingestor continues to the next account.

## Detailed Changes

### 1. Account Parsing & Profile Setup (new code, top of `ingestor.py`)

Add:
- `AWS_ACCOUNT_LIST` and `CROSS_ACCOUNT_ROLE_NAME` env var parsing
- `parse_account_list() -> list[dict]` -- parses `AWS_ACCOUNT_LIST` into `[{"name": str, "id": str}, ...]`
- `setup_aws_profiles()` -- generates `~/.aws/config` with assume-role profiles (adapted from `tools.py:120-199`)
- `create_session(profile_name: Optional[str] = None) -> boto3.Session` -- creates a boto3 session, optionally with a named profile

### 2. Refactor boto3 Client Creation (modify existing functions)

All resource-fetching functions currently create clients with `boto3.client("service", region_name=region)`. Change them to accept an optional `session: boto3.Session` parameter and use `session.client(...)` instead.

Functions affected (16 total):

| Function | Line | Change |
|----------|------|--------|
| `get_account_id()` | 74 | Add `session` param, use `session.client("sts", ...)` |
| `get_all_regions()` | 80 | Add `session` param, use `session.client("ec2", ...)` |
| `fetch_resources()` | 97 | Add `session` param, use `session.client("resourcegroupstaggingapi", ...)` |
| `get_ec2_details()` | 125 | Add `session` param |
| `get_eks_details()` | 151 | Add `session` param |
| `get_s3_details()` | 170 | Add `session` param |
| `get_elb_details()` | 213 | Add `session` param |
| `get_ebs_details()` | 258 | Add `session` param |
| `get_route53_hostedzone_details()` | 279 | Add `session` param |
| `list_iam_users()` | 304 | Add `session` param |
| `get_natgateway_details()` | 322 | Add `session` param |
| `get_vpc_details()` | 343 | Add `session` param |
| `get_subnet_details()` | 364 | Add `session` param |
| `get_security_group_details()` | 385 | Add `session` param |
| `get_rds_details()` | 406 | Add `session` param |
| `get_lambda_details()` | 426 | Add `session` param |
| `get_dynamodb_details()` | 448 | Add `session` param |
| `sync_resource_type()` | 510 | Add `session` param, pass to fetch functions |

The change is mechanical: replace `boto3.client("x", region_name=r)` with `session.client("x", region_name=r)`.

### 3. Extract `sync_account()` (refactor from `sync_aws_resources()`)

Extract the per-account logic from `sync_aws_resources()` (lines 583-658) into a new function:

```python
async def sync_account(client: Client, session: boto3.Session, account_name: str):
    """Sync all resources for a single AWS account."""
    account_id = (await get_account_id(session))
    datasource_id = f"aws-account-{account_id}"
    
    # Upsert datasource
    datasource_info = DataSourceInfo(
        datasource_id=datasource_id,
        ingestor_id=client.ingestor_id or "",
        description=f"AWS resources for account {account_name} ({account_id})",
        source_type="aws",
        last_updated=int(time.time()),
        default_chunk_size=0,
        default_chunk_overlap=0,
        reload_interval=SYNC_INTERVAL,
        metadata={
            "account_id": account_id,
            "account_name": account_name,
            "resource_types": RESOURCE_TYPES,
        },
    )
    await client.upsert_datasource(datasource_info)
    
    # ... existing region discovery, resource sync logic ...
    # ... but passing session to all boto3-using functions ...
```

### 4. Refactor `sync_aws_resources()` (the main sync function)

```python
async def sync_aws_resources(client: Client):
    accounts = parse_account_list()
    
    if not accounts:
        # Backward compat: single account using default credentials
        session = boto3.Session(region_name=AWS_REGION)
        await sync_account(client, session, "default")
    else:
        # Multi-account: iterate over configured accounts sequentially
        setup_aws_profiles()
        for account in accounts:
            try:
                logging.info(f"Starting sync for account: {account['name']} ({account['id']})")
                session = boto3.Session(profile_name=account["name"], region_name=AWS_REGION)
                await sync_account(client, session, account["name"])
                logging.info(f"Completed sync for account: {account['name']}")
            except Exception as e:
                logging.error(f"Failed to sync account {account['name']}: {e}", exc_info=True)
                # Continue with next account -- don't let one failure stop the rest
```

### 5. Update `__main__` Entry Point

Currently calls `get_account_id()` at startup to set the ingestor name to `aws_ingestor_{account_id}`. For multi-account, the ingestor name should not be tied to a single account:

```python
if __name__ == "__main__":
    accounts = parse_account_list()
    
    if accounts:
        # Multi-account mode
        setup_aws_profiles()
        ingestor_name = "aws_ingestor_multi"
        ingestor_description = f"AWS ingestor for {len(accounts)} accounts: {', '.join(a['name'] for a in accounts)}"
    else:
        # Single-account mode (backward compatible)
        account_id = asyncio.run(get_account_id())
        ingestor_name = f"aws_ingestor_{account_id}"
        ingestor_description = "Ingestor for AWS resources (EC2, S3, EKS, IAM, etc.)"
    
    IngestorBuilder()
        .name(ingestor_name)
        .type("aws")
        .description(ingestor_description)
        ...
```

### 6. Update `README.md`

Add a "Multi-Account Configuration" section documenting:
- `AWS_ACCOUNT_LIST` format and examples
- `CROSS_ACCOUNT_ROLE_NAME` default value
- IAM trust policy requirements for cross-account roles
- Example docker-compose usage
- Explanation that each account becomes a separate datasource

### 7. Update `docker-compose.dev.yaml`

Add optional env vars to the `aws_ingestor` service definition:

```yaml
aws_ingestor:
  environment:
    # ... existing vars ...
    AWS_ACCOUNT_LIST: ${AWS_ACCOUNT_LIST:-}
    CROSS_ACCOUNT_ROLE_NAME: ${CROSS_ACCOUNT_ROLE_NAME:-caipe-read-only}
```

## Files Changed

| File | Change |
|------|--------|
| `.../ingestors/src/ingestors/aws/ingestor.py` | Core multi-account logic: account parsing, profile setup, session-based boto3, per-account sync |
| `.../ingestors/src/ingestors/aws/README.md` | Multi-account documentation section |
| `docker-compose.dev.yaml` | Add `AWS_ACCOUNT_LIST` and `CROSS_ACCOUNT_ROLE_NAME` env vars |

## What Stays the Same

- All 14 resource fetcher functions keep the same internal logic; they just gain a `session` parameter
- `IngestorBuilder` and `Client` (common library) are unchanged
- The datasource ID format (`aws-account-{account_id}`) stays the same
- `SYNC_INTERVAL`, `RESOURCE_TYPES`, and all other existing env vars continue to work
- Single-account deployments (no `AWS_ACCOUNT_LIST` set) require zero changes

## IAM Prerequisites

For cross-account access, each target account must have a role (default: `caipe-read-only`) with:

1. **Trust policy** allowing the ingestor's base credentials to assume it:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"AWS": "arn:aws:iam::BASE_ACCOUNT_ID:role/ingestor-role"},
    "Action": "sts:AssumeRole"
  }]
}
```

2. **Permissions policy** with the same read-only permissions documented in the existing README (tag:GetResources, ec2:Describe*, eks:Describe*, etc.)

## Risk Assessment

- **Low risk**: The refactor is additive. When `AWS_ACCOUNT_LIST` is unset, behavior is identical to today.
- **boto3 profile assumption**: boto3 natively supports `role_arn` + `credential_source = Environment` in `~/.aws/config`, so `boto3.Session(profile_name=...)` will transparently perform STS AssumeRole. No manual token management needed.
- **Error isolation**: If one account fails (bad credentials, role trust policy issue), the others continue syncing. Each account's errors are logged independently.
- **No shared-library changes**: The common `IngestorBuilder` and `Client` are unchanged, so no risk to other ingestors.
