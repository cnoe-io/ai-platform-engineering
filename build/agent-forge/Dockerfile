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

# Install dependencies
RUN yarn install

EXPOSE 3000

CMD ["yarn", "start"]