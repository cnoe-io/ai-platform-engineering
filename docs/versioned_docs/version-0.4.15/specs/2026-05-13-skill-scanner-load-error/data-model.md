# Data Model: Skill Scanner Validation Errors

## Skill Submission

Represents a skill package submitted for scanning.

**Fields**:

- `archive`: Uploaded package containing one or more files.
- `skill_directory`: Directory selected from the uploaded package that contains `SKILL.md`.
- `skill_manifest`: Metadata parsed from `SKILL.md`, including required fields such as `name`.
- `scan_options`: Selected scan policy and analyzer options.

**Validation Rules**:

- A submitted package must contain at least one `SKILL.md`.
- The selected skill definition must include all required metadata fields.
- Validation errors caused by malformed skill content are caller-correctable and must not be reported as internal service faults.

## Validation Failure

Represents a caller-correctable problem detected before or during skill loading.

**Fields**:

- `category`: Stable failure class, expected to be validation-related.
- `message`: Actionable, sanitized validation detail such as a missing required field.
- `status`: Validation response category that automated callers can distinguish from internal service faults.

**Validation Rules**:

- Message must not include stack traces, credentials, tokens, or unnecessary runtime filesystem paths.
- Message should preserve the actionable cause provided by the scanner loader when safe to expose.
- Failure category must be distinct from internal service failure.

## Scan Result

Represents the outcome returned to a scanner caller.

**Fields**:

- `scan_id`: Unique scan identifier for successful scans.
- `skill_name`: Name resolved from the submitted skill for successful scans.
- `is_safe`: Safety verdict for successful scans.
- `max_severity`: Highest finding severity for successful scans.
- `findings_count`: Count of findings for successful scans.
- `findings`: Structured findings for successful scans.
- `validation_error`: Validation failure detail for malformed submissions.

**State Transitions**:

```text
Submitted
|-- Validated -> Scanned -> ScanResult(success)
|-- Invalid -> ValidationFailure
`-- UnexpectedFault -> InternalFailure
```

**Relationships**:

- A `Skill Submission` produces exactly one outcome: successful `Scan Result`, `Validation Failure`, or internal failure.
- A `Validation Failure` is derived from a submitted skill's content, not from platform storage.

## Storage Impact

No persisted storage changes are required. This data model documents API outcome semantics only.
