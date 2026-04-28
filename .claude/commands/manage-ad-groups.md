<!-- caipe-skill: claude/manage-ad-groups -->
---
name: manage-ad-groups
description: Explains how to manage Cisco AD groups, OKTA groups, and AWS account access via cisco-eti/sre-cisco-groups-automation. Use when a user needs to add/remove team members from AWS access groups, AD groups, or onboard someone to a project's cloud access.
---

# Managing Cisco AD Groups

Repository: `cisco-eti/sre-cisco-groups-automation`

AD groups, OKTA groups, and AWS account access are managed via YAML files in this repo. Changes are made by opening a PR — automation syncs the groups to AD/OKTA/DSX.

Docs: [platform-docs.outshift.io/services/iam/cisco-ad-groups](https://platform-docs.outshift.io/services/iam/cisco-ad-groups)

---

## Repo Structure

```
sre-cisco-groups-automation/
├── groups_yaml/
│   ├── aws/
│   │   ├── <account-name>/          # e.g. outshift-common-dev, eticloud
│   │   │   └── AWS-<account-id>-<role>.yaml   # or .txt for simple lists
│   └── ...
└── config/
    └── default-onboarding-groups.yaml
```

---

## Group YAML Format

Full format (use `.yaml` extension):

```yaml
group_description: Description of what this group grants access to
member_users:
  - cec-id-1
  - cec-id-2
member_groups: []
owner_users:
  - cec-id-owner
  - frontline.gen
owner_groups:
  - eti-sre-ad-groups-admins
targets:
  - AD PROD
  - AD STAGE
  - DSX PROD
leave_policy: open
```

Simple format (use `.txt` extension) — just a list of CEC IDs:
```
cec-id-1
cec-id-2
```

> `.txt` files are used for groups where only the member list matters and no additional metadata is needed.

---

## Common Operations

### Add a user to an AWS account group

1. Find the right file: `groups_yaml/aws/<account-name>/AWS-<account-id>-<role>.yaml`

   Common accounts:
   - `outshift-common-dev` → AWS account `471112537430`
   - `eticloud` → AWS account `626007623524`
   - `eti-ci` → AWS account `009736724745`

2. Add the user's CEC ID to `member_users`:
   ```yaml
   member_users:
     - existing-user
     - new-cec-id    # add here, keep alphabetical order
   ```

3. Open a PR — the `check-alphabetical-order` workflow validates ordering.

### Create a new group

1. Create a new `.yaml` file in the appropriate directory
2. Follow the YAML format above
3. Register it in `atlantis.yaml` if it needs Atlantis management (usually not needed — the sync workflow handles it)
4. Open a PR

### Onboard a user to a project

Use the `onboard-user-to-project` workflow (triggered via GitHub Actions `workflow_dispatch`), or add the user to the relevant groups in `config/default-onboarding-groups.yaml`.

---

## PR Workflow

1. Edit the relevant `.yaml` or `.txt` files
2. Keep `member_users` in alphabetical order (enforced by CI)
3. Open a PR to `main`
4. `pr-auto-approval` bot approves if the change is valid
5. `apply-changes` workflow syncs the group to AD/OKTA/DSX after merge

---

## Targets

| Target | Description |
|--------|-------------|
| `AD PROD` | Cisco Active Directory (production) |
| `AD STAGE` | Cisco Active Directory (staging) |
| `DSX PROD` | DSX access system |
| `OKTA` | Okta groups |

---

## Leave Policy

| Value | Description |
|-------|-------------|
| `open` | Users can leave the group themselves |
| `closed` | Admin approval required to leave |

---

## Notes

- Always use the user's **CEC ID** (Cisco Employee CEC), not email or name.
- Keep `member_users` alphabetically sorted — CI will fail if not sorted.
- `owner_users` should include the service's on-call or team lead.
- `frontline.gen` and `mcmp-ad*.gen` are service accounts — leave them in owner_users if already present.
- The `eti-sre-ad-groups-admins` group is always in `owner_groups` for SRE-managed groups.
