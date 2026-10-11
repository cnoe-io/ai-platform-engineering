# Grype release report migration

Release image findings belong to the release tag whose images were scanned.
Filesystem findings belong to the source revision being scanned.

The release finalizer dispatches `security-scan.yml` after publishing a stable
release and after its required image builds pass. Existing releases and release
candidates can be scanned once their image builds finish:

```sh
gh workflow run security-scan.yml --repo OWNER/REPOSITORY --ref main -f tag=VERSION
```

## Retire incorrect branch attribution

Older versions of the scanner uploaded released-image results to `main`.
Changing future uploads to release tags does not remove those old branch
analyses. This migration preserves the original evidence before retiring them.

Requirements:

- Python 3 and an authenticated GitHub CLI with code-scanning write access.
- A successful scan of the existing release tag using the corrected workflow.
- A durable backup directory outside the repository.

Prepare a plan, without deleting analyses:

```sh
python3 scripts/security/migrate_grype_release_reports.py \
  --repo OWNER/REPOSITORY \
  --source-ref refs/heads/main \
  --release-ref refs/tags/VERSION \
  --backup-dir /absolute/path/to/new-backup-directory
```

Review `migration-plan.json`, then apply that exact plan:

```sh
python3 scripts/security/migrate_grype_release_reports.py \
  --apply-plan /absolute/path/to/new-backup-directory/migration-plan.json
```

The migration:

- Selects only release-container configurations with matching release reports.
- Verifies that both latest reports describe the same image and release version.
- Archives every selected branch analysis as SARIF, with SHA-256 checksums.
- Checks whether the current release scan retains every historical rule/location.
- Preserves any missing historical findings in separate `grype-legacy-*`
  configurations on the release tag before deleting branch analyses. These retain
  the historical scanner results; they are not fresh scans of rebuilt images.
- Deletes branch analyses newest first, following GitHub's analysis API rules.
- Records each upload and deletion, then verifies release reports still exist.

No alert is dismissed, no empty scan is uploaded, and no exception is added.
Removing incorrect branch attribution does not fix a vulnerable released image.
Rebuilt images still need fresh scans and any remaining dependency/vendor fixes.
