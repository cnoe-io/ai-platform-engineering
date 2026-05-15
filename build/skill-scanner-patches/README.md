# Skill Scanner Patches

This directory contains temporary, image-local patches applied after installing
`cisco-ai-skill-scanner` in `build/Dockerfile.skill-scanner`.

Current package status:

- Latest checked PyPI version: `2.0.11`
- Dockerfile pin before this fix: `2.0.11`
- Decision: keep the pin and apply a narrow router patch until an upstream
  release maps skill loading validation errors to HTTP validation responses.

Remove this patch when an upstream `cisco-ai-skill-scanner` release catches
known skill loading exceptions, returns a validation status for malformed
`SKILL.md`, and preserves generic internal errors for unexpected faults.
