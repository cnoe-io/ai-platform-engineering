# Makefile

# Variables
DOCKER_IMAGE = ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
DOCKER_PLATFORMS_MULTI = linux/amd64,linux/arm64
DOCKER_PLATFORMS_AMD64 = linux/amd64

# Targets
.PHONY: build build-multi publish publish-multi

# Build AMD64 only (faster, more reliable)
build:
	docker buildx build --platform $(DOCKER_PLATFORMS_AMD64) -t $(DOCKER_IMAGE) .

# Build multi-arch (experimental, may fail on ARM64)
build-multi:
	docker buildx build --platform $(DOCKER_PLATFORMS_MULTI) -t $(DOCKER_IMAGE) .

# Publish AMD64 only
publish:
	docker buildx build --platform $(DOCKER_PLATFORMS_AMD64) -t $(DOCKER_IMAGE) --push .

# Publish multi-arch
publish-multi:
	docker buildx build --platform $(DOCKER_PLATFORMS_MULTI) -t $(DOCKER_IMAGE) --push .

build-push: build publish
	@echo "Build and push completed successfully."