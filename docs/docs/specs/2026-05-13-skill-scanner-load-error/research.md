# Research: Skill Scanner Validation Errors

## Decision: Fix the standalone scanner API boundary used by the image

**Rationale**: The reported failure occurs inside the upstream scanner API router during scan execution. In this repository, the scanner service is packaged by `build/Dockerfile.skill-scanner`, which installs `cisco-ai-skill-scanner` and runs `skill-scanner-api`; there is no first-party scanner source tree here. The implementation must therefore either consume an upstream package release that catches the validation exception or apply a narrow image-local patch during image build.

**Alternatives considered**:

- Handle the failure only in the UI client. Rejected because the API would still misclassify caller-correctable input as a server fault, and every caller would need duplicate heuristics.
- Reimplement scanner validation in CAIPE before calling the scanner. Rejected as duplicative and likely to drift from the scanner's own `SKILL.md` validation rules.
- Fork the scanner package into this repository. Rejected as too broad for a single error handling bug and increases supply chain maintenance.

## Decision: Return validation failures for known skill loading errors

**Rationale**: Missing required metadata and malformed `SKILL.md` content are user-correctable submission errors. The scanner should classify these as validation failures and include the loader's actionable message, while preserving generic internal-failure handling for unexpected runtime faults.

**Alternatives considered**:

- Return a successful scan result with a finding. Rejected because loading failed before analyzers could produce a trustworthy scan result.
- Keep HTTP 500 and improve logs only. Rejected because callers still cannot distinguish user-correctable input from service failure.
- Use HTTP 400 for all loading failures. Considered acceptable, but HTTP 422 more clearly communicates that the upload was syntactically received and semantically invalid.

## Decision: Sanitize surfaced validation details

**Rationale**: The validation message should help the skill author fix missing or malformed metadata but must not expose stack traces, credentials, raw runtime paths, or other sensitive environment details. The user-facing detail should come from known validation exception messages, with length bounding and no traceback output.

**Alternatives considered**:

- Return full exception text and traceback. Rejected for security and usability reasons.
- Return only a generic "Invalid skill" message. Rejected because it does not meet the requirement for actionable feedback.

## Decision: No database migration

**Rationale**: The feature changes scanner API error classification and packaging only. It does not introduce new persisted entities, collections, fields, indexes, or retention behavior.

**Alternatives considered**:

- Persist validation failures separately. Rejected as out of scope; existing callers can record scan outcomes if needed.
