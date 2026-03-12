#!/bin/bash

# Backend switcher for LangGraph persistence
# Usage: ./switch_backend.sh [redis|postgres|mongodb]

BACKEND=${1:-redis}
ENV_FILE="/Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering-langgraph-redis-persistence/.env"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Switching to: ${GREEN}${BACKEND}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

case $BACKEND in
    redis)
        PROFILE="langgraph-redis"
        TYPE_VALUE="redis"
        URL_VAR="LANGGRAPH_CHECKPOINT_REDIS_URL=redis://langgraph-redis:6379"
        STORE_VAR="LANGGRAPH_STORE_REDIS_URL=redis://langgraph-redis:6379"
        ;;
    postgres)
        PROFILE="langgraph-postgres"
        TYPE_VALUE="postgres"
        URL_VAR="LANGGRAPH_CHECKPOINT_POSTGRES_DSN=postgresql://langgraph:langgraph@langgraph-postgres:5432/langgraph"
        STORE_VAR="LANGGRAPH_STORE_POSTGRES_DSN=postgresql://langgraph:langgraph@langgraph-postgres:5432/langgraph"
        ;;
    mongodb)
        PROFILE="langgraph-mongodb"
        TYPE_VALUE="mongodb"
        URL_VAR="LANGGRAPH_CHECKPOINT_MONGODB_URI=mongodb://langgraph-mongodb:27017"
        STORE_VAR="LANGGRAPH_STORE_MONGODB_URI=mongodb://langgraph-mongodb:27017"
        ;;
    *)
        echo -e "${RED}Invalid backend: $BACKEND${NC}"
        echo "Usage: $0 [redis|postgres|mongodb]"
        exit 1
        ;;
esac

# Stop current containers
echo "1. Stopping current containers..."
cd /Users/sraradhy/cisco/eti/sre/cnoe/ai-platform-engineering-langgraph-redis-persistence
docker compose -f docker-compose.dev.yaml down
echo ""

# Update .env file
echo "2. Updating .env to use ${BACKEND}..."
sed -i.bak "s/^LANGGRAPH_CHECKPOINT_TYPE=.*/LANGGRAPH_CHECKPOINT_TYPE=${TYPE_VALUE}/" $ENV_FILE
sed -i.bak "s/^LANGGRAPH_STORE_TYPE=.*/LANGGRAPH_STORE_TYPE=${TYPE_VALUE}/" $ENV_FILE
echo "   LANGGRAPH_CHECKPOINT_TYPE=${TYPE_VALUE}"
echo "   LANGGRAPH_STORE_TYPE=${TYPE_VALUE}"
echo ""

# Start with new backend
echo "3. Starting containers with ${BACKEND} profile..."
IMAGE_TAG=0.2.38 COMPOSE_PROFILES="slack-bot,argocd,aws,github,pagerduty,jira,netutils,caipe-ui-mongodb,rag,${PROFILE}" \
    docker compose -f docker-compose.dev.yaml up -d

echo ""
echo -e "${GREEN}✅ Switched to ${BACKEND}!${NC}"
echo ""
echo "Waiting for containers to be ready (15 seconds)..."
sleep 15
echo ""

# Test the backend
echo "4. Testing ${BACKEND} backend..."
./skills/persistence/test_persistence_all_backends.sh $BACKEND

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Backend switch complete!${NC}"
echo -e "${BLUE}========================================${NC}"
