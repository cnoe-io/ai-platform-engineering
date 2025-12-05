FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ git curl bash
COPY . .
WORKDIR /app/workspaces/agent-forge
RUN yarn install || (test -d node_modules && test -d node_modules/@backstage && exit 0)

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git bash
COPY --from=builder /app/.yarn /app/.yarn
COPY --from=builder /app/.yarnrc.yml /app/
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/yarn.lock /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/workspaces/agent-forge /app/workspaces/agent-forge
RUN find /app -name "*.md" -delete && \
    find /app -name "*.map" -delete && \
    rm -rf /app/node_modules/.cache /app/.yarn/cache
WORKDIR /app/workspaces/agent-forge

COPY <<'EOF' /app/entrypoint.sh
#!/bin/bash
set -e
AGENT_FORGE_BASE_URL=${AGENT_FORGE_BASE_URL:-http://localhost:8000}
if [ -f "app-config.yaml" ]; then
  sed -i '/^agentForge:/,/^[^ ]/ s|baseUrl:.*|baseUrl: '"${AGENT_FORGE_BASE_URL}"'|' app-config.yaml
fi
exec "$@"
EOF

RUN chmod +x /app/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["yarn", "start"]
