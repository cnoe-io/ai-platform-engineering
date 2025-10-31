FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies for both architectures
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy everything needed for yarn install
COPY . .

# Set yarn configuration for better ARM64 compatibility
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Install dependencies - yarn will handle the workspace setup
RUN yarn install --immutable --network-timeout 600000

EXPOSE 3000

# Run yarn start from workspace directory using shell
WORKDIR /app
CMD ["/bin/sh", "-c", "cd workspaces/agent-forge && yarn start"]