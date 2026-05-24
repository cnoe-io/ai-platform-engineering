/**
 * @jest-environment node
 *
 * Pure-function tests for the Keycloak invariant evaluator. The
 * evaluator never calls Keycloak — every test feeds a hand-rolled
 * `KeycloakRbacDiagnosticValues` fixture and asserts the resulting
 * invariant statuses.
 *
 * assisted-by Claude Claude-opus-4-7
 */

import type {
  KeycloakAttachedPolicy,
  KeycloakRbacDiagnosticValues,
} from "@/lib/rbac/keycloak-admin";
import {
  evaluateKeycloakInvariants,
  summarizeKeycloakInvariants,
  type KeycloakInvariant,
} from "@/lib/rbac/keycloak-invariants";

const SLACK = "caipe-slack-bot";
const WEBEX = "caipe-webex-bot";
const AUDIENCE = "caipe-platform";

/**
 * Build a Keycloak `type=client` policy whose `client_ids` allow-list
 * resolves to the given bot clientId. Mirrors the post-hydration shape
 * the inspector produces for `readScopePermissionDetails` callers that
 * passed a `resolveClientId` resolver (i.e. the production path).
 */
function clientPolicy(name: string, authorisesClientId: string): KeycloakAttachedPolicy {
  return {
    id: `${name}-id`,
    name,
    type: "client",
    client_ids: [authorisesClientId],
  };
}

function happyPathValues(
  overrides: Partial<KeycloakRbacDiagnosticValues> = {}
): KeycloakRbacDiagnosticValues {
  const slackPol = clientPolicy(`${SLACK}-token-exchange`, SLACK);
  const slackPolAlt = clientPolicy(`${SLACK}-token-exchange-policy`, SLACK);
  const webexPol = clientPolicy(`${WEBEX}-token-exchange`, WEBEX);
  return {
    team_scopes: [
      {
        scope: "team-platform",
        scope_id: "scope-platform",
        active_team: "platform",
        active_team_mapper: "active_team",
        optional_on_slack_bot: true,
        optional_on_webex_bot: true,
        default_on_obo_audience: true,
      },
    ],
    obo_permissions: [
      {
        bot_client_id: SLACK,
        policy_name: `${SLACK}-token-exchange`,
        policy_id: "pol-slack",
        token_exchange_permission_id: "perm-shared-te",
        token_exchange_policy_attached: true,
        users_impersonate_permission_id: "perm-imp",
        users_impersonate_policy_attached: true,
      },
      {
        bot_client_id: WEBEX,
        policy_name: `${WEBEX}-token-exchange`,
        policy_id: "pol-webex",
        token_exchange_permission_id: "perm-shared-te",
        token_exchange_policy_attached: true,
        users_impersonate_permission_id: "perm-imp",
        users_impersonate_policy_attached: true,
      },
    ],
    bot_service_accounts: [
      {
        client_id: SLACK,
        service_account_id: "sa-slack",
        realm_management_roles: ["impersonation"],
        impersonation_role_assigned: true,
      },
      {
        client_id: WEBEX,
        service_account_id: "sa-webex",
        realm_management_roles: ["impersonation"],
        impersonation_role_assigned: true,
      },
    ],
    token_exchange_permissions: [
      {
        client_id: AUDIENCE,
        token_exchange_permission_id: "perm-aud-te",
        decision_strategy: "AFFIRMATIVE",
        policy_names: [`${SLACK}-token-exchange`, `${WEBEX}-token-exchange`],
        attached_policies: [slackPol, webexPol],
      },
      {
        client_id: SLACK,
        token_exchange_permission_id: "perm-slack-te",
        decision_strategy: "AFFIRMATIVE",
        policy_names: [`${SLACK}-token-exchange`, `${SLACK}-token-exchange-policy`],
        attached_policies: [slackPol, slackPolAlt],
      },
      {
        client_id: WEBEX,
        token_exchange_permission_id: "perm-webex-te",
        decision_strategy: "AFFIRMATIVE",
        policy_names: [`${WEBEX}-token-exchange`],
        attached_policies: [webexPol],
      },
    ],
    users_impersonate_permission: {
      permission_id: "perm-imp",
      decision_strategy: "AFFIRMATIVE",
      attached_policies: [slackPol, slackPolAlt, webexPol],
    },
    active_team_defaults: [
      {
        audience_client_id: AUDIENCE,
        default_team_scopes: ["team-platform"],
      },
    ],
    ...overrides,
  };
}

function evaluate(values: KeycloakRbacDiagnosticValues): KeycloakInvariant[] {
  return evaluateKeycloakInvariants({
    values,
    slackBotClientId: SLACK,
    webexBotClientId: WEBEX,
    oboAudienceClientId: AUDIENCE,
  });
}

function findInv(invariants: KeycloakInvariant[], id: string): KeycloakInvariant {
  const match = invariants.find((inv) => inv.id === id);
  if (!match) throw new Error(`Invariant ${id} not found; got ids: ${invariants.map((i) => i.id).join(", ")}`);
  return match;
}

describe("evaluateKeycloakInvariants — happy path", () => {
  it("passes every invariant for a fully-reconciled realm", () => {
    const invariants = evaluate(happyPathValues());
    const summary = summarizeKeycloakInvariants(invariants);
    expect(summary.failing).toBe(0);
    expect(summary.unknown).toBe(0);
    expect(summary.passing).toBe(invariants.length);
    expect(summary.reconcile_now_recommended).toBe(false);
  });

  it("includes the AFFIRMATIVE invariant for users.impersonate", () => {
    const invariants = evaluate(happyPathValues());
    expect(findInv(invariants, "obo.users_impersonate.affirmative").status).toBe("pass");
  });

  it("includes the AFFIRMATIVE invariant for the shared audience perm", () => {
    const invariants = evaluate(happyPathValues());
    expect(findInv(invariants, "obo.token_exchange.shared_audience.affirmative").status).toBe(
      "pass"
    );
  });
});

describe("evaluateKeycloakInvariants — UNANIMOUS regression (this is the outage we just fixed)", () => {
  it("fails users.impersonate.affirmative when strategy is UNANIMOUS", () => {
    const values = happyPathValues();
    values.users_impersonate_permission!.decision_strategy = "UNANIMOUS";
    const invariants = evaluate(values);
    const inv = findInv(invariants, "obo.users_impersonate.affirmative");
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
    expect(inv.detail).toMatch(/UNANIMOUS/);
    expect(summarizeKeycloakInvariants(invariants).reconcile_now_recommended).toBe(true);
  });

  it("fails the bot's own token-exchange perm when strategy is UNANIMOUS", () => {
    const values = happyPathValues();
    values.token_exchange_permissions[1]!.decision_strategy = "UNANIMOUS";
    const inv = findInv(evaluate(values), `obo.token_exchange.${SLACK}.affirmative`);
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
  });

  it("still passes the other AFFIRMATIVE perms when only one is UNANIMOUS", () => {
    const values = happyPathValues();
    values.users_impersonate_permission!.decision_strategy = "UNANIMOUS";
    const invariants = evaluate(values);
    expect(findInv(invariants, "obo.token_exchange.shared_audience.affirmative").status).toBe(
      "pass"
    );
    expect(findInv(invariants, `obo.token_exchange.${SLACK}.affirmative`).status).toBe("pass");
  });
});

describe("evaluateKeycloakInvariants — rogue permissive policy attached", () => {
  it("fails policies_strict when a non-client policy is attached to users.impersonate", () => {
    const values = happyPathValues();
    values.users_impersonate_permission!.attached_policies.push({
      id: "rogue-js",
      name: "dev-allow-all",
      type: "js",
    });
    const inv = findInv(evaluate(values), "obo.users_impersonate.policies_strict");
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("manual_keycloak");
    expect(inv.detail).toContain("dev-allow-all");
  });

  it("fails policies_strict on a client policy with empty client_ids allow-list", () => {
    const values = happyPathValues();
    values.users_impersonate_permission!.attached_policies.push({
      id: "empty-allowlist",
      name: "any-client",
      type: "client",
      client_ids: [],
    });
    const inv = findInv(evaluate(values), "obo.users_impersonate.policies_strict");
    expect(inv.status).toBe("fail");
    expect(inv.detail).toContain("any-client");
  });
});

describe("evaluateKeycloakInvariants — missing permission / policy attachments", () => {
  it("fails when the realm users.impersonate perm is entirely absent", () => {
    const values = happyPathValues();
    delete values.users_impersonate_permission;
    const invariants = evaluate(values);
    const inv = findInv(invariants, "obo.users_impersonate.exists");
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
    // When the perm is missing the dependent invariants must not exist
    // (no AFFIRMATIVE check, no policies_strict check) — otherwise the
    // UI would show "unknown decision strategy" alongside the missing
    // permission, which is just noise.
    expect(invariants.find((inv) => inv.id === "obo.users_impersonate.affirmative")).toBeUndefined();
    expect(
      invariants.find((inv) => inv.id === "obo.users_impersonate.policies_strict")
    ).toBeUndefined();
  });

  it("fails when one bot's policy is not attached to users.impersonate", () => {
    const values = happyPathValues();
    // Drop the webex bot's policy
    values.users_impersonate_permission!.attached_policies =
      values.users_impersonate_permission!.attached_policies.filter(
        (policy) => !policy.name.startsWith(WEBEX)
      );
    const inv = findInv(
      evaluate(values),
      `obo.users_impersonate.${WEBEX}_policy_attached`
    );
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
  });

  it("fails when an obo_permissions row reports the policy isn't attached", () => {
    const values = happyPathValues();
    values.obo_permissions[0]!.token_exchange_policy_attached = false;
    const inv = findInv(
      evaluate(values),
      `obo.bot.${SLACK}.token_exchange_policy_attached`
    );
    expect(inv.status).toBe("fail");
  });
});

describe("evaluateKeycloakInvariants — team-scope wiring", () => {
  it("fails active_team_mapper invariant when the mapper is missing", () => {
    const values = happyPathValues();
    values.team_scopes[0]!.active_team_mapper = "missing";
    values.team_scopes[0]!.active_team = "missing";
    const inv = findInv(evaluate(values), "team_scope.team-platform.active_team_mapper");
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
  });

  it("fails the bot-binding invariant when scope is not optional on a bot", () => {
    const values = happyPathValues();
    values.team_scopes[0]!.optional_on_slack_bot = false;
    const inv = findInv(
      evaluate(values),
      "team_scope.team-platform.optional_on_slack_bot"
    );
    expect(inv.status).toBe("fail");
  });

  it("fails the OBO-audience default invariant when scope is not bound default", () => {
    const values = happyPathValues();
    values.team_scopes[0]!.default_on_obo_audience = false;
    const inv = findInv(
      evaluate(values),
      "team_scope.team-platform.default_on_obo_audience"
    );
    expect(inv.status).toBe("fail");
  });
});

describe("evaluateKeycloakInvariants — team-personal special-case", () => {
  // `team-personal` is the DM-mode marker scope. Unlike real team scopes it is
  // NOT bound on the OBO audience client (see `ensurePersonalTeamClientScope`
  // for the rationale), so the evaluator must NOT emit a
  // `default_on_obo_audience` invariant for it. Instead it emits a single
  // top-level advisory invariant `team_personal.dm_mode_known_limitation` so
  // ops can see the structural DM limitation without it being a perpetual red.

  function personalScopeOverride(
    overrides: Partial<KeycloakRbacDiagnosticValues["team_scopes"][number]> = {}
  ) {
    return happyPathValues({
      team_scopes: [
        {
          scope: "team-personal",
          scope_id: "scope-personal",
          active_team: "__personal__",
          active_team_mapper: "active-team-personal",
          optional_on_slack_bot: true,
          optional_on_webex_bot: true,
          // Intentionally false — team-personal is NEVER default on the audience.
          default_on_obo_audience: false,
          ...overrides,
        },
      ],
    });
  }

  it("does NOT emit a default_on_obo_audience invariant for team-personal", () => {
    const invariants = evaluate(personalScopeOverride());
    const audienceInv = invariants.find(
      (inv) => inv.id === "team_scope.team-personal.default_on_obo_audience"
    );
    expect(audienceInv).toBeUndefined();
  });

  it("emits the dm_mode_known_limitation advisory whenever team-personal is present", () => {
    const invariants = evaluate(personalScopeOverride());
    const inv = findInv(invariants, "team_personal.dm_mode_known_limitation");
    // Advisory only — not a red failure. Surfaces the structural KC limitation.
    expect(inv.status).toBe("unknown");
    expect(inv.remediation).toBe("manual_keycloak");
    expect(inv.detail).toContain("token-exchange drops");
  });

  it("still checks optional_on_slack_bot and optional_on_webex_bot for team-personal", () => {
    const invariants = evaluate(
      personalScopeOverride({ optional_on_webex_bot: false })
    );
    const webexInv = findInv(
      invariants,
      "team_scope.team-personal.optional_on_webex_bot"
    );
    expect(webexInv.status).toBe("fail");
    expect(webexInv.remediation).toBe("reconcile_now");
  });

  it("fails active_team_mapper for team-personal when the mapper value drifts off __personal__", () => {
    const invariants = evaluate(
      personalScopeOverride({ active_team: "platform" })
    );
    const inv = findInv(
      invariants,
      "team_scope.team-personal.active_team_mapper"
    );
    expect(inv.status).toBe("fail");
    expect(inv.detail).toContain("expected __personal__");
  });

  it("does NOT emit the dm_mode_known_limitation advisory when team-personal is absent", () => {
    const invariants = evaluate(happyPathValues());
    const inv = invariants.find(
      (inv) => inv.id === "team_personal.dm_mode_known_limitation"
    );
    expect(inv).toBeUndefined();
  });
});

describe("evaluateKeycloakInvariants — service-account roles", () => {
  it("fails impersonation_role invariant when a bot lacks the role", () => {
    const values = happyPathValues();
    values.bot_service_accounts[0]!.impersonation_role_assigned = false;
    const inv = findInv(
      evaluate(values),
      `service_account.${SLACK}.impersonation_role`
    );
    expect(inv.status).toBe("fail");
    expect(inv.remediation).toBe("reconcile_now");
  });
});

/**
 * Regression test for the bug where the evaluator reported every
 * `type=client` bot policy as "non-client-allowlist" AND simultaneously
 * reported each bot's allow-list policy as "not attached".
 *
 * Root cause: Keycloak's `associatedPolicies` endpoint returns
 * `config: {}` for client-type policies — the real `clients[]` lives
 * on `/policy/client/<id>`. The inspector had to be enhanced to make
 * a second call per policy to hydrate `client_ids`; the evaluator was
 * matching attachment via UUIDs-in-config, which were never there.
 *
 * Both fixtures below are taken verbatim from the live Keycloak
 * admin API on the local dev realm (see commit message).
 */
describe("evaluateKeycloakInvariants — hydration regression (real Keycloak shapes)", () => {
  it("treats post-hydration client policies as valid allow-list AND correctly identifies attachment", () => {
    // Verbatim post-hydration shape (associatedPolicies summary +
    // client_ids resolved from the per-policy endpoint).
    const slackPostHydration: KeycloakAttachedPolicy = {
      id: "032014c9-0774-4656-a3f4-d21fd0fc5fa4",
      name: "caipe-slack-bot-token-exchange",
      type: "client",
      client_ids: [SLACK],
    };
    const webexPostHydration: KeycloakAttachedPolicy = {
      id: "db18a4e9-d29a-4d39-ac69-a7cc5d6a39a6",
      name: "caipe-webex-bot-token-exchange",
      type: "client",
      client_ids: [WEBEX],
    };
    const values = happyPathValues({
      token_exchange_permissions: [
        {
          client_id: AUDIENCE,
          token_exchange_permission_id: "perm-aud-te",
          decision_strategy: "AFFIRMATIVE",
          policy_names: [slackPostHydration.name, webexPostHydration.name],
          attached_policies: [slackPostHydration, webexPostHydration],
        },
        {
          client_id: SLACK,
          token_exchange_permission_id: "perm-slack-te",
          decision_strategy: "AFFIRMATIVE",
          policy_names: [slackPostHydration.name],
          attached_policies: [slackPostHydration],
        },
        {
          client_id: WEBEX,
          token_exchange_permission_id: "perm-webex-te",
          decision_strategy: "AFFIRMATIVE",
          policy_names: [webexPostHydration.name],
          attached_policies: [webexPostHydration],
        },
      ],
      users_impersonate_permission: {
        permission_id: "perm-imp",
        decision_strategy: "AFFIRMATIVE",
        attached_policies: [slackPostHydration, webexPostHydration],
      },
    });
    const invariants = evaluate(values);
    // policies_strict must PASS — these are well-formed client allow-list policies.
    expect(findInv(invariants, "obo.token_exchange.shared_audience.policies_strict").status).toBe(
      "pass"
    );
    expect(findInv(invariants, `obo.token_exchange.${SLACK}.policies_strict`).status).toBe("pass");
    expect(findInv(invariants, "obo.users_impersonate.policies_strict").status).toBe("pass");
    // <bot>_policy_attached must PASS — we have real allow-list data
    // saying these policies authorise the named bots.
    expect(
      findInv(invariants, "obo.token_exchange.shared_audience.slack_policy_attached").status
    ).toBe("pass");
    expect(
      findInv(invariants, "obo.token_exchange.shared_audience.webex_policy_attached").status
    ).toBe("pass");
    expect(findInv(invariants, `obo.users_impersonate.${SLACK}_policy_attached`).status).toBe(
      "pass"
    );
    expect(findInv(invariants, `obo.users_impersonate.${WEBEX}_policy_attached`).status).toBe(
      "pass"
    );
  });

  it("falls back to name-prefix matching for projection-only fixtures (no client_ids)", () => {
    // Some test fixtures + the test path without a resolver leave
    // client_ids undefined. The evaluator must remain useful in that
    // mode (since unit tests are projection-only by default) — both
    // policies_strict and *_policy_attached must still pass.
    const slackProj: KeycloakAttachedPolicy = {
      id: "p-slack",
      name: "caipe-slack-bot-token-exchange",
      type: "client",
    };
    const webexProj: KeycloakAttachedPolicy = {
      id: "p-webex",
      name: "caipe-webex-bot-token-exchange",
      type: "client",
    };
    const values = happyPathValues({
      users_impersonate_permission: {
        permission_id: "perm-imp",
        decision_strategy: "AFFIRMATIVE",
        attached_policies: [slackProj, webexProj],
      },
    });
    const invariants = evaluate(values);
    expect(findInv(invariants, "obo.users_impersonate.policies_strict").status).toBe("pass");
    expect(findInv(invariants, `obo.users_impersonate.${SLACK}_policy_attached`).status).toBe(
      "pass"
    );
    expect(findInv(invariants, `obo.users_impersonate.${WEBEX}_policy_attached`).status).toBe(
      "pass"
    );
  });

  it("flags a client policy that authorises an UNKNOWN client as 'not attached' for known bots", () => {
    // Defense in depth: if Keycloak returns a `clients` allow-list
    // that doesn't actually name a known bot (e.g. somebody attached
    // a stale policy), the *_policy_attached invariant must fail
    // rather than silently passing on policy-name heuristics.
    const stalePol: KeycloakAttachedPolicy = {
      id: "p-stale",
      // Name still looks like a slack-bot policy (operator copy-paste)
      // but client_ids resolves to something else entirely.
      name: "caipe-slack-bot-token-exchange",
      type: "client",
      client_ids: ["some-other-client"],
    };
    const values = happyPathValues({
      users_impersonate_permission: {
        permission_id: "perm-imp",
        decision_strategy: "AFFIRMATIVE",
        // Slack policy is stale; webex is fine.
        attached_policies: [
          stalePol,
          { id: "p-webex", name: `${WEBEX}-token-exchange`, type: "client", client_ids: [WEBEX] },
        ],
      },
    });
    const invariants = evaluate(values);
    expect(findInv(invariants, `obo.users_impersonate.${SLACK}_policy_attached`).status).toBe(
      "fail"
    );
    expect(findInv(invariants, `obo.users_impersonate.${WEBEX}_policy_attached`).status).toBe(
      "pass"
    );
  });
});

describe("summarizeKeycloakInvariants", () => {
  it("counts pass/fail/unknown and flags reconcile when reconcile_now failures exist", () => {
    const summary = summarizeKeycloakInvariants([
      { id: "a", description: "", group: "obo", source: "init-idp.sh", status: "pass", remediation: "none" },
      { id: "b", description: "", group: "obo", source: "init-idp.sh", status: "fail", remediation: "reconcile_now" },
      { id: "c", description: "", group: "obo", source: "init-idp.sh", status: "fail", remediation: "manual_keycloak" },
      { id: "d", description: "", group: "obo", source: "init-idp.sh", status: "unknown", remediation: "none" },
    ]);
    expect(summary).toEqual({
      total: 4,
      passing: 1,
      failing: 2,
      unknown: 1,
      reconcile_now_recommended: true,
    });
  });

  it("does not recommend reconcile when only manual_keycloak failures exist", () => {
    const summary = summarizeKeycloakInvariants([
      { id: "a", description: "", group: "obo", source: "init-idp.sh", status: "fail", remediation: "manual_keycloak" },
    ]);
    expect(summary.reconcile_now_recommended).toBe(false);
  });
});
