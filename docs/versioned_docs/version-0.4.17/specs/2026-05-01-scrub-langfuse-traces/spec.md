# Feature Specification: Scrub Skill & Workflow Content From Langfuse Traces

**Feature Branch**: `2026-05-01-scrub-langfuse-traces`
**Created**: 2026-05-01
**Status**: Draft
**Input**: User description: "Scrub skill and workflow content from Langfuse OTel traces and cap per-attribute span size to prevent 413 errors and skill/workflow content leakage"

## Summary

The supervisor and dynamic-agents emit OpenTelemetry spans through the Traceloop instrumentors, which by default attach full prompt text, tool input/output, and graph state to every span. As a result, every trace shipped to Langfuse contained:

- The entire body of every available skill (one full `SKILL.md` per skill, embedded in every LLM call's system prompt).
- The full bodies of any ancillary skill files read via tools.
- Multi-paragraph operator-authored workflow prompts from workflow-definition tools.
- Rendered prompt content carried in graph state channels (`skills_metadata`, `tasks`, `todos`).

This caused two compounding problems:

1. **Privacy / compliance**: Skill bodies and operator workflow prompts (which often contain sensitive operational detail) were shipped to Langfuse on every step of every run.
2. **Lost observability via `413 Request Entity Too Large`**: Single spans reached 5–20 MB. Langfuse's ingress has a default 1 MiB body limit, so OTLP batches were silently rejected. Operators saw no traces at all, and the supervisor came under memory pressure from the OTLP exporter queue buffering oversized payloads.

The blunt workaround (`TRACELOOP_TRACE_CONTENT=false`) would disable all prompt and tool I/O capture, defeating the purpose of having Langfuse in the first place.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Skill content is removed from traces before export (Priority: P1)

As a platform operator, I need traces shipped to Langfuse to never contain the full body of skill prompts, ancillary skill files, or rendered skill metadata, so that sensitive skill content stays inside the cluster and is not exposed to the observability backend.

**Why this priority**: This is the core privacy/compliance ask. Without it, every Langfuse trace is a data-leakage incident.

**Independent Test**: Run the supervisor against a real LLM call that loads multiple skills, then inspect the corresponding Langfuse trace. Skill section markers (e.g. `## Skills System`) must appear with a redaction placeholder in place of their content; surrounding chat content (user messages, assistant reasoning, normal tool I/O) must be preserved verbatim.

**Acceptance Scenarios**:

1. **Given** a system prompt that embeds the full skill block between known section markers, **When** the span is exported, **Then** the content between the markers is replaced with a redaction placeholder and the markers themselves are preserved so trace structure remains readable.
2. **Given** a tool span whose input or output is the body of an ancillary skill file, **When** the span is exported, **Then** the entire input/output payload is replaced with a redaction placeholder.
3. **Given** a graph state channel attribute carrying parsed `skills_metadata`, **When** the span is exported, **Then** the `skills_metadata` field is replaced with a redaction placeholder while sibling fields in the same JSON object are left untouched.

---

### User Story 2 - Operator workflow content is removed from traces before export (Priority: P1)

As a platform operator authoring self-service workflows, I need the multi-paragraph workflow prompt content I write to never appear in Langfuse traces, so that internal runbooks and operational detail are not exposed to the observability backend.

**Why this priority**: Workflow prompts are functionally equivalent to skills as a leakage vector and were the second-largest contributor to oversized spans.

**Independent Test**: Trigger a workflow-definition tool call and a self-service task invocation, then inspect the corresponding Langfuse trace. The workflow tool spans must show no operator prompt text; the surrounding span structure, latency, and tool name must be preserved.

**Acceptance Scenarios**:

1. **Given** a system prompt containing a workflow-definition section between known markers, **When** the span is exported, **Then** the section body is replaced with a redaction placeholder.
2. **Given** a tool span for a workflow-definition or self-service task tool, **When** the span is exported, **Then** the entire tool input and output are wholesale-redacted.
3. **Given** a state channel attribute carrying rendered `tasks` or `todos` prompt content, **When** the span is exported, **Then** those fields are replaced with a redaction placeholder while sibling fields are left untouched.

---

### User Story 3 - Trace export survives Langfuse's ingress body limit (Priority: P1)

As a platform operator, I need OTLP trace batches to fit under Langfuse's ingress body size limit so that traces actually arrive and are visible in the UI, instead of being silently rejected with `413 Request Entity Too Large`.

**Why this priority**: Without this, even fully scrubbed traces still get dropped when other large attributes (tool definition catalogs, multi-turn message history, raw model response bodies) exceed the limit. Lost traces mean lost observability.

**Independent Test**: Configure a per-attribute byte cap, run a real workload that produces large attributes on keys outside the scrub list, and confirm in Langfuse that the corresponding spans are present, with oversized string attributes replaced by a truncation marker that records both the cap and the original size.

**Acceptance Scenarios**:

1. **Given** a string span attribute larger than the configured cap, **When** the span is exported, **Then** the attribute value is truncated to the cap and replaced with a marker that records the original byte length.
2. **Given** a span attribute that has already been replaced with a redaction placeholder, **When** the cap is applied, **Then** the placeholder is left intact (the cap never re-mangles a redaction marker).
3. **Given** a numeric or boolean span attribute, **When** the cap is applied, **Then** the attribute passes through unchanged.
4. **Given** the cap is set to a disabled sentinel value, **When** spans are exported, **Then** no truncation is applied and only the redaction stage runs.

---

### User Story 4 - Scrubbing is active in every deploy unit before the first request (Priority: P1)

As a platform operator, I need the scrubber to be installed in both the supervisor and the dynamic-agents service, and to be active before the first user request is served, so that there is no startup window during which unscrubbed traces leak.

**Why this priority**: Dynamic-agents is a separate deploy unit; if the scrubber is only installed in the supervisor, half of the production traces still leak. Lazy installation on first trace creates a race window.

**Independent Test**: Start each service from a cold container and confirm via the startup log that the scrubber is installed with its placeholder and cap configuration logged before the service accepts traffic.

**Acceptance Scenarios**:

1. **Given** the supervisor service starts, **When** startup completes, **Then** a structured log line confirms the scrubber is installed, naming the placeholder string and per-attribute byte cap in effect.
2. **Given** the dynamic-agents service starts, **When** startup completes, **Then** the same confirmation log line is emitted.
3. **Given** the source-of-truth scrubber and the vendored copy used by dynamic-agents, **When** continuous integration runs, **Then** the build fails if the two copies have drifted.

---

### User Story 5 - Operators can tune or disable scrubbing without a code change (Priority: P2)

As a platform operator triaging an incident or running a one-off debug session, I need to disable scrubbing, change the placeholder string, or tighten/loosen the per-attribute cap via configuration, so I do not need to ship a new container image to investigate.

**Why this priority**: Operability and incident response. Lower than P1 because the safe defaults already cover the production use case.

**Independent Test**: Override each configuration knob through the deployment's environment variables, restart the service, and confirm via the startup log and a sample trace that the new setting is in effect.

**Acceptance Scenarios**:

1. **Given** scrubbing is disabled via configuration, **When** the service starts, **Then** spans are exported with their original content and the cap is also bypassed.
2. **Given** the placeholder string is overridden, **When** a span is scrubbed, **Then** the redacted content uses the overridden placeholder.
3. **Given** the per-attribute byte cap is changed, **When** a span larger than the new cap is exported, **Then** the truncation marker reflects the new cap.

### Edge Cases

- A span ends before the scrubber processes it (OpenTelemetry locks attribute mutations once a span is ended): mutations must still be applied so that the exporter sees the scrubbed values.
- Multiple span processors are registered: the scrubber must run before any synchronous exporter, regardless of registration order, so that the exporter never sees the unscrubbed payload.
- A skill or workflow section marker appears nested inside another attribute (e.g. inside an embedded JSON string): the scrubber must not corrupt valid JSON in surrounding attributes.
- An attribute is exactly at the cap boundary: it must pass through without a misleading truncation marker.
- The same trace contains a mix of scrubbable and non-scrubbable large attributes: scrubbing applies surgically; the cap then sweeps anything still oversized.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST remove the body of well-known skill and workflow sections from prompt-text span attributes, replacing it with a configurable redaction placeholder while preserving the surrounding markers and any unrelated chat content.
- **FR-002**: The system MUST replace the value of well-known sensitive fields (skill metadata, task content, todo content) inside JSON-structured span attributes with the redaction placeholder, while leaving unrelated sibling fields intact.
- **FR-003**: The system MUST wholesale-redact the input and output payloads of tool spans whose tool name corresponds to workflow definition or self-service task invocation.
- **FR-004**: The system MUST cap the byte length of every string span attribute at a configurable limit and replace any oversized value with a marker that records both the cap and the original length.
- **FR-005**: The system MUST apply the per-attribute cap after the redaction stage, so that redaction placeholders are never themselves truncated.
- **FR-006**: The system MUST leave non-string span attributes (numeric, boolean) unchanged regardless of size.
- **FR-007**: The system MUST run before any exporter sees the span, even when the exporter and the scrubber are registered in either order.
- **FR-008**: The system MUST successfully mutate span attributes after the span has been ended, so that scrubbing is never silently skipped.
- **FR-009**: The system MUST be installed and confirmed-active in both the supervisor and the dynamic-agents deploy units before either service accepts traffic.
- **FR-010**: The system MUST emit a structured startup log line that names the active placeholder and per-attribute cap, so operators can verify configuration without inspecting traces.
- **FR-011**: Operators MUST be able to disable scrubbing entirely, change the placeholder string, and change or disable the per-attribute cap through environment configuration, without a code change.
- **FR-012**: Continuous integration MUST fail when the source-of-truth scrubber and any vendored copy used by another deploy unit drift apart.
- **FR-013**: The system MUST preserve all operationally useful span data: latency, token counts, model name, span structure and parent/child relationships, error information, normal chat messages, normal tool input/output, and routing decisions between agents.

### Key Entities

- **Span**: An OpenTelemetry span emitted by the supervisor or dynamic-agents service. Carries name, timing, parent linkage, error status, and a bag of typed attributes.
- **Span attribute**: A typed key/value pair on a span. May be a string (subject to redaction and capping), a number, or a boolean.
- **Skill section**: A region of prompt text bounded by known markers, containing the body of one or more skills.
- **Workflow section**: A region of prompt text bounded by known markers, containing operator-authored workflow definition content.
- **State channel attribute**: A span attribute whose value is a JSON-encoded snapshot of a graph state channel; sensitive channels (skills metadata, tasks, todos) are redacted by field name.
- **Tool span**: A span representing a tool invocation. Identified by tool name; certain tool names (workflow definition, self-service task) are redacted wholesale.
- **Redaction placeholder**: The configurable string substituted for redacted content.
- **Truncation marker**: A string that replaces oversized values, recording both the configured cap and the original byte length.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero skill bodies appear in any span shipped to Langfuse during a representative production-shaped workload (verified by inspection of every span's attributes for the known marker boundaries with non-placeholder content between them).
- **SC-002**: Zero operator workflow prompt bodies appear in any span shipped to Langfuse during a representative workload that includes workflow-definition and self-service-task tool calls.
- **SC-003**: No OTLP trace batch from the supervisor or dynamic-agents is rejected by the Langfuse ingress with `413 Request Entity Too Large` during a representative workload.
- **SC-004**: Every Langfuse trace continues to display latency, token counts, model name, span hierarchy, error status, normal chat messages, and normal tool input/output for the same workload, so that operators retain the diagnostic value of having traces.
- **SC-005**: Both the supervisor and dynamic-agents containers log a startup confirmation line naming the active placeholder and per-attribute cap on every cold start, before serving any request.
- **SC-006**: An operator can change the placeholder string, change the per-attribute cap, or disable scrubbing entirely by editing deployment configuration and restarting the service — with no code change and no rebuild.
- **SC-007**: A drift between the source-of-truth scrubber and any vendored copy is detected automatically by CI before merge.

## Assumptions

- The set of section markers that bound skill content and workflow content in prompt text is stable and known in advance; the scrubber is allowed to be marker-based rather than semantic.
- The set of sensitive state channel field names (skills metadata, tasks, todos) is stable and known in advance.
- Tool names that exclusively carry operator workflow content can be enumerated, so wholesale redaction by tool name is safe.
- A 256 KiB per-attribute byte cap is a reasonable default that fits comfortably under Langfuse's 1 MiB ingress limit even when a span carries several large attributes; operators may tighten it if they observe residual 413s in their environment.
- Dynamic-agents is deployed as a separate container that does not depend on the parent package, so a vendored copy of the scrubber (guarded by a CI drift check) is preferable to a runtime cross-package import.
