# Quickstart: Skill Scanner Validation Errors

## Goal

Verify malformed skill submissions return actionable validation failures while valid scans still succeed and unexpected faults remain distinct.

## Local Checks

1. Build or run the scanner service from the feature branch.

   ```bash
   docker build -f build/Dockerfile.skill-scanner -t skill-scanner:validation-error .
   docker run --rm -p 8765:8000 skill-scanner:validation-error
   ```

   If `8765` is already allocated locally, use another host port such as
   `8766:8000` and adjust the `curl` URLs below.

2. Create a malformed skill archive that omits the required `name` field.

   ```bash
   tmpdir="$(mktemp -d)"
   mkdir -p "${tmpdir}/bad-skill"
   cat > "${tmpdir}/bad-skill/SKILL.md" <<'EOF'
   ---
   description: Missing the required name field
   ---

   Instructions.
   EOF
   (cd "${tmpdir}" && zip -qr bad-skill.zip bad-skill)
   ```

3. Submit the malformed archive.

   ```bash
   curl -sS -i -F "file=@${tmpdir}/bad-skill.zip" http://localhost:8765/scan-upload
   ```

   Expected result:

   - HTTP validation failure, preferably `422`.
   - Response body includes `SKILL.md missing required field: name`.
   - Response body does not include a Python traceback.

4. Submit a valid minimal skill archive and confirm it still returns a successful scan response.

5. Run targeted tests.

   ```bash
   uv run pytest ai_platform_engineering/skills_middleware/tests/test_skill_scanner_api_patch.py -v
   uv run pytest ai_platform_engineering/skills_middleware/tests/test_skill_scanner_runner.py -v
   ```

6. If the UI client behavior changes, run the relevant UI test.

   ```bash
   cd ui && npm test -- --runTestsByPath src/lib/__tests__/skill-scan-ancillary.test.ts
   ```

## Release Verification

- Confirm `build/Dockerfile.skill-scanner` pins the intended scanner package version or applies the temporary patch during image build.
- Confirm the scanner image still runs as non-root and remains internal-only in compose and Helm.
- Confirm no database migration is required.
