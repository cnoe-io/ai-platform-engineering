#!/usr/bin/env bash
#
# Rebuild the standalone Tome agent on the tome-sri host and restore its
# connection to the UI stack. Docker Compose recreates the container during a
# build, which removes network connections added outside that Compose project.
#
# Run from the checked-out source directory on the tome-sri host.

set -euo pipefail

repo_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

agent_container="${TOME_SRI_AGENT_CONTAINER:-tome-agent-tome}"
ui_container="${TOME_SRI_UI_CONTAINER:-caipe-ui-prod}"
ui_network="${TOME_SRI_UI_NETWORK:-tome-sri_default}"

docker compose \
  -f docker-compose.tome.yaml \
  --env-file .env \
  up -d --build tome-agent

docker network inspect "${ui_network}" >/dev/null
if ! docker network inspect "${ui_network}" \
  --format '{{range .Containers}}{{println .Name}}{{end}}' \
  | grep -Fxq "${agent_container}"; then
  docker network connect \
    --alias tome-agent \
    --alias tome-agent-tome \
    "${ui_network}" \
    "${agent_container}"
fi

verify_agent_from_ui() {
  docker exec "${ui_container}" node -e '
const url = `${process.env.TOME_AGENT_URL.replace(/\/$/, "")}/healthz`;
fetch(url)
  .then(async (response) => {
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status}: ${body}`);
    console.log(body);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
'
}

for _attempt in $(seq 1 30); do
  if verify_agent_from_ui >/dev/null 2>&1; then
    verify_agent_from_ui
    exit 0
  fi
  sleep 1
done

verify_agent_from_ui
