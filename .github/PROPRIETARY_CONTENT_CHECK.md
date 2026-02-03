# Proprietary Content Check

This document explains the automated check that prevents Cisco/Outshift-specific content from being committed to the open-source repository.

## Overview

The `check-proprietary-content.yml` GitHub Actions workflow automatically scans all PR changes for proprietary content that should not appear in the public repository.

## What is Checked

The workflow searches for the following patterns (case-insensitive):

- `cisco.com` - Cisco email domains
- `@cisco` - Cisco email addresses
- `outshift.io` - Outshift domains
- `outshift.cisco` - Outshift Cisco references
- `cisco-eti` - Cisco ETI organization references
- `eti-sre` / `eti_sre` - ETI SRE team references

## Excluded Files

The following files are excluded from checks:

- `.cursorrules` - Project development rules (maintainer info allowed)
- `.git_commit_msg.txt` - Temporary commit message file
- `pyproject.toml` - Python project files (maintainer info allowed)
- `CONTRIBUTING.md` - Contributor guidelines
- `CODE_OF_CONDUCT.md` - Code of conduct
- Lock files (`.lock`, `uv.lock`, `yarn.lock`, etc.)
- Build artifacts (`build/`, `dist/`, `.next/`, `coverage/`)
- Node modules (`node_modules/`)

## How It Works

### On Pull Request

When a PR is opened or updated:

1. **Checkout**: Fetches all PR changes
2. **Scan**: Searches changed files for proprietary patterns
3. **Report**: Comments on PR with violations found
4. **Block**: Fails the check if violations exist, preventing merge

### Example Violation

```
⚠️ Proprietary Content Detected

📄 File: `charts/values.yaml`
```yaml
15: ADMIN_EMAIL: user@cisco.com
42: COMPANY_DOMAIN: example.outshift.io
```

## Fixing Violations

### Replace with Generic Examples

❌ **Bad**: Specific to Cisco/Outshift
```yaml
email: admin@cisco.com
domain: app.outshift.io
group: eti_sre_admin
url: https://internal.cisco.com
```

✅ **Good**: Generic examples
```yaml
email: admin@example.com
domain: app.example.com
group: admin-group
url: https://your-internal-domain.com
```

### Common Replacements

| Proprietary | Generic Alternative |
|-------------|-------------------|
| `@cisco.com` | `@example.com` |
| `*.outshift.io` | `*.example.com` |
| `cisco-eti` | `your-org` |
| `eti_sre_admin` | `admin-group` |
| `eti-sre-admins` | `support-team` |

## Allowed Exceptions

### Maintainer Information

Maintainer contact information in specific files is allowed:

```python
# pyproject.toml
[project]
maintainers = [
  { name = "Sri Aradhyula", email = "sraradhy@cisco.com" }
]
```

### .cursorrules

Development rules for the project can reference the maintainer:

```markdown
**Maintainer**: Sri Aradhyula <sraradhy@cisco.com>
```

### Commit Messages

DCO sign-offs in commits are allowed:

```
Signed-off-by: Sri Aradhyula <sraradhy@cisco.com>
```

## Adding New Exclusions

If you need to exclude a new file pattern or allow specific content:

### Option 1: Exclude File Pattern

Edit `.github/workflows/check-proprietary-content.yml`:

```yaml
files_ignore: |
  **/*
  .github/workflows/check-proprietary-content.yml
  your-new-pattern/**/*.yaml  # Add your pattern here
```

### Option 2: Exclude in Script

Add to the `EXCLUDE_PATTERNS` array:

```bash
EXCLUDE_PATTERNS=(
  "\.cursorrules$"
  "\.git_commit_msg\.txt$"
  "pyproject\.toml$"
  "your_new_pattern\.yaml$"  # Add your pattern here
)
```

## Testing Locally

Before pushing, test for violations locally:

```bash
# Search for Cisco/Outshift references
git diff main | grep -iE "cisco\.com|@cisco|outshift\.io|cisco-eti|eti-sre|eti_sre"

# Or use ripgrep for more detailed search
rg -i "cisco\.com|outshift\.io|cisco-eti|eti-sre|eti_sre" \
  --glob '!.cursorrules' \
  --glob '!pyproject.toml' \
  --glob '!.git_commit_msg.txt'
```

## Why This Matters

### Open Source Best Practices

1. **Vendor Neutrality**: OSS should not be tied to specific organizations
2. **Portability**: Generic examples work for all users
3. **Privacy**: Avoid exposing internal infrastructure
4. **Adoption**: Users can relate to generic examples

### Example Impact

**Before (Bad)**:
```yaml
# Users see Cisco-specific config
oidc:
  issuer: https://sso.cisco.com
  required_group: eti_sre_admin
```

**After (Good)**:
```yaml
# Users see generic config they can customize
oidc:
  issuer: https://your-sso-provider.com
  required_group: your-admin-group
```

## Troubleshooting

### False Positives

If the check incorrectly flags content:

1. **Verify it's truly generic**: Double-check if the content can be more generic
2. **Add to exclusions**: Add the file pattern to `files_ignore`
3. **Document**: Comment on the PR explaining why it's a false positive

### Check Not Running

If the workflow doesn't run:

1. Check `.github/workflows/check-proprietary-content.yml` exists
2. Verify workflow has correct permissions
3. Check GitHub Actions are enabled for the repo
4. Look for syntax errors in the workflow YAML

### Workflow Failing for Wrong Reasons

```bash
# View workflow logs
gh run view <run-id> --log

# Re-run failed checks
gh run rerun <run-id>
```

## Bypassing (Emergency Only)

**WARNING**: Only bypass in emergencies with team approval.

To temporarily bypass the check, a maintainer with admin access can:

1. Comment on the PR explaining why bypass is needed
2. Get approval from another maintainer
3. Merge using admin override (if enabled)
4. Create a follow-up issue to fix the violations

**This should be extremely rare and documented.**

## Contributing

If you find issues with the check or have suggestions:

1. Open an issue describing the problem
2. Propose changes to the workflow
3. Test locally before submitting PR
4. Document any new patterns or exclusions

## Support

Questions about the proprietary content check?

- **Issues**: Open a GitHub issue
- **Discussions**: Use GitHub Discussions
- **PR Comments**: Ask in your pull request

## Related Documentation

- [Contributing Guidelines](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Security Policy](../SECURITY.md)
