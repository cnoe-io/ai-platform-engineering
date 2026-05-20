# Contract: Skill Scanner Upload Validation Errors

## Endpoint

`POST /scan-upload`

Uploads a zipped skill package and scans the first discovered `SKILL.md`.

## Existing Successful Response

Successful scans continue to return the scanner's normal JSON response.

```json
{
  "scan_id": "string",
  "skill_name": "string",
  "is_safe": true,
  "max_severity": "safe",
  "findings_count": 0,
  "scan_duration_seconds": 0.0,
  "timestamp": "2026-05-13T00:00:00",
  "findings": []
}
```

## Validation Failure Response

Malformed skill definitions that fail known skill loading or validation checks must return an HTTP validation failure, preferably `422 Unprocessable Entity`.

```json
{
  "detail": "SKILL.md missing required field: name"
}
```

## Required Behavior

- A `SKILL.md` missing the required `name` field returns a validation failure with the actionable missing-field message.
- Known skill loading and validation exceptions return validation failures instead of generic internal scan errors.
- Unexpected scanner faults continue to return internal failure responses.
- Validation response details must be sanitized and must not include stack traces, secrets, tokens, or unnecessary runtime paths.
- Existing `400 Bad Request` responses for archive-level request problems, such as invalid ZIP archives or no `SKILL.md`, remain unchanged.

## Compatibility Notes

- Server-side UI clients already treat non-2xx scanner responses as `unscanned`; this contract improves the reason string without requiring browser-visible scanner access.
- Automated callers can distinguish malformed skill submissions from service faults by response status.
