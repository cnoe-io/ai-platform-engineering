---
sidebar_label: Specification
sidebar_position: 2
---

# Feature Specification: Helm Chart Documentation Generator

**Feature Branch**: `092-helm-docs-generator`
**Created**: 2026-03-17
**Status**: Draft
**Input**: User description: "Create a script to auto-generate Helm chart Docusaurus pages from chart source, enrich source READMEs with usage examples and values guidance, add auto-generated markers, and use latest published version"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Regenerate All Chart Docs (Priority: P1)

A developer updates a Helm chart's `values.yaml` or `Chart.yaml` and runs a single `make` target to regenerate both the source `README.md` in `charts/` and the corresponding Docusaurus page in `docs/docs/installation/helm-charts/`. The generated docs include usage examples, a guide on reading the values table, chart metadata, and an auto-generated marker.

**Why this priority**: This is the core capability. Without it, chart docs drift out of sync with the actual chart configuration, requiring manual maintenance across 13+ charts.

**Independent Test**: Can be fully tested by modifying a chart's `values.yaml`, running `make docs-helm-charts`, and verifying both the source README and Docusaurus page are updated with correct content.

**Acceptance Scenarios**:

1. **Given** a chart with `Chart.yaml` and `values.yaml` exists under `charts/`, **When** a developer runs `make docs-helm-charts`, **Then** the source `README.md` in that chart directory is regenerated with chart metadata, usage examples, values table, and an auto-generated marker.
2. **Given** the source README was regenerated, **When** the same `make` target completes, **Then** a Docusaurus-compatible page is generated in `docs/docs/installation/helm-charts/<parent>/<chart>.md` with correct frontmatter (`id`, `sidebar_label`).
3. **Given** the chart version in `Chart.yaml` is `0.2.38-rc.helm.2`, **When** docs are generated, **Then** the displayed version uses the latest published (non-RC) version derived from `appVersion` (e.g., `0.2.38`) — no RC, pre-release, or build metadata suffixes appear anywhere in the generated output.

---

### User Story 2 - ArtifactHub-Style Values Documentation (Priority: P1)

A user reading the chart documentation can understand how to use the chart without external references. Each generated doc includes a quick-start install command, how to override values, and a guide explaining what each column in the values table means.

**Why this priority**: Equal to P1 because the primary value of generated docs is usability. Without usage examples and guidance, the docs are just raw tables with no context.

**Independent Test**: Can be verified by reading any generated chart doc and confirming it contains install examples, values override examples, and a "How to read this table" section.

**Acceptance Scenarios**:

1. **Given** a generated chart doc, **When** a user reads it, **Then** it contains a "Quick Start" section with `helm install` and `helm upgrade` commands using the chart's actual name.
2. **Given** a generated chart doc, **When** a user reads it, **Then** it contains a "Customizing Values" section showing how to override values via `--set` flags and custom `values.yaml` files.
3. **Given** a generated chart doc with a values table, **When** a user reads it, **Then** a "Reading the Values Table" section explains the Key, Type, Default, and Description columns.

---

### User Story 3 - Auto-Generated Marker (Priority: P2)

Generated files include a prominent marker indicating they are auto-generated, warning users not to edit them manually, and pointing to the source of truth and the regeneration command.

**Why this priority**: Prevents wasted effort from manual edits that will be overwritten. Important but secondary to the generation itself.

**Independent Test**: Can be verified by opening any generated file and confirming the marker is present at the top.

**Acceptance Scenarios**:

1. **Given** any generated README or Docusaurus page, **When** a user opens it, **Then** a comment or visible notice at the top states it is auto-generated, references the source files (`Chart.yaml`, `values.yaml`), and names the regeneration command (`make docs-helm-charts`).
2. **Given** a developer edits a generated file manually, **When** `make docs-helm-charts` is run again, **Then** the manual edit is overwritten and the marker is restored.

---

### User Story 4 - Chart Hierarchy and Dependencies (Priority: P2)

Generated docs for parent charts (ai-platform-engineering, rag-stack) include a dependency table listing all subcharts, their versions, and enable conditions, so users understand the chart's composition.

**Why this priority**: Helps users understand what gets deployed and how to enable/disable components. Important for parent charts that orchestrate many subcharts.

**Independent Test**: Can be verified by reading the generated parent chart doc and confirming the dependencies table matches `Chart.yaml`.

**Acceptance Scenarios**:

1. **Given** a parent chart with dependencies in `Chart.yaml`, **When** docs are generated, **Then** the output includes a "Dependencies" section listing each subchart name, published version (RC suffixes stripped), and condition/tags.

---

### User Story 5 - Fetch Latest Published Version from Registry (Priority: P1)

During development, local `Chart.yaml` files always contain RC versions (e.g., `0.2.38-rc.helm.2`). The make target queries the OCI chart registry to determine the latest published (stable) version and uses that in all generated documentation. This ensures docs always reference a version users can actually install.

**Why this priority**: Without registry lookup, the docs would either show RC versions (confusing for users) or require manual version overrides. Automating this is essential for accurate install commands.

**Independent Test**: Can be tested by running `make docs-helm-charts` on a branch with RC chart versions and confirming the output references the latest stable version from the registry.

**Acceptance Scenarios**:

1. **Given** the local `Chart.yaml` has version `0.2.38-rc.helm.2` and the OCI registry has `0.2.38` as the latest stable tag, **When** docs are generated, **Then** all version references in the output show `0.2.38`.
2. **Given** the OCI registry is unreachable (offline, CI without network), **When** docs are generated, **Then** the generator falls back to `appVersion` from the local `Chart.yaml` and emits a warning.
3. **Given** a developer wants to override the version without registry access, **When** they run `make docs-helm-charts CHART_VERSION=0.2.37`, **Then** the specified version is used instead of querying the registry.

---

### User Story 6 - Docs Build Validates Generated Output (Priority: P1)

After running `make docs-helm-charts`, the `make docs-build` target serves as the integration test. It verifies that all generated Docusaurus pages compile without MDX errors, all internal links resolve, and the sidebar references are valid. No generated file should contain RC version strings.

**Why this priority**: The Docusaurus build is the definitive gate. If `docs-build` fails after `docs-helm-charts`, the generated output is broken. This makes the build the acceptance test for every other user story.

**Independent Test**: Run `make docs-helm-charts && make docs-build` and verify exit code 0 with no warnings about broken links or compilation errors. Then grep all generated files for RC version patterns.

**Acceptance Scenarios**:

1. **Given** `make docs-helm-charts` has just completed, **When** `make docs-build` is run, **Then** it exits with code 0, zero broken links, and zero MDX compilation errors.
2. **Given** all chart docs have been generated, **When** a grep for `-rc` patterns is run against all generated files, **Then** zero matches are found.
3. **Given** a new subchart was added and `make docs-helm-charts` was run, **When** `make docs-build` is run, **Then** the sidebar includes the new chart and all links resolve.

---

### Edge Cases

- What happens when a chart has no `values.yaml`? Generator should produce a doc with metadata but skip the values table.
- What happens when `Chart.yaml` has no `description` field? Generator should fall back to "A Helm chart for Kubernetes".
- What happens when a new subchart is added to `charts/`? Running the make target should automatically discover and generate docs for it.
- What happens when a subchart is removed? The orphaned Docusaurus page should remain (manual cleanup) but a warning should be emitted.
- What happens when `Chart.yaml` has no `appVersion` field? Generator should fall back to the `version` field with RC suffixes stripped (e.g., `0.2.38-rc.helm.2` becomes `0.2.38`).
- What happens when a dependency version is a semver range or external repository version (e.g., `2025.07.1` for neo4j)? Generator should display the version as-is since it is already a published version.
- What happens when the OCI registry returns only RC tags (no stable release yet)? Generator should strip the RC suffix from the highest version and warn.
- What happens in CI environments without network access? The `CHART_VERSION` override or local `appVersion` fallback ensures docs can still be generated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The generator MUST read `Chart.yaml` from each chart directory to extract name, description, version, appVersion, type, sources, and dependencies.
- **FR-002**: The generator MUST read the values table from the existing `helm-docs`-generated README or produce one from `values.yaml`.
- **FR-003**: The generator MUST write an enriched `README.md` to the source chart directory (`charts/<parent>/charts/<subchart>/README.md` or `charts/<parent>/README.md`).
- **FR-004**: The generator MUST write a Docusaurus-compatible `.md` file to `docs/docs/installation/helm-charts/<parent-group>/<chart-name>.md` (or `index.md` for parent charts).
- **FR-005**: Docusaurus pages MUST include frontmatter with `id: <chart-name>-chart` and `sidebar_label: <chart-name>`.
- **FR-006**: All generated files MUST include an auto-generated marker at the top referencing the source files and the regeneration command.
- **FR-007**: Generated docs MUST display the latest published version, not pre-release/RC versions. The version resolution order is: (1) `CHART_VERSION` environment variable if set, (2) latest stable tag from the OCI chart registry, (3) `appVersion` from local `Chart.yaml` as fallback. This applies to all version references: chart header, badge images, install commands, dependency tables, and any other rendered version string.
- **FR-008**: Generated docs MUST include a "Quick Start" section with `helm install` and `helm upgrade` commands using the published version (not RC).
- **FR-009**: Generated docs MUST include a "Customizing Values" section showing `--set` and `-f values.yaml` examples.
- **FR-010**: Generated docs MUST include a "Reading the Values Table" section explaining column semantics.
- **FR-011**: Parent chart docs MUST include a "Dependencies" section derived from `Chart.yaml` dependencies. Dependency versions MUST use the published version (strip `-rc.*` suffixes).
- **FR-012**: The generator MUST auto-discover all charts under `charts/ai-platform-engineering/charts/` and `charts/rag-stack/charts/`, plus the two parent charts.
- **FR-013**: The generator MUST escape MDX-incompatible syntax (angle brackets in URLs, HTML-like tags) in the Docusaurus output.
- **FR-014**: A `make docs-helm-charts` target MUST invoke the generator.
- **FR-015**: The source README MUST NOT include Docusaurus-specific frontmatter (that belongs only in the Docusaurus page).
- **FR-016**: The `make docs-helm-charts` target MUST query the OCI chart registry to fetch the latest published (non-RC, non-pre-release) chart version for use in generated docs.
- **FR-017**: The make target MUST accept an optional `CHART_VERSION` variable to override registry lookup (e.g., `make docs-helm-charts CHART_VERSION=0.2.37`).
- **FR-018**: When the registry is unreachable, the generator MUST fall back to the local `appVersion` from `Chart.yaml` and emit a warning to stderr indicating the fallback was used.
- **FR-019**: Running `make docs-helm-charts` followed by `make docs-build` MUST pass as an end-to-end validation that all generated pages are Docusaurus-compatible with zero broken links and zero MDX errors.
- **FR-020**: The generator MUST NOT produce any output containing RC version patterns (matching `-rc`, `-alpha`, `-beta`, or `-pre` suffixes). This MUST be verifiable by grepping all generated files.

### Key Entities

- **Chart**: A Helm chart defined by `Chart.yaml` and `values.yaml`. Has a name, description, version, appVersion, type, optional dependencies, and optional source URLs.
- **Parent Chart**: A chart with subchart dependencies (ai-platform-engineering, rag-stack). Rendered as `index.md` in its Docusaurus subdirectory.
- **Subchart**: A chart nested under a parent in `charts/<parent>/charts/<subchart>/`. Rendered as `<subchart>.md` in the parent's Docusaurus subdirectory.
- **Values Table**: A markdown table listing configurable Helm values with Key, Type, Default, and Description columns.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `make docs-helm-charts` regenerates all chart docs (source READMEs and Docusaurus pages) in under 10 seconds.
- **SC-002**: After running the generator, `make docs-build` (Docusaurus build) passes with zero broken links, zero MDX errors, and zero RC version strings in any generated file.
- **SC-003**: 100% of charts under `charts/` have both a source README and a corresponding Docusaurus page after running the generator.
- **SC-004**: Every generated file contains the auto-generated marker. No generated file displays RC/pre-release version numbers.
- **SC-005**: A new developer can install any chart by copying commands directly from the generated documentation without consulting external sources.
