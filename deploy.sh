#!/bin/bash

# Check for stop command
if [ "$1" = "stop" ]; then
    echo "Stopping all services..."
    docker compose -f docker-compose.yaml --profile a2a-p2p --profile a2a-over-slim down
    exit 0
fi

# Check for detached mode argument (default to detached)
DETACHED="yes"
if [ "$1" = "--no-detach" ] || [ "$1" = "-f" ]; then
    DETACHED="no"
fi

# Load environment variables from .env file
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Check transport mode (default to p2p)
TRANSPORT=${A2A_TRANSPORT:-p2p}

# Get currently running services
RUNNING_SERVICES=$(docker compose -f docker-compose.yaml ps --services 2>/dev/null || echo "")

# Build list of services that should be running
if [ "$TRANSPORT" = "slim" ]; then
    SHOULD_RUN="platform-engineer-slim slim-dataplane slim-control-plane"
else
    SHOULD_RUN="platform-engineer-p2p"
fi

if [ "$ENABLE_AGENT_FORGE" = "true" ]; then
    SHOULD_RUN="$SHOULD_RUN backstage-agent-forge"
fi

if [ "$ENABLE_GITHUB" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-github-slim"
    else
        SHOULD_RUN="$SHOULD_RUN agent-github-p2p"
    fi
fi

if [ "$ENABLE_WEATHER" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-weather-slim"
    else
        SHOULD_RUN="$SHOULD_RUN agent-weather-p2p"
    fi
fi

if [ "$ENABLE_BACKSTAGE" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-backstage-slim mcp-backstage"
    else
        SHOULD_RUN="$SHOULD_RUN agent-backstage-p2p mcp-backstage"
    fi
fi

if [ "$ENABLE_ARGOCD" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-argocd-slim mcp-argocd"
    else
        SHOULD_RUN="$SHOULD_RUN agent-argocd-p2p mcp-argocd"
    fi
fi

if [ "$ENABLE_CONFLUENCE" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-confluence-slim mcp-confluence"
    else
        SHOULD_RUN="$SHOULD_RUN agent-confluence-p2p mcp-confluence"
    fi
fi

if [ "$ENABLE_JIRA" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-jira-slim mcp-jira"
    else
        SHOULD_RUN="$SHOULD_RUN agent-jira-p2p mcp-jira"
    fi
fi

if [ "$ENABLE_KOMODOR" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-komodor-slim mcp-komodor"
    else
        SHOULD_RUN="$SHOULD_RUN agent-komodor-p2p mcp-komodor"
    fi
fi

if [ "$ENABLE_PAGERDUTY" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-pagerduty-slim mcp-pagerduty"
    else
        SHOULD_RUN="$SHOULD_RUN agent-pagerduty-p2p mcp-pagerduty"
    fi
fi

if [ "$ENABLE_SLACK" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-slack-slim mcp-slack"
    else
        SHOULD_RUN="$SHOULD_RUN agent-slack-p2p mcp-slack"
    fi
fi

if [ "$ENABLE_SPLUNK" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-splunk-slim mcp-splunk"
    else
        SHOULD_RUN="$SHOULD_RUN agent-splunk-p2p mcp-splunk"
    fi
fi

if [ "$ENABLE_WEBEX" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-webex-slim mcp-webex"
    else
        SHOULD_RUN="$SHOULD_RUN agent-webex-p2p mcp-webex"
    fi
fi

if [ "$ENABLE_AWS" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-aws-slim"
    else
        SHOULD_RUN="$SHOULD_RUN agent-aws-p2p"
    fi
fi

# Add Petstore agent if enabled
if [ "$ENABLE_PETSTORE" = "true" ]; then
    if [ "$TRANSPORT" = "slim" ]; then
        SHOULD_RUN="$SHOULD_RUN agent-petstore-slim"
    else
        SHOULD_RUN="$SHOULD_RUN agent-petstore-p2p"
    fi
fi

# Add RAG services if enabled
if [ "$ENABLE_RAG" = "true" ]; then
    SHOULD_RUN="$SHOULD_RUN rag_server agent_rag agent_ontology rag_webui neo4j neo4j-ontology rag-redis milvus-standalone etcd milvus-minio"
fi

if [ "$ENABLE_TRACING" = "true" ]; then
    SHOULD_RUN="$SHOULD_RUN langfuse-worker langfuse-web langfuse-clickhouse langfuse-minio langfuse-redis langfuse-postgres"
fi

# Find services to stop (running but not in should_run list)
TO_STOP=""
for service in $RUNNING_SERVICES; do
    if ! echo "$SHOULD_RUN" | grep -q "$service"; then
        TO_STOP="$TO_STOP $service"
    fi
done

# Stop unwanted services
if [ -n "$TO_STOP" ]; then
    echo "Stopping services no longer needed:$TO_STOP"
    docker compose -f docker-compose.yaml stop $TO_STOP
    docker compose -f docker-compose.yaml rm -f $TO_STOP
fi

echo "Deploying services with $TRANSPORT transport: $SHOULD_RUN"

# Deploy the selected services
if [ "$DETACHED" = "no" ]; then
    docker compose -f docker-compose.yaml up $SHOULD_RUN
else
    docker compose -f docker-compose.yaml up -d $SHOULD_RUN
fi