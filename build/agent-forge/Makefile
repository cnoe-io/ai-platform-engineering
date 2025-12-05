DOCKER_IMAGE = ghcr.io/cnoe-io/backstage-plugin-agent-forge:latest
DOCKER_PLATFORMS_MULTI = linux/amd64,linux/arm64
DOCKER_PLATFORMS_AMD64 = linux/amd64
SOURCE_DIR = source

.PHONY: build build-multi publish publish-multi clean setup

setup:
	@./build.sh

build: setup
	docker buildx build --platform $(DOCKER_PLATFORMS_AMD64) -t $(DOCKER_IMAGE) $(SOURCE_DIR)

build-multi: setup
	docker buildx build --platform $(DOCKER_PLATFORMS_MULTI) -t $(DOCKER_IMAGE) $(SOURCE_DIR)

publish: setup
	docker buildx build --platform $(DOCKER_PLATFORMS_AMD64) -t $(DOCKER_IMAGE) --push $(SOURCE_DIR)

publish-multi: setup
	docker buildx build --platform $(DOCKER_PLATFORMS_MULTI) -t $(DOCKER_IMAGE) --push $(SOURCE_DIR)

clean:
	rm -rf $(SOURCE_DIR)
