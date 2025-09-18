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

declare -A GLOBAL_SECRETS=(
    ["LLM_PROVIDER"]=""
    ["AZURE_OPENAI_API_KEY"]=""
    ["AZURE_OPENAI_API_VERSION"]=""
    ["AZURE_OPENAI_DEPLOYMENT"]=""
    ["AZURE_OPENAI_ENDPOINT"]=""
    ["AWS_ACCESS_KEY_ID"]=""
    ["AWS_SECRET_ACCESS_KEY"]=""
    ["AWS_REGION"]=""
    ["ENABLE_IAM_MCP"]=""
    ["ENABLE_KOMODOR"]=""
    ["KOMODOR_TOKEN"]=""
    ["KOMODOR_API_URL"]=""
    ["ENABLE_TRACING"]=""
    ["LANGFUSE_PUBLIC_KEY"]=""
    ["LANGFUSE_SECRET_KEY"]=""
    ["LANGFUSE_HOST"]=""
    ["PETSTORE_MCP_API_KEY"]=""
    ["PETSTORE_MCP_API_URL"]=""
    ["ENABLE_WEATHER_AGENT"]=""
    ["ENABLE_PETSTORE_AGENT"]=""
    ["MCP_MODE"]=""
    ["WEBEX_TOKEN"]=""
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
        elif [[ -v GLOBAL_SECRETS[$key] ]]; then
            GLOBAL_SECRETS[$key]="$value"
        fi
    fi
done < "$ENV_FILE"

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
echo "  - $BASE_PATH/global"
