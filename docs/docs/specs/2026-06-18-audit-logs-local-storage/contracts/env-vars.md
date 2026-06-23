# Environment Variable Contract: Audit Log Backend

## Variables

| Variable | Required | Default | Valid values | Description |
|----------|----------|---------|-------------|-------------|
| `AUDIT_LOG_BACKEND` | No | `mongodb` | `mongodb`, `local`, `s3` | Selects the active audit storage backend |
| `AUDIT_LOG_LOCAL_PATH` | When `AUDIT_LOG_BACKEND=local` | `./audit-logs` | Any writable path | Root directory for NDJSON audit files |
| `AUDIT_LOG_S3_BUCKET` | When `AUDIT_LOG_BACKEND=s3` | — | Valid S3 bucket name | Target S3 bucket |
| `AUDIT_LOG_S3_PREFIX` | When `AUDIT_LOG_BACKEND=s3` | `audit` | String (no leading `/`) | S3 key prefix |
| `AUDIT_LOG_S3_REGION` | When `AUDIT_LOG_BACKEND=s3` | `us-east-1` | AWS region string | S3 region |
| `AUDIT_LOG_S3_ENDPOINT_URL` | No | — | URL | Custom endpoint (MinIO, GCS) |

## Credential variables (S3 backend only)

Standard AWS credential chain is used. No new variables introduced by this feature. Priority order (highest first):

| Method | Variables / mechanism | Notes |
|--------|-----------------------|-------|
| Static keys | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ optional `AWS_SESSION_TOKEN`) | Dev / CI only |
| IRSA (EKS) | `AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE` — injected automatically by the EKS pod identity webhook | Preferred for production |
| EC2 instance profile | IMDSv2 (no env vars needed) | EC2-based deployments |
| ECS task role | `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` — injected automatically | ECS deployments |

### IRSA setup (EKS)

Both boto3 and `@aws-sdk/client-s3` pick up `AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE` automatically — no code change needed. To wire up IRSA via Helm:

```yaml
# values.yaml
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: "arn:aws:iam::<ACCOUNT_ID>:role/<ROLE_NAME>"
```

The IAM role needs the following minimum policy on the audit bucket:

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::<AUDIT_BUCKET>/<AUDIT_PREFIX>/*"
}
```

The IRSA webhook injects `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE` into the pod automatically — no manual env var configuration needed in the deployment.

## Startup validation

At process startup, the factory:
1. Reads `AUDIT_LOG_BACKEND` (default `mongodb`)
2. For `local`: logs `[audit] backend=local path=<path>`
3. For `s3`: logs `[audit] backend=s3 bucket=<bucket> prefix=<prefix>` (never logs credentials)
4. For unknown value: raises `ValueError` (Python) / throws `Error` (TypeScript) — fail-fast, no silent fallback
