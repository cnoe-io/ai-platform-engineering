import { test as base, expect } from "./persona-fixture";

import {
  IDENTITY_GROUP_FIXTURES,
  IDENTITY_GROUP_SYNC_RULE_FIXTURE,
} from "../fixtures/identity_groups";
import { REBAC_RESOURCE_FIXTURES } from "../fixtures/rebac_resources";
import { SLACK_REBAC_FIXTURES } from "../fixtures/slack_rebac";

interface IdentityGroupRebacFixtures {
  identityGroups: typeof IDENTITY_GROUP_FIXTURES;
  identityGroupSyncRule: typeof IDENTITY_GROUP_SYNC_RULE_FIXTURE;
  rebacResources: typeof REBAC_RESOURCE_FIXTURES;
  slackRebacFixtures: typeof SLACK_REBAC_FIXTURES;
}

export const test = base.extend<IdentityGroupRebacFixtures>({
  identityGroups: async ({}, use) => {
    await use(IDENTITY_GROUP_FIXTURES);
  },
  identityGroupSyncRule: async ({}, use) => {
    await use(IDENTITY_GROUP_SYNC_RULE_FIXTURE);
  },
  rebacResources: async ({}, use) => {
    await use(REBAC_RESOURCE_FIXTURES);
  },
  slackRebacFixtures: async ({}, use) => {
    await use(SLACK_REBAC_FIXTURES);
  },
});

export { expect };
