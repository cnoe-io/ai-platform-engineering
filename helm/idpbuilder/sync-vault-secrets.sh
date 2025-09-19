#!/bin/bash

set -e

ENV_FILE="$HOME/ai-platform-engineering/.env"
BASE_PATH="secret/ai-platform-engineering"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[INFO]${NC} $1"; }

# Get Vault access
VAULT_POD=$(kubectl get pods -n vault -l app.kubernetes.io/name=vault -o jsonpath='{.items[0].metadata.name}')
VAULT_TOKEN=$(kubectl get secret -n vault vault-root-token -o jsonpath='{.data.token}' | base64 -d)

# Define secret mappings
declare -A ARGOCD_SECRETS=(
    ["ARGOCD_TOKEN"]=""
    ["ARGOCD_API_URL"]=""
    ["ARGOCD_VERIFY_SSL"]=""
)

declare -A BACKSTAGE_SECRETS=(
    ["BACKSTAGE_API_TOKEN"]=""
    ["BACKSTAGE_URL"]=""
)

declare -A GITHUB_SECRETS=(
    ["GITHUB_PERSONAL_ACCESS_TOKEN"]=""
)

declare -A JIRA_SECRETS=(
    ["ATLASSIAN_TOKEN"]=""
    ["ATLASSIAN_API_URL"]=""
    ["ATLASSIAN_EMAIL"]=""
    ["ATLASSIAN_VERIFY_SSL"]=""
    ["CONFLUENCE_API_URL"]=""
)

declare -A PAGERDUTY_SECRETS=(
    ["PAGERDUTY_API_URL"]=""
    ["PAGERDUTY_API_KEY"]=""
)

declare -A SLACK_SECRETS=(
    ["SLACK_BOT_TOKEN"]=""
    ["SLACK_TOKEN"]=""
    ["SLACK_APP_TOKEN"]=""
    ["SLACK_SIGNING_SECRET"]=""
    ["SLACK_CLIENT_SECRET"]=""
    ["SLACK_TEAM_ID"]=""
)

declare -A KB_RAG_SECRETS=(
    ["MILVUS_SECRET"]=""
)

declare -A AWS_SECRETS=(
    ["AWS_ACCESS_KEY_ID"]=""
    ["AWS_SECRET_ACCESS_KEY"]=""
    ["AWS_DEFAULT_REGION"]=""
    ["AWS_REGION"]=""
)

declare -A SPLUNK_SECRETS=(
    ["SPLUNK_API_TOKEN"]=""
    ["SPLUNK_URL"]=""
)

declare -A WEBEX_SECRETS=(
    ["WEBEX_BOT_TOKEN"]=""
    ["WEBEX_WEBHOOK_SECRET"]=""
    ["WEBEX_TOKEN"]=""
)

declare -A KOMODOR_SECRETS=(
    ["KOMODOR_API_KEY"]=""
    ["KOMODOR_API_URL"]=""
    ["KOMODOR_TOKEN"]=""
)

declare -A GLOBAL_SECRETS=(
    ["LLM_PROVIDER"]=""
    ["AZURE_OPENAI_API_KEY"]=""
    ["AZURE_OPENAI_API_VERSION"]=""
    ["AZURE_OPENAI_DEPLOYMENT"]=""
    ["AZURE_OPENAI_ENDPOINT"]=""
)

# Parse .env file
while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    
    if [[ $line =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        value=$(echo "$value" | sed 's/^["'\'']\|["'\'']$//g')
        
        # Assign to appropriate secret group
        if [[ -v ARGOCD_SECRETS[$key] ]]; then
            ARGOCD_SECRETS[$key]="$value"
        elif [[ -v BACKSTAGE_SECRETS[$key] ]]; then
            BACKSTAGE_SECRETS[$key]="$value"
        elif [[ -v GITHUB_SECRETS[$key] ]]; then
            GITHUB_SECRETS[$key]="$value"
        elif [[ -v JIRA_SECRETS[$key] ]]; then
            JIRA_SECRETS[$key]="$value"
        elif [[ -v PAGERDUTY_SECRETS[$key] ]]; then
            PAGERDUTY_SECRETS[$key]="$value"
        elif [[ -v SLACK_SECRETS[$key] ]]; then
            SLACK_SECRETS[$key]="$value"
        elif [[ -v KB_RAG_SECRETS[$key] ]]; then
            KB_RAG_SECRETS[$key]="$value"
        elif [[ -v AWS_SECRETS[$key] ]]; then
            AWS_SECRETS[$key]="$value"
        elif [[ -v SPLUNK_SECRETS[$key] ]]; then
            SPLUNK_SECRETS[$key]="$value"
        elif [[ -v WEBEX_SECRETS[$key] ]]; then
            WEBEX_SECRETS[$key]="$value"
        elif [[ -v KOMODOR_SECRETS[$key] ]]; then
            KOMODOR_SECRETS[$key]="$value"
        elif [[ -v GLOBAL_SECRETS[$key] ]]; then
            GLOBAL_SECRETS[$key]="$value"
        fi
    fi
done < "$ENV_FILE"

# Try to create ArgoCD API token
log "🔑 Attempting to create ArgoCD API token..."
ARGOCD_PASSWORD=$(kubectl get secret -n argocd argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d 2>/dev/null || echo "")

if [[ -n "$ARGOCD_PASSWORD" ]]; then
    ARGOCD_TOKEN=$(kubectl exec -n argocd deployment/argocd-server -- sh -c "
        argocd login localhost:8080 --username admin --password '$ARGOCD_PASSWORD' --plaintext >/dev/null 2>&1
        argocd account generate-token --account admin --id vault-sync-$(date +%s) 2>/dev/null || echo ''
    " 2>/dev/null || echo "")
    
    if [[ -n "$ARGOCD_TOKEN" ]]; then
        ARGOCD_SECRETS["ARGOCD_TOKEN"]="$ARGOCD_TOKEN"
        ARGOCD_SECRETS["ARGOCD_API_URL"]="https://argocd-server.argocd.svc.cluster.local/api/v1/"
        ARGOCD_SECRETS["ARGOCD_VERIFY_SSL"]="false"
        log "✅ ArgoCD API token created and added"
    else
        log "⚠️  Could not create ArgoCD API token"
    fi
else
    log "⚠️  Could not retrieve ArgoCD admin password"
fi

# Function to upload secrets to Vault
upload_secrets() {
    local path="$1"
    local -n secrets=$2
    local cmd="vault kv put $BASE_PATH/$path"
    
    for key in "${!secrets[@]}"; do
        if [[ -n "${secrets[$key]}" ]]; then
            cmd="$cmd $key=\"${secrets[$key]}\""
        fi
    done
    
    kubectl exec -n vault "$VAULT_POD" -- sh -c "
        export VAULT_ADDR='http://127.0.0.1:8200'
        export VAULT_TOKEN='$VAULT_TOKEN'
        $cmd
        echo '✅ Uploaded to $path'
    "
}

log "🚀 Organizing secrets by service..."

# Upload to each path
upload_secrets "argocd-secret" ARGOCD_SECRETS
upload_secrets "backstage-secret" BACKSTAGE_SECRETS  
upload_secrets "github-secret" GITHUB_SECRETS
upload_secrets "jira-secret" JIRA_SECRETS
upload_secrets "pagerduty-secret" PAGERDUTY_SECRETS
upload_secrets "slack-secret" SLACK_SECRETS
upload_secrets "kb-rag-secret" KB_RAG_SECRETS
upload_secrets "aws-secret" AWS_SECRETS
upload_secrets "splunk-secret" SPLUNK_SECRETS
upload_secrets "webex-secret" WEBEX_SECRETS
upload_secrets "komodor-secret" KOMODOR_SECRETS
upload_secrets "global" GLOBAL_SECRETS

log "🎉 All secrets organized and uploaded!"
log "📋 Paths created:"
echo "  - $BASE_PATH/argocd-secret"
echo "  - $BASE_PATH/backstage-secret"
echo "  - $BASE_PATH/github-secret"
echo "  - $BASE_PATH/jira-secret"
echo "  - $BASE_PATH/pagerduty-secret"
echo "  - $BASE_PATH/slack-secret"
echo "  - $BASE_PATH/kb-rag-secret"
echo "  - $BASE_PATH/aws-secret"
echo "  - $BASE_PATH/splunk-secret"
echo "  - $BASE_PATH/webex-secret"
echo "  - $BASE_PATH/komodor-secret"
echo "  - $BASE_PATH/global"
