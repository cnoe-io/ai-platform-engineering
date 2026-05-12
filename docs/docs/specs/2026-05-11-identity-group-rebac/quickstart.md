# Quickstart: Enterprise Identity Group Sync and Universal ReBAC

## Goal

Validate the planned feature in a local or development CAIPE stack before creating implementation tasks. The quickstart focuses on the end-to-end behavior administrators and runtime services must support.

## Prerequisites

- CAIPE development stack with UI, MongoDB, Keycloak, OpenFGA, AgentGateway, and Slack bot components available.
- At least one admin user with bootstrap Keycloak admin role and matching ReBAC admin-surface access.
- Test users in Keycloak.
- Test teams, agents, tools, knowledge bases, skills, and tasks.
- A test identity group source or fixture data that represents Okta/AD/OIDC groups.
- Optional Slack workspace/channel fixture data for Slack channel checks.

## Scenario 1: Create an Identity Group Mapping Cluster

1. Open CAIPE Admin.
2. Navigate to Identity Group Sync.
3. Select an identity provider.
4. Create a mapping cluster with:
   - Include pattern matching approved team groups.
   - Exclude pattern for experimental or legacy groups.
   - Captures for team name and role.
   - Role map from upstream group role to CAIPE `member` or `admin`.
   - Auto-create team enabled.
5. Save the rule.

**Expected result**: The rule is saved as a draft or dry-run-required rule. It does not create teams, memberships, Keycloak roles, or OpenFGA tuples yet.

## Scenario 2: Preview Sync Safely

1. Run a dry-run for the new mapping cluster.
2. Review matched groups, ignored groups, generated teams, skipped users, membership adds/removes, and ReBAC tuple diffs.
3. Confirm any conflicts are visible and block apply.

**Expected result**: Dry-run produces no mutations and explains exactly what would change.

## Scenario 3: Apply Approved Sync

1. Resolve conflicts and skipped users.
2. Re-run dry-run until it is clean.
3. Apply the reviewed run.
4. Open the generated team.
5. Inspect membership source records.

**Expected result**: Teams are created when approved, memberships are active, source records show provider/group/rule provenance, and OpenFGA relationships exist for team membership.

## Scenario 4: Preserve Manual Membership

1. Manually add a user to a team.
2. Add the same user through a synced group.
3. Remove the user from the upstream group fixture.
4. Run sync.

**Expected result**: The synced source becomes stale or removed, but the user's effective team membership remains active because the manual source still grants it.

## Scenario 5: Grant Team Access to Resources

1. Open ReBAC Policy Builder.
2. Select a team userset such as `team:platform#member`.
3. Grant access to an agent, a tool, a knowledge base, a skill, and a task.
4. Validate the staged change set.
5. Apply it.
6. Open the graph and access checker.

**Expected result**: The graph shows the new relationships and the access checker explains allowed access paths for team members.

## Scenario 6: Configure Slack Channel Many-to-Many Access

1. Open a Slack channel in Admin.
2. Grant the channel access to multiple agents, tools, and knowledge bases.
3. Check a test user, channel, and resource invocation.

**Expected result**: The access checker requires all of these to pass:

- User can use the Slack channel.
- Slack channel is allowed to expose the selected resource.
- User or user's team can use the selected resource.

## Scenario 7: Verify Deny-by-Default Runtime

1. Remove the channel-to-agent grant.
2. Try the same Slack invocation.
3. Remove the team-to-agent grant.
4. Try the invocation again.

**Expected result**: Each missing relationship causes a deny with a safe reason code and an audit record. No Keycloak realm role or legacy CEL rule should silently allow access once the surface is ReBAC-enforced.

## Scenario 8: Review Enforcement Status

1. Open the ReBAC enforcement status view.
2. Inspect all resource types and runtime surfaces.

**Expected result**: Each resource type is marked as `not_gated`, `role_gated`, `rebac_shadowed`, `rebac_enforced`, or `deprecated`. Implementation tasks must move critical paths to `rebac_enforced` with tests.

## Verification Commands

Run the relevant checks after implementation:

```bash
make lint
make test
make caipe-ui-tests
make test-rbac
```

Targeted checks expected for this feature:

```bash
npm run test -- --runInBand identity-group-sync
npm run test -- --runInBand rebac
PYTHONPATH=. uv run pytest tests/rbac -v
PYTHONPATH=. uv run pytest integration/ -k "slack and rbac" -v
```

Exact commands may be adjusted during `/speckit.tasks` based on the files selected for implementation.
