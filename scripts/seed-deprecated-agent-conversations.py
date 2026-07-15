#!/usr/bin/env python3
# assisted-by claude code claude-sonnet-4-6
"""Seed MongoDB with supervisor-agent-era conversations for local testing.

Inserts two conversations that trigger the deprecated-agent UI paths:

  A) participants=[] — old supervisor-era conversations that pre-date the
     dynamic-agent participants model.  ChatContainer shows a deprecation
     notice with a CTA to start a new conversation.

  B) participants=[{type: agent, id: <non-existent-uuid>}] — a conversation
     that references an agent which has since been deleted.  ChatContainer
     renders the full read-only history with a banner.

Usage:
  python scripts/seed-deprecated-agent-conversations.py [--owner YOUR_EMAIL]

The script is idempotent: re-running it updates the existing documents rather
than inserting duplicates.  Pass --drop to wipe and re-insert from scratch.

Prerequisites:
  pip install pymongo
  docker-compose (mongodb service) running on host port 28017
"""

import argparse
import sys
import uuid
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Config — defaults match docker-compose/docker-compose.yaml
# ---------------------------------------------------------------------------
MONGO_URI = "mongodb://admin:changeme@localhost:27017/caipe?authSource=admin"
DB_NAME = "caipe"

# Fixed UUIDs so re-runs are idempotent
CONV_UNLINKED_ID = "00000000-dead-beef-cafe-000000000001"
CONV_DELETED_AGENT_ID = "00000000-dead-beef-cafe-000000000002"
CONV_INCIDENT_ID = "00000000-dead-beef-cafe-000000000003"
CONV_ONBOARDING_ID = "00000000-dead-beef-cafe-000000000004"
CONV_K8S_DEBUG_ID = "00000000-dead-beef-cafe-000000000005"
CONV_SECURITY_ID = "00000000-dead-beef-cafe-000000000006"
FAKE_AGENT_ID = "ffffffff-dead-beef-cafe-000000000000"  # won't exist in dynamic_agents

NOW = datetime.now(timezone.utc)


def make_sharing():
    return {
        "is_public": False,
        "shared_with": [],
        "shared_with_teams": [],
        "share_link_enabled": False,
    }


def make_conversation(conv_id: str, title: str, participants: list, owner: str):
    return {
        "_id": conv_id,
        "title": title,
        "client_type": "webui",
        "owner_id": owner,
        "participants": participants,
        "created_at": NOW,
        "updated_at": NOW,
        "metadata": {
            "client_type": "webui",
            "total_messages": 0,
        },
        "sharing": make_sharing(),
        "tags": [],
        "is_archived": False,
        "is_pinned": False,
        "deleted_at": None,
    }


def make_message(conversation_id: str, owner: str, role: str, content: str, msg_id: str):
    return {
        "message_id": msg_id,
        "conversation_id": conversation_id,
        "owner_id": owner,
        "role": role,
        "content": content,
        "created_at": NOW,
        "updated_at": NOW,
        "stream_events": [],
        "metadata": {
            "turn_id": f"turn-{uuid.uuid4()}",
            "is_final": True,
            "source": "web",
        },
    }


def seed(owner: str, drop: bool = False):
    try:
        from pymongo import MongoClient
        from pymongo.errors import ConnectionFailure
    except ImportError:
        print("ERROR: pymongo not installed.  Run: pip install pymongo", file=sys.stderr)
        sys.exit(1)

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except ConnectionFailure as exc:
        print(f"ERROR: Could not connect to MongoDB at {MONGO_URI}: {exc}", file=sys.stderr)
        print("Is docker-compose up with the mongodb service?", file=sys.stderr)
        sys.exit(1)

    db = client[DB_NAME]
    conversations = db["conversations"]
    messages = db["messages"]

    all_conv_ids = [
        CONV_UNLINKED_ID,
        CONV_DELETED_AGENT_ID,
        CONV_INCIDENT_ID,
        CONV_ONBOARDING_ID,
        CONV_K8S_DEBUG_ID,
        CONV_SECURITY_ID,
    ]

    if drop:
        for cid in all_conv_ids:
            conversations.delete_one({"_id": cid})
            messages.delete_many({"conversation_id": cid})
        print("Dropped existing seed documents.")

    # ── Scenario A: participants=[] ──────────────────────────────────────────
    conv_a = make_conversation(
        CONV_UNLINKED_ID,
        "Old Supervisor Chat (no agent participant)",
        [],  # <- triggers !selectedAgentId branch
        owner,
    )
    conversations.replace_one({"_id": CONV_UNLINKED_ID}, conv_a, upsert=True)
    print(f"Upserted conversation A  →  /chat/{CONV_UNLINKED_ID}")

    msg_a1 = make_message(CONV_UNLINKED_ID, owner, "user",
                          "What is the on-call rotation for platform SREs?",
                          f"msg-a-user-{CONV_UNLINKED_ID[:8]}")
    msg_a2 = make_message(CONV_UNLINKED_ID, owner, "assistant",
                          "The on-call rotation is managed in PagerDuty. "
                          "You can view it at https://your-org.pagerduty.com/schedules.",
                          f"msg-a-asst-{CONV_UNLINKED_ID[:8]}")
    msg_a3 = make_message(CONV_UNLINKED_ID, owner, "user",
                          "How do I escalate a P1 incident?",
                          f"msg-a-user2-{CONV_UNLINKED_ID[:8]}")
    msg_a4 = make_message(CONV_UNLINKED_ID, owner, "assistant",
                          "For a P1 incident: 1) Page the on-call SRE via PagerDuty, "
                          "2) Create an incident channel in Slack, "
                          "3) Notify the engineering lead.",
                          f"msg-a-asst2-{CONV_UNLINKED_ID[:8]}")

    for msg in [msg_a1, msg_a2, msg_a3, msg_a4]:
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_UNLINKED_ID},
            msg,
            upsert=True,
        )
    conversations.update_one(
        {"_id": CONV_UNLINKED_ID},
        {"$set": {"metadata.total_messages": 4}},
    )
    print("  Inserted 4 messages for conversation A")

    # ── Scenario B: deleted agent participant ────────────────────────────────
    conv_b = make_conversation(
        CONV_DELETED_AGENT_ID,
        "Old Supervisor Chat (deleted agent)",
        [{"type": "agent", "id": FAKE_AGENT_ID}],  # <- agent returns 404
        owner,
    )
    conversations.replace_one({"_id": CONV_DELETED_AGENT_ID}, conv_b, upsert=True)
    print(f"Upserted conversation B  →  /chat/{CONV_DELETED_AGENT_ID}")

    msg_b1 = make_message(CONV_DELETED_AGENT_ID, owner, "user",
                          "How do I rotate my LLM API keys?",
                          f"msg-b-user-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b2 = make_message(CONV_DELETED_AGENT_ID, owner, "assistant",
                          "You can rotate your LLM keys via the Credentials page under Settings. "
                          "Click 'Rotate Key' next to the provider you want to update.",
                          f"msg-b-asst-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b3 = make_message(CONV_DELETED_AGENT_ID, owner, "user",
                          "Will existing running jobs be affected?",
                          f"msg-b-user2-{CONV_DELETED_AGENT_ID[:8]}")
    msg_b4 = make_message(CONV_DELETED_AGENT_ID, owner, "assistant",
                          "Existing in-flight requests will complete using the old key. "
                          "New requests after rotation will use the new key automatically.",
                          f"msg-b-asst2-{CONV_DELETED_AGENT_ID[:8]}")

    for msg in [msg_b1, msg_b2, msg_b3, msg_b4]:
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_DELETED_AGENT_ID},
            msg,
            upsert=True,
        )
    conversations.update_one(
        {"_id": CONV_DELETED_AGENT_ID},
        {"$set": {"metadata.total_messages": 4}},
    )
    print("  Inserted 4 messages for conversation B")

    # ── Scenario C: P1 incident response thread (participants=[], long history) ─
    conv_c = make_conversation(
        CONV_INCIDENT_ID,
        "P1 Incident: API Gateway Latency Spike",
        [],
        owner,
    )
    conversations.replace_one({"_id": CONV_INCIDENT_ID}, conv_c, upsert=True)
    print(f"Upserted conversation C  →  /chat/{CONV_INCIDENT_ID}")

    incident_msgs = [
        ("user",      "We're seeing P99 latency on the API gateway spike to 4s. Alerts firing for the last 10 minutes. What should I check first?"),
        ("assistant", "Start with the API gateway access logs and upstream service health.\n\n**Immediate checks:**\n1. `kubectl logs -n api-gateway deploy/envoy-proxy --tail=200 | grep -E 'upstream|timeout'`\n2. Check Prometheus: `rate(envoy_cluster_upstream_rq_timeout_total[5m])` by cluster\n3. Verify downstream dependencies: payment-service, auth-service, and catalog-service endpoints\n\nWhat does `kubectl get pods -n api-gateway` show — any CrashLoopBackOff or Pending pods?"),
        ("user",      "All pods look healthy. But I see these in the logs:\n```\n[2024-01-15 14:32:11] upstream connect error or disconnect/reset before headers. reset reason: connection timeout\ncluster: catalog-service, timeout: 3000ms\n```"),
        ("assistant", "That pinpoints it — the catalog-service is timing out from the API gateway's perspective. The gateway is waiting the full 3 s before failing.\n\n**Next steps:**\n1. Check catalog-service directly: `kubectl get pods -n catalog && kubectl top pods -n catalog`\n2. Check if there was a recent deployment: `kubectl rollout history deploy/catalog-service -n catalog`\n3. Check its HPA: `kubectl get hpa -n catalog` — it may be under-scaled\n4. Look at catalog DB connections: `kubectl exec -n catalog deploy/catalog-service -- curl -s localhost:8080/actuator/metrics/hikaricp.connections.active`\n\nIf the HPA is maxed out, you can manually scale: `kubectl scale deploy/catalog-service --replicas=10 -n catalog`"),
        ("user",      "HPA is at max (8/8). CPU usage at 94%. Looks like a traffic surge hit catalog. We have a flash sale running."),
        ("assistant", "Classic flash-sale overload. Immediate mitigation options:\n\n**Option 1 — Emergency scale-out (fastest):**\n```bash\nkubectl scale deploy/catalog-service --replicas=20 -n catalog\n```\nMonitor: `watch kubectl get pods -n catalog`\n\n**Option 2 — Circuit breaker on the gateway (if catalog is unrecoverable):**\nAdd a short-circuit rule in Envoy to return cached/degraded responses instead of waiting 3 s.\n\n**Option 3 — Rate-limit flash-sale traffic at the edge:**\nIf you have an ingress rate-limit annotation, cap flash-sale product category requests temporarily.\n\nI'd start with Option 1 immediately, then Option 3 to protect the new replicas from being overwhelmed again. Want me to draft the Envoy circuit-breaker config?"),
        ("user",      "Scaled to 20. Latency coming down. P99 now at 800ms. Still elevated but much better. Should I keep the extra replicas up overnight?"),
        ("assistant", "Yes, keep them up through the flash sale window. A few recommendations:\n\n1. **Set a memory request/limit** if not already set — with 20 replicas you want to avoid OOM kills under load\n2. **Adjust HPA max** to 20 (or higher) permanently so auto-scaling can reach this level next time without manual intervention:\n   ```bash\n   kubectl patch hpa catalog-service -n catalog -p '{\"spec\":{\"maxReplicas\":20}}'\n   ```\n3. **Post-incident**: add a Prometheus alert for `envoy_cluster_upstream_rq_timeout_total` rate > 0.1/s so you catch this before it hits P99 latency\n4. **Scale back down** after the sale ends — watching cost\n\nP99 at 800 ms is still 2× normal. If it doesn't reach baseline in the next 15 minutes, check catalog DB connection pool limits next."),
    ]

    for i, (role, content) in enumerate(incident_msgs):
        msg = make_message(CONV_INCIDENT_ID, owner, role, content, f"msg-c-{i}-{CONV_INCIDENT_ID[:8]}")
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_INCIDENT_ID},
            msg, upsert=True,
        )
    conversations.update_one({"_id": CONV_INCIDENT_ID}, {"$set": {"metadata.total_messages": len(incident_msgs)}})
    print(f"  Inserted {len(incident_msgs)} messages for conversation C")

    # ── Scenario D: platform onboarding (deleted agent, long history) ──────────
    conv_d = make_conversation(
        CONV_ONBOARDING_ID,
        "Platform Onboarding: Getting Started with AI Agents",
        [{"type": "agent", "id": FAKE_AGENT_ID}],
        owner,
    )
    conversations.replace_one({"_id": CONV_ONBOARDING_ID}, conv_d, upsert=True)
    print(f"Upserted conversation D  →  /chat/{CONV_ONBOARDING_ID}")

    onboarding_msgs = [
        ("user",      "I just got access to the platform. Where do I start? I want to automate some of our runbooks."),
        ("assistant", "Welcome! Here's the recommended path for automating runbooks:\n\n**Step 1 — Explore available agents**\nGo to the **Agents** tab to see what's available. Each agent has a specific domain (SRE, Security, DevOps, etc.).\n\n**Step 2 — Start a conversation**\nOpen a chat with the agent most relevant to your runbook. Describe the task in plain English — agents can execute kubectl commands, query Prometheus, open PagerDuty incidents, and more.\n\n**Step 3 — Iterate and save**\nOnce a conversation produces a reliable workflow, you can save it as a reusable skill.\n\nWhat kind of runbooks are you looking to automate first?"),
        ("user",      "We have a runbook for rotating database credentials. It involves updating a Vault secret, triggering a rolling restart, and notifying the team in Slack."),
        ("assistant", "That's a perfect fit for a multi-step agent workflow. Here's how it maps:\n\n```\n[User trigger]\n    ↓\n1. vault kv put secret/db/prod password=<new>\n2. kubectl rollout restart deploy/api-server -n production\n3. kubectl rollout status deploy/api-server -n production  # wait for success\n4. slack.post_message(channel=#ops-alerts, text=\"DB creds rotated ✅\")\n```\n\n**To set this up:**\n- The SRE agent has Vault and kubectl tools built in\n- For Slack notifications you'll need to connect your Slack workspace under Settings → Integrations\n\nWould you like to walk through each step interactively, or do you have an existing runbook document I can help translate into agent steps?"),
        ("user",      "I have a runbook doc. Here's the relevant part:\n\n1. Generate new password with `openssl rand -base64 32`\n2. Update Vault: `vault kv put secret/prod/postgres password=<new>`\n3. Update k8s secret: `kubectl create secret generic pg-creds --from-literal=password=<new> --dry-run=client -o yaml | kubectl apply -f -`\n4. Rolling restart: `kubectl rollout restart deploy/api-server`\n5. Verify: `kubectl rollout status deploy/api-server --timeout=5m`\n6. Post to #ops-alerts in Slack"),
        ("assistant", "This is a clean runbook — I can execute all of these steps. A few notes before we run it:\n\n**Security note:** Step 1 generates a plaintext password in shell history. Recommend using Vault's own `vault write sys/policies/...` to generate a random secret instead, or piping directly:\n```bash\nnew_pass=$(openssl rand -base64 32)\nvault kv put secret/prod/postgres password=\"$new_pass\"\nunset new_pass  # don't leave it in env\n```\n\n**Step 3 improvement:** Your command is correct but will fail if the secret doesn't exist yet. A safer version:\n```bash\nkubectl get secret pg-creds -n production &>/dev/null \\\n  && kubectl patch secret pg-creds -n production --patch=\"{...}\" \\\n  || kubectl create secret generic pg-creds ...\n```\n\nShall I execute this runbook now, or save it as a skill you can trigger on-demand?"),
        ("user",      "Save it as a skill please. Also, how do I give my team access to this skill?"),
        ("assistant", "To save and share the skill:\n\n**Save as a skill:**\n1. Click the **Skills** tab in the left sidebar\n2. Click **New Skill** → paste the runbook steps\n3. Give it a name like `rotate-postgres-credentials` and add a description\n4. Set the trigger to **Manual** (or scheduled if you want periodic rotation)\n\n**Share with your team:**\n1. Open the skill → **Settings** → **Access**\n2. Add your team under **Teams with access**\n3. Team members will see it in their Skills list and can run it from chat: `/skill rotate-postgres-credentials`\n\n**RBAC note:** Team members need the `skill:execute` permission. Admins can grant this under Admin → Teams → your team → Permissions.\n\nOnce shared, anyone on the team can trigger it from chat without needing to know the underlying commands."),
    ]

    for i, (role, content) in enumerate(onboarding_msgs):
        msg = make_message(CONV_ONBOARDING_ID, owner, role, content, f"msg-d-{i}-{CONV_ONBOARDING_ID[:8]}")
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_ONBOARDING_ID},
            msg, upsert=True,
        )
    conversations.update_one({"_id": CONV_ONBOARDING_ID}, {"$set": {"metadata.total_messages": len(onboarding_msgs)}})
    print(f"  Inserted {len(onboarding_msgs)} messages for conversation D")

    # ── Scenario E: Kubernetes debugging session (participants=[], rich output) ─
    conv_e = make_conversation(
        CONV_K8S_DEBUG_ID,
        "Debug: CrashLoopBackOff in production namespace",
        [],
        owner,
    )
    conversations.replace_one({"_id": CONV_K8S_DEBUG_ID}, conv_e, upsert=True)
    print(f"Upserted conversation E  →  /chat/{CONV_K8S_DEBUG_ID}")

    k8s_msgs = [
        ("user",      "Getting CrashLoopBackOff on our payment-service pods since the last deploy 20 minutes ago. 3 out of 5 pods are crashing."),
        ("assistant", "Let's diagnose. Running initial checks:\n\n```bash\n$ kubectl get pods -n production -l app=payment-service\nNAME                               READY   STATUS             RESTARTS   AGE\npayment-service-7d9f8b6c4-2xk9p   0/1     CrashLoopBackOff   5          18m\npayment-service-7d9f8b6c4-5mnt7   1/1     Running            0          18m\npayment-service-7d9f8b6c4-9qr2s   0/1     CrashLoopBackOff   4          18m\npayment-service-7d9f8b6c4-lp8kv   1/1     Running            0          18m\npayment-service-7d9f8b6c4-xw3dp   0/1     CrashLoopBackOff   6          18m\n```\n\nFetching logs from a crashing pod:\n```bash\n$ kubectl logs payment-service-7d9f8b6c4-2xk9p --previous\n```\nWhat does the crash output say?"),
        ("user",      "Here's the log:\n```\nFatal error: STRIPE_SECRET_KEY environment variable is not set\nProcess exiting with code 1\n```"),
        ("assistant", "Found it — a missing environment variable from the new deployment. The `STRIPE_SECRET_KEY` env var isn't being injected into the crashing pods.\n\n**Why 3 crash, 2 run:** The 2 running pods are from the previous ReplicaSet (old deploy). The 3 crashing ones are the new pods from the rollout.\n\n**Fix options:**\n\n**Option 1 — Patch the deployment env (fastest):**\n```bash\nkubectl set env deploy/payment-service \\\n  STRIPE_SECRET_KEY=$(vault kv get -field=key secret/prod/stripe) \\\n  -n production\n```\n\n**Option 2 — Add missing secret ref to the deployment manifest:**\n```yaml\nenv:\n  - name: STRIPE_SECRET_KEY\n    valueFrom:\n      secretKeyRef:\n        name: stripe-credentials\n        key: secret-key\n```\nThen `kubectl apply -f payment-service.yaml`\n\nOption 2 is the right long-term fix. Does `kubectl get secret stripe-credentials -n production` exist?"),
        ("user",      "The secret exists! Looks like the new deployment manifest lost the secretKeyRef. We must have accidentally dropped it in the last PR."),
        ("assistant", "Classic — happens during rebases or merge conflicts with deployment manifests. Here's the immediate remediation:\n\n```bash\n# 1. Patch the live deployment to add the missing secretKeyRef\nkubectl patch deploy/payment-service -n production --type='json' -p='[\n  {\"op\": \"add\", \"path\": \"/spec/template/spec/containers/0/env/-\",\n   \"value\": {\"name\": \"STRIPE_SECRET_KEY\", \"valueFrom\": {\"secretKeyRef\": {\"name\": \"stripe-credentials\", \"key\": \"secret-key\"}}}}\n]'\n\n# 2. Watch the rollout\nkubectl rollout status deploy/payment-service -n production\n```\n\n**Post-fix:**\n- Fix the source manifest in git and merge a follow-up PR\n- Add a CI check that validates required env vars are present in deployment manifests — tools like `kubeval` or `conftest` with OPA policies can catch this before merge\n\nOnce the rollout completes all 5 pods should be Running. Want me to set up an OPA policy to prevent this class of issue going forward?"),
        ("user",      "Rollout complete, all 5 pods running! Thanks. Yes please draft the OPA policy."),
        ("assistant", "Here's an OPA/Conftest policy that enforces required env vars on Deployments:\n\n```rego\n# policy/required-env-vars.rego\npackage kubernetes.deployment\n\n# Map of container name patterns → required env var names\nrequired_env_vars := {\n  \"payment-service\": {\"STRIPE_SECRET_KEY\", \"DATABASE_URL\"},\n  \"auth-service\":    {\"JWT_SECRET\", \"DATABASE_URL\"},\n}\n\ndeny[msg] {\n  input.kind == \"Deployment\"\n  container := input.spec.template.spec.containers[_]\n  required := required_env_vars[container.name]\n  required != null\n  env_names := {e.name | e := container.env[_]}\n  secret_refs := {e.name | e := container.env[_]; e.valueFrom.secretKeyRef}\n  missing := required - (env_names | secret_refs)\n  count(missing) > 0\n  msg := sprintf(\"container '%v' is missing required env vars: %v\", [container.name, missing])\n}\n```\n\nAdd this to your CI pipeline:\n```bash\nconftest test k8s/deployments/ --policy policy/\n```\n\nThis will fail the pipeline if any required env var is absent from a deployment manifest before it ever reaches the cluster."),
    ]

    for i, (role, content) in enumerate(k8s_msgs):
        msg = make_message(CONV_K8S_DEBUG_ID, owner, role, content, f"msg-e-{i}-{CONV_K8S_DEBUG_ID[:8]}")
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_K8S_DEBUG_ID},
            msg, upsert=True,
        )
    conversations.update_one({"_id": CONV_K8S_DEBUG_ID}, {"$set": {"metadata.total_messages": len(k8s_msgs)}})
    print(f"  Inserted {len(k8s_msgs)} messages for conversation E")

    # ── Scenario F: security audit thread (deleted agent) ───────────────────────
    conv_f = make_conversation(
        CONV_SECURITY_ID,
        "Security Review: IAM Permissions Audit",
        [{"type": "agent", "id": FAKE_AGENT_ID}],
        owner,
    )
    conversations.replace_one({"_id": CONV_SECURITY_ID}, conv_f, upsert=True)
    print(f"Upserted conversation F  →  /chat/{CONV_SECURITY_ID}")

    security_msgs = [
        ("user",      "We need to do a quarterly IAM permissions audit for our AWS account. Where should I start?"),
        ("assistant", "For a quarterly IAM audit I recommend this sequence:\n\n1. **Identify unused credentials** — IAM Access Analyzer + Credential Report\n2. **Find over-privileged roles** — roles with `*:*` or broad wildcards\n3. **Check for public S3 buckets** — S3 Block Public Access settings\n4. **Review cross-account trust relationships**\n5. **Rotate stale access keys** — keys > 90 days old\n\nStart with the credential report:\n```bash\naws iam generate-credential-report\naws iam get-credential-report --query 'Content' --output text | base64 -d > cred-report.csv\n```\n\nHow many IAM users/roles are we working with? That affects how deep we can go in one session."),
        ("user",      "About 45 IAM users, 120 roles. We've had some turnover and I suspect there are stale accounts from people who left."),
        ("assistant", "With 45 users and recent turnover, stale accounts are the highest-risk item. Let's find them:\n\n```bash\n# Users who have never logged in or haven't logged in for 90+ days\naws iam get-credential-report --query 'Content' --output text | base64 -d | \\\n  awk -F',' 'NR>1 && ($5==\"N/A\" || ($5!=\"N/A\" && systime()-mktime(gensub(\"T\",\" \",\"g\",$5)\" 00\")>7776000)) {print $1, $5}'\n\n# Users with active access keys not used in 90 days\naws iam list-users --query 'Users[*].UserName' --output text | \\\n  tr '\\t' '\\n' | while read user; do\n    aws iam list-access-keys --user-name \"$user\" --query \\\n      'AccessKeyMetadata[?Status==`Active`].AccessKeyId' --output text | \\\n      while read key; do\n        last=$(aws iam get-access-key-last-used --access-key-id \"$key\" \\\n          --query 'AccessKeyLastUsed.LastUsedDate' --output text)\n        echo \"$user $key $last\"\n      done\n  done\n```\n\nThis will give you a list to cross-reference against your HR offboarding records."),
        ("user",      "Found 8 users with no login in 180+ days. 3 of them have active access keys. How should I handle this?"),
        ("assistant", "Disable before delete — gives you a rollback window if someone pushes back.\n\n**Step 1 — Disable the access keys immediately (zero risk, reversible):**\n```bash\nfor USER in alice bob charlie; do\n  for KEY in $(aws iam list-access-keys --user-name $USER \\\n    --query 'AccessKeyMetadata[].AccessKeyId' --output text); do\n    aws iam update-access-key --user-name $USER --access-key-id $KEY --status Inactive\n    echo \"Disabled $KEY for $USER\"\n  done\ndone\n```\n\n**Step 2 — Remove console login for inactive users:**\n```bash\nfor USER in alice bob charlie danielle eve frank grace henry; do\n  aws iam delete-login-profile --user-name $USER 2>/dev/null && \\\n    echo \"Removed console access for $USER\" || echo \"$USER had no console access\"\ndone\n```\n\n**Step 3 — After 30-day hold, delete users:**\n```bash\n# Tag them so you remember when to clean up\nfor USER in alice bob charlie ...; do\n  aws iam tag-user --user-name $USER \\\n    --tags Key=pending-deletion,Value=$(date +%Y-%m-%d)\ndone\n```\n\nKeep an audit trail — log these actions to CloudTrail and document in your security ticket."),
        ("user",      "Done. Now can you help me find roles with overly broad permissions — especially anything with Administrator or * wildcards?"),
        ("assistant", "Here's a script to surface over-privileged roles:\n\n```bash\n# Find all roles with AdministratorAccess managed policy\naws iam list-roles --query 'Roles[*].RoleName' --output text | tr '\\t' '\\n' | \\\n  while read role; do\n    aws iam list-attached-role-policies --role-name $role \\\n      --query \"AttachedPolicies[?PolicyName=='AdministratorAccess'].PolicyName\" \\\n      --output text | grep -q AdministratorAccess && echo \"ADMIN: $role\"\n  done\n\n# Find inline policies with Action: \"*\"\naws iam list-roles --query 'Roles[*].RoleName' --output text | tr '\\t' '\\n' | \\\n  while read role; do\n    for pol in $(aws iam list-role-policies --role-name $role --output text --query 'PolicyNames'); do\n      doc=$(aws iam get-role-policy --role-name $role --policy-name $pol \\\n        --query 'PolicyDocument' --output json)\n      echo $doc | python3 -c \"\nimport sys,json\nd=json.load(sys.stdin)\nfor s in d.get('Statement',[]):\n  a=s.get('Action',[])\n  if a=='*' or '*' in (a if isinstance(a,list) else [a]):\n    print(f\\\"WILDCARD ACTION: $role / $pol\\\")\" 2>/dev/null\n    done\n  done\n```\n\nFor each hit, apply least-privilege: replace `*` with the specific actions the role actually needs. Use CloudTrail + IAM Access Analyzer to determine what actions it has actually used in the last 90 days — AWS will generate a least-privilege policy suggestion automatically."),
    ]

    for i, (role, content) in enumerate(security_msgs):
        msg = make_message(CONV_SECURITY_ID, owner, role, content, f"msg-f-{i}-{CONV_SECURITY_ID[:8]}")
        messages.replace_one(
            {"message_id": msg["message_id"], "conversation_id": CONV_SECURITY_ID},
            msg, upsert=True,
        )
    conversations.update_one({"_id": CONV_SECURITY_ID}, {"$set": {"metadata.total_messages": len(security_msgs)}})
    print(f"  Inserted {len(security_msgs)} messages for conversation F")

    print()
    print("Done.  Log in to the UI as:", owner)
    print()
    print("  A — No agent participant (short history):")
    print(f"    http://localhost:3000/chat/{CONV_UNLINKED_ID}")
    print()
    print("  B — Deleted agent participant (short history):")
    print(f"    http://localhost:3000/chat/{CONV_DELETED_AGENT_ID}")
    print()
    print("  C — P1 Incident: API Gateway Latency Spike (no agent, 7 msgs):")
    print(f"    http://localhost:3000/chat/{CONV_INCIDENT_ID}")
    print()
    print("  D — Platform Onboarding (deleted agent, 6 msgs):")
    print(f"    http://localhost:3000/chat/{CONV_ONBOARDING_ID}")
    print()
    print("  E — Debug: CrashLoopBackOff (no agent, 7 msgs):")
    print(f"    http://localhost:3000/chat/{CONV_K8S_DEBUG_ID}")
    print()
    print("  F — Security Review: IAM Audit (deleted agent, 5 msgs):")
    print(f"    http://localhost:3000/chat/{CONV_SECURITY_ID}")
    print()
    print("NOTE: Conversations appear in the sidebar only when logged in as the owner email above.")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--owner", default="user@example.com",
                        help="Owner email (must match your Keycloak login). "
                             "Default: user@example.com")
    parser.add_argument("--drop", action="store_true",
                        help="Drop existing seed documents before reinserting.")
    args = parser.parse_args()

    seed(owner=args.owner, drop=args.drop)


if __name__ == "__main__":
    main()
