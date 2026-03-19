#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

BACKEND=${1:-redis}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}LangGraph Persistence & Fact Extraction Test${NC}"
echo -e "${BLUE}Backend: ${BACKEND}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to test Redis
test_redis() {
    echo -e "${GREEN}Testing Redis Backend${NC}"
    echo ""

    # Check container
    echo "1. Checking Redis container..."
    docker ps --filter "name=langgraph-redis" --format "{{.Names}}\t{{.Status}}"
    echo ""

    # Check connection
    echo "2. Testing Redis connection..."
    docker exec langgraph-redis redis-cli ping
    echo ""

    # Check data
    echo "3. Checking stored data..."
    docker exec langgraph-redis redis-cli DBSIZE
    echo ""

    echo "4. Sample checkpoint keys:"
    docker exec langgraph-redis redis-cli --scan --pattern "checkpoint:*" --count 5 | head -3
    echo ""

    echo "5. Sample store/facts keys:"
    docker exec langgraph-redis redis-cli --scan --pattern "store:*" --count 5 | head -3
    echo ""

    echo "6. Sample extracted fact:"
    FACT_KEY=$(docker exec langgraph-redis redis-cli --scan --pattern "store:*" --count 1 | head -1)
    if [ ! -z "$FACT_KEY" ]; then
        docker exec langgraph-redis redis-cli JSON.GET "$FACT_KEY" | python3 -m json.tool 2>/dev/null | head -20
    fi
}

# Function to test PostgreSQL
test_postgres() {
    echo -e "${GREEN}Testing PostgreSQL Backend${NC}"
    echo ""

    # Check container
    echo "1. Checking PostgreSQL container..."
    docker ps --filter "name=langgraph-postgres" --format "{{.Names}}\t{{.Status}}"
    echo ""

    # Check connection
    echo "2. Testing PostgreSQL connection..."
    docker exec langgraph-postgres pg_isready -U langgraph
    echo ""

    # Check tables
    echo "3. Checking tables..."
    docker exec langgraph-postgres psql -U langgraph -d langgraph -c "\dt"
    echo ""

    # Check checkpoint data
    echo "4. Checking checkpoint data..."
    docker exec langgraph-postgres psql -U langgraph -d langgraph -c "SELECT COUNT(*) as checkpoint_count FROM checkpoints;" 2>/dev/null || echo "Table not created yet"
    echo ""

    # Check store data
    echo "5. Checking store/facts data..."
    docker exec langgraph-postgres psql -U langgraph -d langgraph -c "SELECT COUNT(*) as store_items FROM store;" 2>/dev/null || echo "Table not created yet"
    echo ""

    echo "6. Sample extracted facts:"
    docker exec langgraph-postgres psql -U langgraph -d langgraph -c "SELECT prefix, key, value->>'content' as content FROM store WHERE prefix LIKE 'memories.%' LIMIT 3;" 2>/dev/null || echo "No facts yet"
}

# Function to test MongoDB
test_mongodb() {
    echo -e "${GREEN}Testing MongoDB Backend${NC}"
    echo ""

    # Check container
    echo "1. Checking MongoDB container..."
    docker ps --filter "name=langgraph-mongodb" --format "{{.Names}}\t{{.Status}}"
    echo ""

    # Check connection
    echo "2. Testing MongoDB connection..."
    docker exec langgraph-mongodb mongosh --quiet --eval "db.adminCommand('ping')"
    echo ""

    # Check databases
    echo "3. Checking databases..."
    docker exec langgraph-mongodb mongosh --quiet --eval "show dbs"
    echo ""

    # Check collections
    echo "4. Checking collections..."
    docker exec langgraph-mongodb mongosh --quiet langgraph --eval "db.getCollectionNames()"
    echo ""

    # Check checkpoint data
    echo "5. Checking checkpoint data..."
    docker exec langgraph-mongodb mongosh --quiet langgraph --eval "db.checkpoints.countDocuments()" 2>/dev/null || echo "0"
    echo ""

    # Check store data
    echo "6. Checking store/facts data..."
    docker exec langgraph-mongodb mongosh --quiet langgraph --eval "db.store.countDocuments()" 2>/dev/null || echo "0"
    echo ""

    echo "7. Sample extracted facts:"
    docker exec langgraph-mongodb mongosh --quiet langgraph --eval "db.store.find({'namespace.0': 'memories'}).limit(3).pretty()" 2>/dev/null || echo "No facts yet"
}

# Function to test Mixed backend (MongoDB checkpointer + Redis store)
test_mixed() {
    echo -e "${GREEN}Testing Mixed Backend: MongoDB (checkpointer) + Redis (store)${NC}"
    echo ""

    # --- MongoDB Checkpointer ---
    echo -e "${YELLOW}── MongoDB Checkpointer ──${NC}"
    echo ""

    MONGO_CONTAINER=${MONGO_CONTAINER:-caipe-mongodb-dev}
    MONGO_URI=${MONGO_URI:-"mongodb://admin:changeme@localhost:27017/caipe?authSource=admin"}
    MONGO_DB=${MONGO_DB:-caipe}
    MONGO_CP_COLL=${MONGO_CP_COLL:-conversation_checkpoints}
    MONGO_CW_COLL=${MONGO_CW_COLL:-conversation_checkpoint_writes}

    echo "1. Checking MongoDB container..."
    docker ps --filter "name=${MONGO_CONTAINER}" --format "{{.Names}}\t{{.Status}}"
    echo ""

    echo "2. Testing MongoDB connection..."
    docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "db.adminCommand('ping')"
    echo ""

    echo "3. Collections in ${MONGO_DB}:"
    docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "db.getCollectionNames()"
    echo ""

    echo "4. Checkpoint counts:"
    CP_COUNT=$(docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "db.${MONGO_CP_COLL}.countDocuments()")
    CW_COUNT=$(docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "db.${MONGO_CW_COLL}.countDocuments()")
    echo "   ${MONGO_CP_COLL}: ${CP_COUNT}"
    echo "   ${MONGO_CW_COLL}: ${CW_COUNT}"
    echo ""

    echo "5. Unique threads:"
    docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "
        const threads = db.${MONGO_CP_COLL}.distinct('thread_id');
        print('   Count: ' + threads.length);
        threads.slice(0, 5).forEach(t => print('   - ' + t));
        if (threads.length > 5) print('   ... and ' + (threads.length - 5) + ' more');
    "
    echo ""

    echo "6. Latest checkpoint:"
    docker exec "${MONGO_CONTAINER}" mongosh "${MONGO_URI}" --quiet --eval "
        const cp = db.${MONGO_CP_COLL}.findOne({}, {thread_id:1, checkpoint_id:1, _id:0, type:1});
        if (cp) printjson(cp); else print('   No checkpoints yet');
    "
    echo ""

    # --- Redis Store ---
    echo -e "${YELLOW}── Redis Store (fact extraction) ──${NC}"
    echo ""

    REDIS_CONTAINER=${REDIS_CONTAINER:-langgraph-redis}

    echo "7. Checking Redis container..."
    docker ps --filter "name=${REDIS_CONTAINER}" --format "{{.Names}}\t{{.Status}}"
    echo ""

    echo "8. Testing Redis connection..."
    docker exec "${REDIS_CONTAINER}" redis-cli ping
    echo ""

    echo "9. Redis key count:"
    docker exec "${REDIS_CONTAINER}" redis-cli DBSIZE
    echo ""

    echo "10. Store/fact keys:"
    STORE_COUNT=$(docker exec "${REDIS_CONTAINER}" redis-cli --scan --pattern "store:*" 2>/dev/null | wc -l | tr -d ' ')
    echo "   store:* keys: ${STORE_COUNT}"
    echo ""

    echo "11. Sample extracted facts:"
    for FACT_KEY in $(docker exec "${REDIS_CONTAINER}" redis-cli --scan --pattern "store:*" 2>/dev/null | head -3); do
        echo "   --- ${FACT_KEY} ---"
        docker exec "${REDIS_CONTAINER}" redis-cli JSON.GET "${FACT_KEY}" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    prefix = d.get('prefix','').replace('\\\\\\\\.','.').replace('\\\\.','.').replace('_',' ')
    content = d.get('value',{}).get('content',{}).get('content','N/A')
    print(f'   User: {prefix}')
    print(f'   Fact: {content[:120]}')
except: pass
" 2>/dev/null
        echo ""
    done
}

# Check supervisor logs
check_supervisor_logs() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Supervisor Configuration${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    echo "Environment Variables:"
    docker exec caipe-supervisor env | grep -E "LANGGRAPH_(CHECKPOINT|STORE)" | sort
    echo ""

    echo "Recent logs (persistence & fact extraction):"
    docker logs caipe-supervisor 2>&1 | grep -E "(LangGraph|fact extraction|MemoryStoreManager)" | tail -10
}

# Main execution
case $BACKEND in
    redis)
        test_redis
        ;;
    postgres)
        test_postgres
        ;;
    mongodb)
        test_mongodb
        ;;
    mixed)
        test_mixed
        ;;
    *)
        echo -e "${RED}Invalid backend: $BACKEND${NC}"
        echo "Usage: $0 [redis|postgres|mongodb|mixed]"
        exit 1
        ;;
esac

check_supervisor_logs

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Test Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${YELLOW}To switch backends:${NC}"
echo "1. Edit .env file and uncomment the desired backend config"
echo "2. Stop containers: docker compose -f docker-compose.dev.yaml down"
echo "3. Start with the right profile:"
echo "   - Redis:      COMPOSE_PROFILES=\"...,langgraph-redis\" docker compose -f docker-compose.dev.yaml up -d"
echo "   - PostgreSQL: COMPOSE_PROFILES=\"...,langgraph-postgres\" docker compose -f docker-compose.dev.yaml up -d"
echo "   - MongoDB:    COMPOSE_PROFILES=\"...,langgraph-mongodb\" docker compose -f docker-compose.dev.yaml up -d"
echo ""
