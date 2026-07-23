#!/usr/bin/env bash
# assisted-by claude code claude-sonnet-4-6
# deploy-to-tome-sri.sh — rsync local mirror -> tome-sri.dev.outshift.io and bring up stack
#
# Same VM as the old caipe-rbac.outshift.io deploy (deploy-to-rbac.sh), renamed
# for testing prebuild/feat/tome-analytics-and-metrics. Two differences from
# deploy-to-rbac.sh:
#   - docker-compose.tome-sri.yaml (not .rbac.yaml) for the nginx/TLS/hostname override.
#   - Only tome-agent + mycelium-db + mycelium-backend are started from
#     docker-compose.tome.yaml (not its own duplicate keycloak/openfga/agentgateway),
#     then bridged into the main stack's default network so caipe-ui can reach
#     them by container name (see docker-compose.tome-sri.yaml's TOME_AGENT_URL /
#     MYCELIUM_URL, which assume this bridging).
#
# Usage:
#   ./deploy-to-tome-sri.sh          # rsync + build + bring up both stacks
#   ./deploy-to-tome-sri.sh --sync   # rsync only (no build/up)
#   ./deploy-to-tome-sri.sh --up     # build + bring up both stacks (no rsync)
#   ./deploy-to-tome-sri.sh --down   # tear down both stacks on remote
set -euo pipefail

REMOTE="ubuntu@tome-sri.dev.outshift.io"
REMOTE_DIR="/home/ubuntu/tome-sri"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

DO_SYNC=true
DO_UP=true

case "${1:-}" in
  --sync) DO_UP=false ;;
  --up)   DO_SYNC=false ;;
  --down)
    echo "==> Tearing down stacks on $REMOTE"
    ssh "$REMOTE" "
      cd $REMOTE_DIR
      COMPOSE_PROFILES='mcp-servers,caipe-ui,rbac,caipe-supervisor,dynamic-agents,rag,caipe-mongodb,web_ingestor,slack-bot,webex-bot,argocd,aws,backstage,confluence,github,jira,komodor,pagerduty,slack,splunk,webex,tracing,agentic-apps' \
        docker compose -f docker-compose.yaml -f docker-compose.tome-sri.yaml down --remove-orphans 2>/dev/null || true
      docker compose -f docker-compose.tome.yaml down --remove-orphans 2>/dev/null || true
    "
    exit 0
    ;;
esac

if $DO_SYNC; then
  echo "==> Shutting down kind cluster on $REMOTE (frees ports)"
  ssh "$REMOTE" "
    if command -v kind &>/dev/null; then
      for cluster in \$(kind get clusters 2>/dev/null); do
        echo \"  stopping kind cluster: \$cluster\"
        kind delete cluster --name \"\$cluster\" || true
      done
    fi
    pkill -f 'kubectl.*proxy\|kubectl.*port-forward' 2>/dev/null || true
  " || true

  echo "==> Creating $REMOTE_DIR on remote"
  ssh "$REMOTE" "mkdir -p $REMOTE_DIR"

  echo "==> Rsyncing $LOCAL_DIR -> $REMOTE:$REMOTE_DIR"
  rsync -az --delete \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='ui/.next' \
    --exclude='ui/node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.venv' \
    --exclude='volumes/' \
    --exclude='dist/' \
    --exclude='*.log' \
    --exclude='.env' \
    "$LOCAL_DIR/" "$REMOTE:$REMOTE_DIR/"

  echo "==> Checking .env"
  ssh "$REMOTE" "
    if [ ! -f $REMOTE_DIR/.env ]; then
      echo 'WARNING: no .env found — copy one manually to $REMOTE_DIR/.env'
      echo 'Hint: copy from /home/ubuntu/caipe-rbac/.env and patch hostnames for tome-sri.dev.outshift.io'
    else
      echo '  .env present'
    fi
  "
fi

if $DO_UP; then
  echo "==> Building localtag images on $REMOTE"
  # Deliberately NOT merging in docker-compose.tome.yaml here: it redefines
  # several of the same service keys as docker-compose.yaml (agentgateway,
  # agentgateway-config-bridge, ...) under different container_names for its
  # own standalone stack. Merging all three -f files makes Compose union
  # identical security_opt entries across files into duplicates, which some
  # Compose versions (e.g. v5.1.3) reject with "... security_opt items at 0
  # and 1 are equal". tome-agent/mycelium are built separately below via their
  # own standalone `up` invocation.
  ssh "$REMOTE" "
    cd $REMOTE_DIR
    DOCKER_BUILDKIT=1 IMAGE_TAG=localtag \
      docker compose \
        -f docker-compose.yaml \
        -f docker-compose.dev.yaml \
        --profile mcp-servers --profile caipe-ui --profile caipe-ui-prod \
        --profile dynamic-agents --profile rag --profile slack-bot \
        --profile webex-bot --profile rbac --profile agentic-apps \
      build --parallel 2>&1 | grep -vE 'level=warning|JIRA_EMAIL|JIRA_PROJECTS|GITHUB_ORG|SERVER_URL|ARGOCD|LANGFUSE'
  "

  # caipe-ui:localtag is built as caipe-ui-prod:localtag by dev.yaml; tag it so docker-compose.yaml finds it
  ssh "$REMOTE" "
    docker tag ghcr.io/cnoe-io/caipe-ui-prod:localtag ghcr.io/cnoe-io/caipe-ui:localtag 2>/dev/null || true
    # caipe-rag-ingestors is only built via --profile rag; build it explicitly if missing
    docker image inspect ghcr.io/cnoe-io/caipe-rag-ingestors:localtag >/dev/null 2>&1 || \
      DOCKER_BUILDKIT=1 IMAGE_TAG=localtag docker compose -f $REMOTE_DIR/docker-compose.dev.yaml \
        --profile rag build --parallel web_ingestor 2>&1 | tail -3
  "

  echo "==> Bringing up main stack on $REMOTE:$REMOTE_DIR"
  ssh "$REMOTE" "
    cd $REMOTE_DIR

    # Explicit service list + --no-deps avoids hanging on healthcheck-less deps (mirrors runme-no-deps.sh)
    # Uses caipe-ui-prod (prod-parity, NODE_ENV=production) like caipe-edge-testing.
    # caipe-ui-prod publishes the network alias `caipe-ui` so nginx + bots keep working.
    FILES='-f docker-compose.yaml -f docker-compose.dev.yaml -f docker-compose.tome-sri.yaml'
    PROFILES='mcp-servers,caipe-ui-prod,rbac,caipe-supervisor,dynamic-agents,rag,caipe-mongodb,web_ingestor,slack-bot,webex-bot,argocd,aws,backstage,confluence,github,jira,komodor,pagerduty,slack,splunk,webex,tracing,agentic-apps'
    SERVICES='keycloak-postgres openfga-postgres caipe-mongodb etcd milvus-minio rag-redis \
      keycloak openfga openfga-authz-bridge milvus-standalone \
      github-mcp-server mcp-argocd mcp-backstage mcp-confluence \
      mcp-jira mcp-komodor mcp-netutils mcp-pagerduty mcp-slack mcp-splunk mcp-webex \
      dynamic-agents rag-server agentgateway-config-bridge agentgateway \
      audit-service caipe-ui-prod web_ingestor slack-bot webex-bot caipe-nginx'

    # Dev hot-reload UI binds the same container_name/port; stop it before prod comes up.
    docker rm -f caipe-ui 2>/dev/null || true

    echo '--> Main stack (--no-deps)'
    IMAGE_TAG=localtag COMPOSE_PROFILES=\"\$PROFILES\" \
      docker compose \$FILES up -d --no-deps \$SERVICES \
      2>&1 | grep -vE 'level=warning|Pulling|layer|Waiting|Download|Extract|Pull complete|Pulled|Image|Started|Created'
  "

  echo "==> Bringing up tome-agent + mycelium (standalone stack, selective services)"
  # TOME_AGENT_BACKEND_URL must be set explicitly here: docker-compose.tome.yaml
  # defaults TTT_BACKEND_URL to http://host.docker.internal:33000/api/tome (the
  # macOS-local-dev value), which is unreachable on this remote box and leaves
  # tome-agent unable to sync/list Tome projects ("Connection refused" in its
  # logs, surfacing in the UI as missing Tome content). caipe-ui is reachable
  # by container name once bridged into the main stack network below.
  ssh "$REMOTE" "
    cd $REMOTE_DIR
    IMAGE_TAG=localtag TOME_AGENT_BACKEND_URL=http://caipe-ui:3000/api/tome \
      docker compose -f docker-compose.tome.yaml up -d --no-deps \
      tome-agent mycelium-db mycelium-backend \
      2>&1 | grep -vE 'level=warning|Pulling|layer|Waiting|Download|Extract|Pull complete|Pulled|Image|Started|Created'

    echo '--> Bridging tome-agent/mycelium into main stack network'
    MAIN_NET=\$(docker inspect caipe-ui --format '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}}{{end}}' | head -1)
    docker network connect --alias tome-agent-tome \"\$MAIN_NET\" tome-agent-tome 2>/dev/null || true
    docker network connect --alias mycelium-backend-tome \"\$MAIN_NET\" mycelium-backend-tome 2>/dev/null || true

    # tome-agent's initial project sync ran at startup above, before the network
    # connect just above existed, so it fails once with a DNS error. Restart
    # (not recreate, so the bridge/alias survives) to retry immediately instead
    # of waiting for the 5-minute background sync_loop.
    docker restart tome-agent-tome >/dev/null 2>&1 || true
  "

  # nginx resolves upstream hostnames at startup; restart after agentgateway/tome-agent are up
  echo "==> Restarting nginx"
  ssh "$REMOTE" "sleep 3; docker restart caipe-nginx >/dev/null 2>&1 || true"

  echo "==> Restarting caipe-ui-prod (pick up TOME_AGENT_URL/MYCELIUM_URL bridged hostnames)"
  ssh "$REMOTE" "cd $REMOTE_DIR && docker restart caipe-ui-prod >/dev/null 2>&1 || true"

  ssh "$REMOTE" "echo '--> Done. Container count:' \$(docker ps -q | wc -l)"
fi

echo "==> Finished. Access: https://tome-sri.dev.outshift.io"
