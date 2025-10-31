FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies for both architectures
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY workspaces/agent-forge/package.json ./workspaces/agent-forge/

# Set yarn configuration for better ARM64 compatibility
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Install dependencies with ARM64 optimizations
RUN yarn install --frozen-lockfile --network-timeout 600000 || \
    (yarn config set supportedArchitectures.cpu "current" && \
     yarn install --network-timeout 600000)

# Copy the rest of the application
COPY . .

WORKDIR /app/workspaces/agent-forge

EXPOSE 3000

CMD ["yarn", "start"]