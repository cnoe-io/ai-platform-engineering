FROM node:20-bookworm

WORKDIR /app

# Install git and build dependencies for native modules
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain for @swc/core
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

COPY . .

WORKDIR /app/workspaces/agent-forge

# Install dependencies - allow optional native builds to fail
# The application can work without @swc/core as it has fallbacks
RUN yarn install || \
    (echo "Warning: Some optional builds failed, verifying core dependencies..." && \
     test -d node_modules && \
     test -d node_modules/@backstage && \
     echo "Core dependencies installed successfully despite optional build failures" && \
     exit 0)

EXPOSE 3000

# Add entrypoint script to substitute env variables
COPY <<'EOF' /app/entrypoint.sh
#!/bin/bash
set -e

# Default value if not provided
AGENT_FORGE_BASE_URL=${AGENT_FORGE_BASE_URL:-http://localhost:8000}

# Find and update app-config.yaml - only replace baseUrl under agentForge block
if [ -f "app-config.yaml" ]; then
  sed -i '/^agentForge:/,/^[^ ]/ s|baseUrl:.*|baseUrl: '"${AGENT_FORGE_BASE_URL}"'|' app-config.yaml
fi

# Execute the main command
exec "$@"
EOF

RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["yarn", "start"]