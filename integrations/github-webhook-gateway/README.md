# GitHub Webhook Gateway

Public ingress for GitHub deliveries shared by CAIPE consumers.

```
GitHub -> API Gateway -> verifier Lambda -> SNS topic
                                          ├─ SQS queue -> TOME
                                          ├─ SQS queue -> autonomous agents
                                          └─ SQS queue -> another CAIPE deployment
```

The Lambda verifies the GitHub HMAC over the exact request bytes, then publishes
an envelope containing the original JSON payload and GitHub headers. It does not
log payloads or signatures.

Each consumer must subscribe its own SQS queue with raw-message delivery enabled.
Sharing one queue between services creates competing consumers and loses the
pub/sub guarantee.

## Lambda environment

| Variable | Description |
|---|---|
| `GITHUB_WEBHOOK_SECRET_ARN` | Secrets Manager ARN containing the shared secret. |
| `SNS_TOPIC_ARN` | SNS topic used to fan out verified deliveries. |

The Lambda role needs `secretsmanager:GetSecretValue` and `sns:Publish` for those
resources. Each queue policy must permit `sqs:SendMessage` from the topic ARN.

## Test

```bash
cd integrations/github-webhook-gateway/app
python3 -m unittest -v test_app.py
```
