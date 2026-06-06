#!/usr/bin/env bash
# scripts/debug-container.sh
#
# Get an interactive shell (and debug tooling) inside a running container at
# runtime — including distroless / shell-less images — WITHOUT baking a shell
# into the production image.
#
# Why not just add a shell to the image?
#   Most of our service images are built on cgr.dev/chainguard/wolfi-base, which
#   already ships /usr/bin/sh + busybox, so `docker exec <svc> sh` already works.
#   A few third-party images (e.g. openfga/openfga) are genuinely distroless by
#   design; permanently adding a shell to them would enlarge the attack surface
#   and contradict our container-hardening standards. This script instead attaches
#   an EPHEMERAL debug environment, leaving the running image untouched.
#
# Resolution order (first that works wins):
#   1. docker exec        — if the container already has a shell (our images).
#   2. docker debug       — Docker Desktop's ephemeral debug toolbox (works on
#                           distroless; nothing is persisted to the image).
#   3. netshoot sidecar   — a throwaway container sharing the target's PID + network
#                           namespaces, giving a full shell + network/debug tools.
#
# Usage:
#   scripts/debug-container.sh <container> [command...]
#
# Examples:
#   scripts/debug-container.sh rag-server            # interactive shell
#   scripts/debug-container.sh openfga               # distroless -> docker debug / netshoot
#   scripts/debug-container.sh caipe-ui-prod 'ls -la /app'
#
# Env:
#   DEBUG_METHOD=exec|debug|netshoot   Force a specific method (skip auto-detect).
#   NETSHOOT_IMAGE=...                 Override the sidecar image (default nicolaka/netshoot).

set -euo pipefail

NETSHOOT_IMAGE="${NETSHOOT_IMAGE:-nicolaka/netshoot}"

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

[ $# -ge 1 ] || usage 1
case "$1" in
  -h | --help) usage 0 ;;
esac

CONTAINER="$1"
shift || true

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "error: no such container: $CONTAINER" >&2
  echo "running containers:" >&2
  docker ps --format '  {{.Names}}\t{{.Status}}' >&2
  exit 1
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
  echo "error: container '$CONTAINER' is not running" >&2
  exit 1
fi

container_has_shell() {
  docker exec "$CONTAINER" /bin/sh -c 'exit 0' >/dev/null 2>&1 ||
    docker exec "$CONTAINER" sh -c 'exit 0' >/dev/null 2>&1
}

run_exec() {
  if [ $# -gt 0 ]; then
    exec docker exec "$CONTAINER" sh -c "$*"
  fi
  exec docker exec -it "$CONTAINER" sh
}

run_docker_debug() {
  docker debug --help >/dev/null 2>&1 || return 1
  echo ">> attaching ephemeral 'docker debug' toolbox to '$CONTAINER' (image is not modified)" >&2
  exec docker debug "$CONTAINER"
}

run_netshoot() {
  echo ">> launching throwaway '$NETSHOOT_IMAGE' sidecar sharing '$CONTAINER' namespaces" >&2
  echo "   (target processes visible via 'ps aux'; same network as the target)" >&2
  exec docker run --rm -it \
    --name "debug-${CONTAINER}-$$" \
    --pid="container:${CONTAINER}" \
    --network="container:${CONTAINER}" \
    --cap-add SYS_PTRACE \
    "$NETSHOOT_IMAGE"
}

METHOD="${DEBUG_METHOD:-auto}"
case "$METHOD" in
  exec) run_exec "$@" ;;
  debug) run_docker_debug || { echo "error: docker debug unavailable" >&2; exit 1; } ;;
  netshoot) run_netshoot ;;
  auto)
    if container_has_shell; then
      run_exec "$@"
    else
      echo ">> '$CONTAINER' has no shell (distroless); falling back to ephemeral debug" >&2
      run_docker_debug || run_netshoot
    fi
    ;;
  *)
    echo "error: invalid DEBUG_METHOD='$METHOD' (want exec|debug|netshoot|auto)" >&2
    exit 1
    ;;
esac
