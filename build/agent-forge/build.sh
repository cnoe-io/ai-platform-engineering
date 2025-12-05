#!/bin/bash
set -e

REPO_URL="https://github.com/cnoe-io/community-plugins.git"
BRANCH="agent-forge-upstream-docker"
SOURCE_DIR="source"

if [ -d "$SOURCE_DIR" ]; then
    echo "Source exists, pulling latest..."
    cd "$SOURCE_DIR" && git pull && cd ..
else
    echo "Cloning source..."
    git clone "$REPO_URL" --branch "$BRANCH" --depth 1 "$SOURCE_DIR"
fi

echo "Copying Dockerfile..."
cp Dockerfile "$SOURCE_DIR/"
echo "Ready to build!"
