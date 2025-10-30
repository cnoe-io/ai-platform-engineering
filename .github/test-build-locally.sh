#!/bin/bash

# Local Build Test Script for Agent Forge Plugin
# This script mimics the GitHub Action workflow for local testing

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Agent Forge Plugin - Local Build Test                      ║${NC}"
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Configuration
REPO_URL="https://github.com/cnoe-io/community-plugins.git"
BRANCH="agent-forge-upstream-docker"
IMAGE_NAME="ghcr.io/cnoe-io/backstage-plugin-agent-forge"
BUILD_DIR="/tmp/community-plugins-build"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    if [ -d "$BUILD_DIR" ]; then
        rm -rf "$BUILD_DIR"
    fi
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Step 1: Clone the repository
echo -e "${GREEN}[Step 1/5]${NC} Cloning repository..."
echo -e "  Repository: ${YELLOW}$REPO_URL${NC}"
echo -e "  Branch: ${YELLOW}$BRANCH${NC}"

if [ -d "$BUILD_DIR" ]; then
    rm -rf "$BUILD_DIR"
fi

git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$BUILD_DIR"
cd "$BUILD_DIR"

echo -e "${GREEN}✓${NC} Repository cloned successfully"
echo ""

# Step 2: Setup Node.js environment
echo -e "${GREEN}[Step 2/5]${NC} Checking Node.js environment..."
NODE_VERSION=$(node --version 2>/dev/null || echo "not installed")
YARN_VERSION=$(yarn --version 2>/dev/null || echo "not installed")

echo -e "  Node.js: ${YELLOW}$NODE_VERSION${NC}"
echo -e "  Yarn: ${YELLOW}$YARN_VERSION${NC}"

if [ "$NODE_VERSION" = "not installed" ]; then
    echo -e "${RED}✗ Node.js is not installed. Please install Node.js 20 or higher.${NC}"
    exit 1
fi

if [ "$YARN_VERSION" = "not installed" ]; then
    echo -e "${YELLOW}⚠ Yarn is not installed. Installing via npm...${NC}"
    npm install -g yarn
fi

echo -e "${GREEN}✓${NC} Environment ready"
echo ""

# Step 3: Install dependencies
echo -e "${GREEN}[Step 3/5]${NC} Installing dependencies..."
echo -e "  Running: ${YELLOW}yarn install --frozen-lockfile${NC}"

yarn install --frozen-lockfile

echo -e "${GREEN}✓${NC} Dependencies installed"
echo ""

# Step 4: Build the project
echo -e "${GREEN}[Step 4/5]${NC} Building project..."
echo -e "  Running: ${YELLOW}yarn build:all${NC}"

# Check if build:all script exists
if grep -q '"build:all"' package.json; then
    yarn build:all
else
    echo -e "${YELLOW}⚠ 'build:all' script not found. Trying 'yarn build'...${NC}"
    yarn build
fi

echo -e "${GREEN}✓${NC} Build completed"
echo ""

# Step 5: Build Docker image
echo -e "${GREEN}[Step 5/5]${NC} Building Docker image..."
echo -e "  Image: ${YELLOW}$IMAGE_NAME:local-test${NC}"

# Check for custom Dockerfile in the original repo
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
CUSTOM_DOCKERFILE="$SCRIPT_DIR/../build/agent-forge/Dockerfile"

if [ -f "$CUSTOM_DOCKERFILE" ]; then
    echo -e "${GREEN}✓${NC} Using custom Dockerfile from: ${YELLOW}build/agent-forge/Dockerfile${NC}"
    cp "$CUSTOM_DOCKERFILE" "$BUILD_DIR/Dockerfile"
else
    echo -e "${YELLOW}⚠ Custom Dockerfile not found at $CUSTOM_DOCKERFILE${NC}"
    echo -e "${YELLOW}Looking for Dockerfile in cloned repository...${NC}"
    
    if [ ! -f "$BUILD_DIR/Dockerfile" ]; then
        # Search for Dockerfile
        DOCKERFILE_PATH=$(find "$BUILD_DIR" -name "Dockerfile" -type f | head -n 1)
        
        if [ -z "$DOCKERFILE_PATH" ]; then
            echo -e "${RED}✗ No Dockerfile found${NC}"
            exit 1
        else
            echo -e "${GREEN}✓${NC} Found Dockerfile at: ${YELLOW}$DOCKERFILE_PATH${NC}"
            cp "$DOCKERFILE_PATH" "$BUILD_DIR/Dockerfile"
        fi
    fi
fi

# Build the image
docker build -t "$IMAGE_NAME:local-test" "$BUILD_DIR"

echo -e "${GREEN}✓${NC} Docker image built successfully"
echo ""

# Summary
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Build Summary                                               ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}✓${NC} Repository cloned from ${YELLOW}$BRANCH${NC} branch"
echo -e "${GREEN}✓${NC} Dependencies installed"
echo -e "${GREEN}✓${NC} Project built successfully"
echo -e "${GREEN}✓${NC} Docker image created: ${YELLOW}$IMAGE_NAME:local-test${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Additional information
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo -e "1. ${GREEN}Test the Docker image:${NC}"
echo -e "   docker run -d -p 7007:7007 --name agent-forge-test $IMAGE_NAME:local-test"
echo ""
echo -e "2. ${GREEN}View logs:${NC}"
echo -e "   docker logs -f agent-forge-test"
echo ""
echo -e "3. ${GREEN}Stop and remove container:${NC}"
echo -e "   docker stop agent-forge-test && docker rm agent-forge-test"
echo ""
echo -e "4. ${GREEN}Push to registry (if authenticated):${NC}"
echo -e "   docker tag $IMAGE_NAME:local-test $IMAGE_NAME:latest"
echo -e "   docker push $IMAGE_NAME:latest"
echo ""
echo -e "5. ${GREEN}Inspect the image:${NC}"
echo -e "   docker images | grep agent-forge"
echo -e "   docker inspect $IMAGE_NAME:local-test"
echo ""

# Offer to run the container
read -p "Would you like to run the container now? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${GREEN}Starting container...${NC}"
    docker run -d -p 7007:7007 --name agent-forge-test "$IMAGE_NAME:local-test"
    echo ""
    echo -e "${GREEN}✓${NC} Container started successfully"
    echo -e "Access the application at: ${YELLOW}http://localhost:7007${NC}"
    echo -e "View logs with: ${YELLOW}docker logs -f agent-forge-test${NC}"
fi

echo ""
echo -e "${GREEN}Local build test completed successfully!${NC}"

