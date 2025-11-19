#!/bin/bash

# Usage:
#   ./deploy.sh              - Deploy based on .env settings (detached mode)
#   ./deploy.sh --no-detach  - Deploy in foreground mode
#   ./deploy.sh stop         - Stop all services

if [ "$1" = "stop" ]; then
    echo "Stopping all services..."
    ALL_PROFILES=$(grep -A1 "profiles:" docker-compose.yaml | grep -v "profiles:" | grep -v "^--$" | tr -d ' -' | sort -u | tr '\n' ',' | sed 's/,$//')
    if [ -n "$ALL_PROFILES" ]; then
        PROFILE_FLAGS=$(echo "$ALL_PROFILES" | sed 's/,/ --profile /g' | sed 's/^/--profile /')
        docker compose $PROFILE_FLAGS down --remove-orphans -v
    else
        docker compose down --remove-orphans -v
    fi
    # Cleanup any remaining containers from this project
    REMAINING=$(docker ps -aq --filter "label=com.docker.compose.project=ai-platform-engineering")
    [ -n "$REMAINING" ] && docker rm -f $REMAINING
    exit 0
fi

if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

PROFILES=""
USE_SLIM=false
[ "${A2A_TRANSPORT:-p2p}" = "slim" ] && PROFILES="slim" && USE_SLIM=true
[ "$ENABLE_AWS" = "true" ] && PROFILES="$PROFILES,aws"
[ "$ENABLE_PETSTORE" = "true" ] && PROFILES="$PROFILES,petstore"
[ "$ENABLE_GITHUB" = "true" ] && PROFILES="$PROFILES,github"
[ "$ENABLE_WEATHER" = "true" ] && PROFILES="$PROFILES,weather"
[ "$ENABLE_BACKSTAGE" = "true" ] && PROFILES="$PROFILES,backstage"
[ "$ENABLE_ARGOCD" = "true" ] && PROFILES="$PROFILES,argocd"
[ "$ENABLE_CONFLUENCE" = "true" ] && PROFILES="$PROFILES,confluence"
[ "$ENABLE_JIRA" = "true" ] && PROFILES="$PROFILES,jira"
[ "$ENABLE_KOMODOR" = "true" ] && PROFILES="$PROFILES,komodor"
[ "$ENABLE_PAGERDUTY" = "true" ] && PROFILES="$PROFILES,pagerduty"
[ "$ENABLE_SLACK" = "true" ] && PROFILES="$PROFILES,slack"
[ "$ENABLE_SPLUNK" = "true" ] && PROFILES="$PROFILES,splunk"
[ "$ENABLE_WEBEX" = "true" ] && PROFILES="$PROFILES,webex"
[ "$ENABLE_AGENT_FORGE" = "true" ] && PROFILES="$PROFILES,agentforge"
[ "$ENABLE_RAG" = "true" ] && PROFILES="$PROFILES,rag"
[ "$ENABLE_GRAPH_RAG" = "true" ] && PROFILES="$PROFILES,rag"
[ "$ENABLE_TRACING" = "true" ] && PROFILES="$PROFILES,tracing"

PROFILES=$(echo "$PROFILES" | sed 's/^,//')

# Deploy SLIM first if needed
if [ "$USE_SLIM" = "true" ]; then
    echo "Starting SLIM infrastructure..."
    COMPOSE_PROFILES=slim docker compose up -d slim-dataplane slim-control-plane
    echo "Waiting for SLIM to be ready..."
    sleep 5
fi

# Deploy other services (exclude platform-engineer)
OTHER_PROFILES=$(echo "$PROFILES" | sed 's/slim,\?//')
if [ -n "$OTHER_PROFILES" ]; then
    echo "Starting supporting services with profiles: $OTHER_PROFILES"
    COMPOSE_PROFILES="$OTHER_PROFILES" docker compose up -d --scale platform-engineer=0
    echo "Waiting for services to be ready..."
    sleep 3
fi

# Deploy platform-engineer last
echo "Starting platform-engineer..."
if [ "$1" = "--no-detach" ] || [ "$1" = "-f" ]; then
    COMPOSE_PROFILES="$PROFILES" docker compose up platform-engineer
else
    COMPOSE_PROFILES="$PROFILES" docker compose up -d platform-engineer
fi
