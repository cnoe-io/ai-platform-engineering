# Feature Specification: Docker Build Cache Optimization

**Feature Branch**: `prebuild/collapse-rbac-kb-prs`  
**Created**: 2026-05-28  
**Status**: Draft  
**Input**: User description: "Scope and specify Docker build optimizations for CAIPE UI and CAIPE supervisor: add Dockerfile-specific ignore files, move UI version metadata generation after the UI build, and split supervisor dependency installation from source copy. Do not implement."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rebuild UI Without Reinstalling Or Recompiling Unchanged Inputs (Priority: P1)

As a CAIPE developer iterating on UI container builds, I want changes to image metadata or unrelated repository files to avoid invalidating expensive UI build work, so local and PR prebuilds finish faster.

**Why this priority**: UI builds are part of common local and prebuild workflows. Avoiding avoidable cache invalidation gives immediate feedback-loop improvements without changing runtime behavior.

**Independent Test**: Can be tested by building the UI image twice with only version metadata changed and confirming the expensive dependency and application build steps are reused where their inputs did not change.

**Acceptance Scenarios**:

1. **Given** the UI application source and dependency files are unchanged, **When** only image version metadata changes between builds, **Then** dependency installation and application compilation are not forced to rerun by that metadata change.
2. **Given** non-UI repository files change, **When** the UI image is rebuilt, **Then** those unrelated files do not enter the UI build context and do not invalidate UI build layers.
3. **Given** the UI image starts successfully, **When** a user requests version information from the built image, **Then** the image reports the metadata for the build that produced it.

---

### User Story 2 - Preserve Supervisor Dependency Cache Across Source-Only Changes (Priority: P1)

As a CAIPE developer changing supervisor or agent source code, I want third-party dependency installation to remain cached when dependency definitions are unchanged, so supervisor image rebuilds do not repeatedly reinstall the full Python environment.

**Why this priority**: The supervisor image contains a large dependency environment. Copying all source before dependency installation makes source-only edits more expensive than necessary.

**Independent Test**: Can be tested by building the supervisor image, making a source-only change that does not alter dependency definitions, and confirming the third-party dependency installation step is reused.

**Acceptance Scenarios**:

1. **Given** dependency definition files are unchanged, **When** supervisor source files change, **Then** the third-party dependency installation phase remains eligible for cache reuse.
2. **Given** dependency definition files change, **When** the supervisor image is rebuilt, **Then** the dependency installation phase reruns and produces an environment consistent with the committed dependency definitions.
3. **Given** source files change after dependencies are installed, **When** the final supervisor image is produced, **Then** the image contains the current source and a runtime environment consistent with the current project.

---

### User Story 3 - Keep Build Contexts Minimal But Complete (Priority: P2)

As a maintainer reviewing build changes, I want each image to receive only the files it needs, while preserving required runtime fallbacks, so build performance improves without hidden missing-file regressions.

**Why this priority**: Smaller contexts improve build performance and reduce accidental cache invalidation, but overly aggressive exclusions can break runtime behavior in ways that are harder to diagnose than build failures.

**Independent Test**: Can be tested by inspecting build context behavior through successful clean builds and smoke-checking the relevant Compose service definitions.

**Acceptance Scenarios**:

1. **Given** the UI image is built, **When** the build context is prepared, **Then** it includes UI source, UI configuration, UI public assets except generated version metadata, package manifests, and the runtime entrypoint, and excludes unrelated backend, docs, and local artifact files.
2. **Given** the supervisor image is built, **When** the build context is prepared, **Then** it includes dependency definitions, supervisor and agent runtime source, utility modules, and chart-provided runtime data required by prompt config and built-in skill fallback behavior.
3. **Given** local caches, virtual environments, test outputs, UI build outputs, or Git metadata exist in the workspace, **When** either optimized image is built, **Then** those local artifacts do not enter the image build context.

### Edge Cases

- Generated UI version metadata must not be copied from the host workspace, because stale host metadata could hide the actual image build metadata.
- UI runtime behavior must remain unchanged for both development and production-parity Compose services.
- Supervisor runtime fallback paths for prompt configuration and built-in skills must remain available in the image where the application expects them.
- Dependency installation must rerun when dependency definitions or lock files change.
- Source-only changes must still be reflected in the final supervisor image even when third-party dependency layers are reused.
- Build context exclusions must not remove files required by existing image entrypoints or Compose volume mounts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST define a UI-specific image build context policy that excludes unrelated repository content from UI image builds.
- **FR-002**: The UI-specific context policy MUST include all files required to install UI dependencies, build the UI application, serve public assets, and start the UI container.
- **FR-003**: The UI-specific context policy MUST exclude host-generated UI version metadata so the image always generates its own metadata during the build.
- **FR-004**: The UI image build MUST generate final version metadata after application compilation so version-only metadata changes do not invalidate the application compilation phase.
- **FR-005**: The final UI image MUST still expose accurate build version, commit, and date metadata for the image that was produced.
- **FR-006**: The system MUST define a supervisor-specific image build context policy that excludes UI assets, local build artifacts, caches, virtual environments, test reports, and other files not required by the supervisor image.
- **FR-007**: The supervisor-specific context policy MUST preserve supervisor runtime source, agent runtime source needed by supervisor mode, shared utilities, dependency definitions, and chart-provided runtime data required by prompt configuration and built-in skill fallback behavior.
- **FR-008**: The supervisor image build MUST install third-party dependencies before copying frequently changing source files whenever dependency definitions are unchanged.
- **FR-009**: The supervisor image build MUST perform a final project synchronization after source files are copied so the runtime environment matches the current source tree.
- **FR-010**: The optimized builds MUST preserve existing image entrypoints, exposed ports, runtime environment expectations, and Compose service behavior.
- **FR-011**: The optimized builds MUST fail during image build if a required input is accidentally excluded from an image context.
- **FR-012**: The change MUST include validation evidence showing clean image builds and repeated builds for the affected images.

### Key Entities

- **UI Image Build Context**: The set of files available to the UI image build. It should include UI build inputs and exclude unrelated repository files and local artifacts.
- **Supervisor Image Build Context**: The set of files available to the supervisor image build. It should include supervisor runtime inputs and exclude UI-specific assets and local artifacts.
- **Version Metadata**: Build-specific information such as image tag, commit, and build date that is served by the UI image but should not force application recompilation.
- **Dependency Definition**: Project files that declare and lock third-party dependencies. Changes to these files should invalidate dependency installation; source-only changes should not.
- **Runtime Fallback Data**: Repository data loaded by the running supervisor when explicit environment configuration is absent, including prompt configuration and built-in skill content.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A repeated UI image build with only version metadata changed reuses the dependency installation phase and does not rerun application compilation because of the metadata change.
- **SC-002**: A repeated supervisor image build after a source-only change reuses the third-party dependency installation phase.
- **SC-003**: Clean UI and supervisor image builds complete successfully from the optimized contexts.
- **SC-004**: UI image version information matches the metadata provided for the current image build.
- **SC-005**: Existing Compose configuration for `caipe-ui`, `caipe-ui-prod`, and `caipe-supervisor` remains valid after the build optimizations.
- **SC-006**: Local artifacts such as virtual environments, dependency directories, test outputs, Git metadata, and UI build outputs are excluded from the relevant optimized build contexts.
- **SC-007**: No base image, runtime entrypoint, exposed port, service name, or Compose profile behavior changes are introduced by this feature.
