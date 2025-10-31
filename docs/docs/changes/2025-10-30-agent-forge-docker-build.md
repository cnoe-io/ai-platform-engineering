# Agent Forge Docker Build Integration

## Overview

The GitHub Action workflow has been configured to use a custom Dockerfile from `build/agent-forge/Dockerfile` instead of relying on a Dockerfile from the cloned community-plugins repository. This enables automated building and publishing of the Backstage Agent Forge plugin as a Docker image to GitHub Container Registry (ghcr.io).

## Why Use a Custom Dockerfile?

The custom Dockerfile provides several optimizations:

1. **ARM64 Compatibility** - Includes specific configurations for ARM64 architecture support
2. **Build Optimization** - Better layer caching with strategic COPY commands
3. **Memory Management** - Sets `NODE_OPTIONS="--max-old-space-size=4096"` for large builds
4. **Fallback Handling** - Includes retry logic for yarn install failures
5. **Workspace-Specific** - Targets the `workspaces/agent-forge` directory

## Dockerfile Analysis

The Dockerfile at `build/agent-forge/Dockerfile`:

```dockerfile
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
```

### Key Features:

- **Base Image**: `node:20-bookworm-slim` - lightweight Debian-based Node.js 20
- **System Dependencies**: Git, Python3, Make, G++ for native module compilation
- **Layer Caching**: Copies package files before source code for better caching
- **Memory Allocation**: 4GB max old space size for large builds
- **Network Timeout**: Extended timeout for slow connections
- **Architecture Fallback**: Automatically adjusts for current architecture if needed
- **Port**: Exposes port 3000 for the application

## How the Workflow Uses It

### Workflow Steps:

1. **Checkout Both Repositories**:
   ```yaml
   - name: Checkout current repository
     uses: actions/checkout@v4
     with:
       path: main-repo
       
   - name: Checkout community-plugins repository
     uses: actions/checkout@v4
     with:
       repository: cnoe-io/community-plugins
       ref: agent-forge-upstream-docker
       path: community-plugins
   ```

2. **Copy Custom Dockerfile**:
   ```yaml
   - name: Copy custom Dockerfile
     run: |
       cp main-repo/build/agent-forge/Dockerfile community-plugins/Dockerfile
       echo "Using custom Dockerfile from build/agent-forge/"
   ```

3. **Build with Custom Dockerfile**:
   ```yaml
   - name: Build and push Docker image
     uses: docker/build-push-action@v5
     with:
       context: community-plugins
       file: community-plugins/Dockerfile
       platforms: linux/amd64,linux/arm64
   ```

## Advantages of This Approach

### 1. **Version Control**
- Dockerfile is tracked in your repository
- Changes are versioned with your code
- Easy to review and audit

### 2. **Customization**
- Full control over build environment
- Can add custom dependencies
- Can optimize for specific architectures

### 3. **Consistency**
- Same Dockerfile used locally and in CI/CD
- Predictable build behavior
- Easy to troubleshoot

### 4. **Portability**
- Don't depend on upstream Dockerfile existence
- Can switch branches/repos without issues
- Independent of community-plugins structure

## Testing Locally

The local test script (`test-build-locally.sh`) also uses your custom Dockerfile:

```bash
# Run the local test
./.github/test-build-locally.sh
```

The script will:
1. Clone the community-plugins repository
2. Copy your custom Dockerfile
3. Build the project
4. Create the Docker image
5. Offer to run the container

## Modifying the Dockerfile

If you need to modify the Dockerfile:

1. **Edit the file**:
   ```bash
   nano build/agent-forge/Dockerfile
   ```

2. **Test locally**:
   ```bash
   ./.github/test-build-locally.sh
   ```

3. **Commit and push**:
   ```bash
   git add build/agent-forge/Dockerfile
   git commit -m "Update agent-forge Dockerfile"
   git push
   ```

4. **Workflow will use the updated version** automatically on next run

## Common Modifications

### Add Environment Variables

```dockerfile
# Add after ENV NODE_OPTIONS line
ENV BACKSTAGE_HOST=0.0.0.0
ENV BACKSTAGE_PORT=3000
```

### Add Additional Dependencies

```dockerfile
# Add to the apt-get install command
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*
```

### Change the Working Directory

```dockerfile
# Change the final WORKDIR if needed
WORKDIR /app/workspaces/your-workspace
```

### Multi-Stage Build

```dockerfile
# Add a build stage
FROM node:20-bookworm-slim AS builder
WORKDIR /app
# ... build steps ...

# Runtime stage
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
# ... runtime configuration ...
```

## Port Configuration

The Dockerfile exposes port **3000**, but you can customize this:

### In Dockerfile:
```dockerfile
EXPOSE 7007
```

### In Docker Run:
```bash
docker run -p 7007:3000 ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

### In Workflow (if needed):
You can also pass build arguments:
```yaml
- name: Build and push Docker image
  uses: docker/build-push-action@v5
  with:
    context: community-plugins
    file: community-plugins/Dockerfile
    build-args: |
      PORT=7007
```

## Troubleshooting

### Build Fails on ARM64

If builds fail on ARM64:

1. Check the yarn install fallback is working
2. Consider adding more memory: `NODE_OPTIONS="--max-old-space-size=8192"`
3. Test locally on ARM64 machine or use Docker buildx

### Build is Slow

To speed up builds:

1. Ensure layer caching is working (COPY package files first)
2. Use `.dockerignore` to exclude unnecessary files
3. Consider using a more powerful runner in GitHub Actions
4. Use the build cache: `cache-from: type=gha`

### Image is Too Large

To reduce image size:

1. Use multi-stage builds
2. Remove build dependencies in final stage
3. Use `.dockerignore` to exclude test files, docs, etc.
4. Clean yarn cache: `RUN yarn cache clean`

## Best Practices

1. **Keep it Simple**: Don't add unnecessary dependencies
2. **Use Multi-Stage**: Separate build and runtime stages
3. **Cache Layers**: Order commands from least to most frequently changing
4. **Security**: Use official base images and keep them updated
5. **Document**: Comment complex commands in the Dockerfile
6. **Test**: Always test changes locally before pushing

## Integration with CI/CD

The workflow automatically:
- ✅ Uses the latest version of your Dockerfile
- ✅ Builds for multiple architectures (amd64, arm64)
- ✅ Caches layers for faster subsequent builds
- ✅ Tags images appropriately
- ✅ Pushes to GitHub Container Registry

No additional configuration needed!

## Docker Image Details

**Registry:** GitHub Container Registry (ghcr.io)

**Image Name:** `ghcr.io/cnoe-io/backstage-plugin-agent-forge`

**Available Tags:**
- `latest` - Latest stable build
- `<branch>` - Branch-specific builds
- `<branch>-<sha>` - Commit-specific builds
- `<version>` - Semantic version tags

### Pull the Image

```bash
docker pull ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

### Run the Container

```bash
docker run -d \
  -p 7007:3000 \
  --name agent-forge-plugin \
  ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
```

## Files Created

### GitHub Action Workflow
- `.github/workflows/build-agent-forge-plugin.yml` - Main workflow
- `.github/workflows/README.md` - Workflow documentation
- `.github/WORKFLOW_SETUP.md` - Setup guide
- `.github/test-build-locally.sh` - Local testing script
- `.github/verify-setup.sh` - Setup verification script

## Next Steps

1. **Review** the Dockerfile to ensure it meets your needs
2. **Test** locally using the test script
3. **Commit** the workflow files
4. **Push** to GitHub to trigger the workflow
5. **Monitor** the build in the Actions tab

---

**Date Added**: October 30, 2025  
**Dockerfile Location**: `build/agent-forge/Dockerfile`  
**Workflow**: `.github/workflows/build-agent-forge-plugin.yml`  
**Related Documentation**: `.github/workflows/README.md`, `.github/WORKFLOW_SETUP.md`

