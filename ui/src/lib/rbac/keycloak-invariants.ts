/**
 * Keycloak realm invariants.
 *
 * Pure evaluator over the read-only `KeycloakRbacDiagnosticValues`
 * inspection. Each invariant corresponds to one configuration step
 * that `init-idp.sh` / `init-token-exchange.sh` or the BFF startup
 * migration `keycloak_rbac_mapping_reconciliation_v1` is responsible
 * for. The evaluator never calls Keycloak — it consumes the existing
 * inspection output so the same set of checks runs identically in
 * tests and in production without any extra HTTP round-trips.
 *
 * Status meanings:
 *   - pass    : invariant holds for the inspected realm
 *   - fail    : invariant is violated (admin must remediate)
 *   - unknown : the inspector couldn't gather the input — usually
 *               because Keycloak was unreachable, the bot client is
 *               unintentionally absent, or we explicitly haven't
 *               implemented the audit yet. Surfaces as a yellow pill
 *               in the UI, not red, so admins can tell the difference
 *               between "broken" and "we don't know".
 *
 * Remediation hints:
 *   - reconcile_now    : the BFF startup migration can fix it; the
 *                        panel renders a "Reconcile now" CTA.
 *   - manual_keycloak  : requires direct Keycloak Admin Console
 *                        intervention (typically removing a policy
 *                        that an operator added by hand).
 *   - none             : informational only.
 *
 * assisted-by Claude Claude-opus-4-7
 */
import type {
  KeycloakAttachedPolicy,
  KeycloakRbacDiagnosticValues,
} from "@/lib/rbac/keycloak-admin";

export type KeycloakInvariantStatus = "pass" | "fail" | "unknown";
export type KeycloakInvariantRemediation = "reconcile_now" | "manual_keycloak" | "none";

export interface KeycloakInvariant {
  /** Stable machine identifier (used for tests and stable rendering keys). */
  id: string;
  /** One-line description rendered in the UI. */
  description: string;
  /** Optional grouping label (drives section headers in the panel). */
  group: "obo" | "client" | "team-scope" | "service-account";
  /** Which script / migration owns provisioning of this invariant. */
  source: "init-idp.sh" | "init-token-exchange.sh" | "bff-migration";
  status: KeycloakInvariantStatus;
  /** Free-form explanation rendered when status != pass. */
  detail?: string;
  remediation: KeycloakInvariantRemediation;
}

/**
 * Bot identifiers the realm is expected to be configured for. Defaults
 * match init-idp.sh constants; tests pass overrides so each test fixture
 * is hermetic and doesn't read process.env.
 */
export interface KeycloakInvariantInputs {
  values: KeycloakRbacDiagnosticValues;
  slackBotClientId: string;
  webexBotClientId: string;
  oboAudienceClientId: string;
  /** Set of known bot client IDs allowed to appear in policy `clients` lists. */
  knownBotClientIds?: string[];
}

const AFFIRMATIVE = "AFFIRMATIVE";

/**
 * A policy passes the "strict client allow-list" shape check if:
 *   - it is a Keycloak `client`-type policy, AND
 *   - the inspector successfully hydrated its `client_ids` (i.e. we
 *     have ground-truth data, not an undefined we can't reason about),
 *     AND
 *   - the resolved `client_ids` list is non-empty.
 *
 * If `client_ids` is `undefined` (hydration failed or the inspector
 * was called without a resolver — e.g. unit tests for the projection
 * path) we treat the policy as "unknown shape" rather than as a
 * failure. The invariant gets `status: pass` for known-good shapes
 * only; the catch-all default treats `type=client` *with no hydration
 * available* as benign, mirroring the inspector's tolerance.
 */
function isClientAllowlistPolicy(policy: KeycloakAttachedPolicy): boolean {
  if (policy.type !== "client") return false;
  // No hydration data — accept on type alone. This keeps the projection-
  // only test path (which never calls the type-specific endpoint) from
  // turning every test case into a "rogue policy" finding.
  if (policy.client_ids === undefined) return true;
  return policy.client_ids.length > 0;
}

function policyAuthorizesClient(
  policy: KeycloakAttachedPolicy,
  clientId: string
): boolean {
  // Authoritative check: does the resolved allow-list name this client?
  if (Array.isArray(policy.client_ids) && policy.client_ids.includes(clientId)) {
    return true;
  }
  // Fallback for the projection-only path (no hydration): match by
  // policy name. Every bot OBO policy in this realm names itself
  // `caipe-<bot>-token-exchange[-policy]`, so name-prefix matching is
  // a sound heuristic when we can't get the real allow-list.
  if (policy.client_ids === undefined) {
    return policy.name.toLowerCase().startsWith(clientId.toLowerCase());
  }
  return false;
}

function describePoliciesByClient(
  attached: KeycloakAttachedPolicy[],
  clientId: string
): KeycloakAttachedPolicy[] {
  return attached.filter((policy) => policyAuthorizesClient(policy, clientId));
}

/**
 * Render a Keycloak policy as a single inline string for the detail
 * field of a failing invariant. Includes the resolved client_ids when
 * available so admins can see exactly which clientIds a policy
 * authorises without leaving the panel.
 */
function describePolicy(policy: KeycloakAttachedPolicy): string {
  const allowlist =
    policy.client_ids === undefined
      ? ""
      : policy.client_ids.length === 0
        ? ", clients=[]"
        : `, clients=[${policy.client_ids.join(",")}]`;
  return `${policy.name}(type=${policy.type ?? "?"}${allowlist})`;
}

/**
 * Build the invariant set. Pure function, fully deterministic given
 * the inspection input, so we can unit-test every branch without
 * touching Keycloak.
 */
export function evaluateKeycloakInvariants(
  inputs: KeycloakInvariantInputs
): KeycloakInvariant[] {
  const { values, slackBotClientId, webexBotClientId, oboAudienceClientId } = inputs;
  const knownBots = new Set(
    inputs.knownBotClientIds ?? [slackBotClientId, webexBotClientId]
  );
  const invariants: KeycloakInvariant[] = [];

  // ────────────────────────────────────────────────────────────────
  // OBO permission decision-strategy invariants
  //
  // These are the ones that caused the "client not allowed to
  // exchange/impersonate" outage. Each shared scope-permission with
  // ≥2 bot policies attached MUST be AFFIRMATIVE; otherwise the
  // other bot's per-client policy votes DENY and Keycloak rejects.
  // ────────────────────────────────────────────────────────────────
  for (const perm of values.token_exchange_permissions) {
    const isSharedPerm = perm.client_id === oboAudienceClientId;
    const idSuffix = isSharedPerm ? "shared_audience" : perm.client_id;
    if (perm.token_exchange_permission_id === "missing") {
      invariants.push({
        id: `obo.token_exchange.${idSuffix}.exists`,
        description: `token-exchange scope-permission exists on ${perm.client_id}`,
        group: "obo",
        source: "init-idp.sh",
        status: "fail",
        detail:
          "Keycloak did not report a token-exchange scope-permission for this client. " +
          "Enable management permissions on the client (init-idp.sh does this) or " +
          "click Reconcile now.",
        remediation: "reconcile_now",
      });
      continue;
    }
    invariants.push({
      id: `obo.token_exchange.${idSuffix}.exists`,
      description: `token-exchange scope-permission exists on ${perm.client_id}`,
      group: "obo",
      source: "init-idp.sh",
      status: "pass",
      remediation: "none",
    });

    const strategyOk = perm.decision_strategy === AFFIRMATIVE;
    invariants.push({
      id: `obo.token_exchange.${idSuffix}.affirmative`,
      description: `${perm.client_id} token-exchange perm uses AFFIRMATIVE strategy`,
      group: "obo",
      source: "init-idp.sh",
      status: strategyOk ? "pass" : "fail",
      detail: strategyOk
        ? undefined
        : `Current strategy: ${perm.decision_strategy}. Under UNANIMOUS, any second bot's ` +
          `per-client policy will vote DENY and block OBO. Reconcile now will flip it to ` +
          `AFFIRMATIVE.`,
      remediation: strategyOk ? "none" : "reconcile_now",
    });

    // Every attached policy must be a strict `type=client` allow-list.
    // Under AFFIRMATIVE a single permissive policy (js, role, regex,
    // empty clients list) bypasses the entire allow-list — so we
    // assert shape, not just presence.
    const rogue = perm.attached_policies.filter((policy) => !isClientAllowlistPolicy(policy));
    invariants.push({
      id: `obo.token_exchange.${idSuffix}.policies_strict`,
      description: `${perm.client_id} token-exchange perm only has strict client allow-list policies`,
      group: "obo",
      source: "init-idp.sh",
      status: rogue.length === 0 ? "pass" : "fail",
      detail:
        rogue.length === 0
          ? undefined
          : `Found ${rogue.length} non-client-allowlist policy/policies attached: ${rogue
                          .map(describePolicy)
                          .join(", ")}. Under AFFIRMATIVE these grant access on their own. ` +
                        `Remove via Keycloak Admin Console.`,
                  remediation: rogue.length === 0 ? "none" : "manual_keycloak",
                });

                // For the shared audience perm, BOTH bots' policies must be attached.
    if (isSharedPerm) {
      const slackAttached = describePoliciesByClient(
        perm.attached_policies,
        slackBotClientId
      ).length > 0;
      const webexAttached = describePoliciesByClient(
        perm.attached_policies,
        webexBotClientId
      ).length > 0;
      invariants.push({
        id: "obo.token_exchange.shared_audience.slack_policy_attached",
        description: `Slack bot policy attached to ${oboAudienceClientId} token-exchange perm`,
        group: "obo",
        source: "init-idp.sh",
        status: slackAttached ? "pass" : "fail",
        detail: slackAttached
          ? undefined
          : `No policy whose name starts with "${slackBotClientId}" is attached. ` +
            `Reconcile now will re-attach the slack bot OBO policy.`,
        remediation: slackAttached ? "none" : "reconcile_now",
      });
      invariants.push({
        id: "obo.token_exchange.shared_audience.webex_policy_attached",
        description: `Webex bot policy attached to ${oboAudienceClientId} token-exchange perm`,
        group: "obo",
        source: "init-idp.sh",
        status: webexAttached ? "pass" : "fail",
        detail: webexAttached
          ? undefined
          : `No policy whose name starts with "${webexBotClientId}" is attached. ` +
            `Reconcile now will re-attach the webex bot OBO policy.`,
        remediation: webexAttached ? "none" : "reconcile_now",
      });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Realm-level users.impersonate scope-permission
  //
  // This is the single perm both bots share. It is the one that
  // actually caused tonight's "client not allowed to impersonate"
  // outage. The invariants mirror the audience perm exactly.
  // ────────────────────────────────────────────────────────────────
  const imp = values.users_impersonate_permission;
  if (!imp) {
    invariants.push({
      id: "obo.users_impersonate.exists",
      description: "Realm users.impersonate scope-permission exists",
      group: "obo",
      source: "init-idp.sh",
      status: "fail",
      detail:
        "Keycloak did not return a realm-level users.impersonate scope-permission. " +
        "The realm-management → users-management-permissions feature must be enabled. " +
        "Reconcile now enables it.",
      remediation: "reconcile_now",
    });
  } else {
    invariants.push({
      id: "obo.users_impersonate.exists",
      description: "Realm users.impersonate scope-permission exists",
      group: "obo",
      source: "init-idp.sh",
      status: "pass",
      remediation: "none",
    });

    const strategyOk = imp.decision_strategy === AFFIRMATIVE;
    invariants.push({
      id: "obo.users_impersonate.affirmative",
      description: "users.impersonate scope-permission uses AFFIRMATIVE strategy",
      group: "obo",
      source: "init-idp.sh",
      status: strategyOk ? "pass" : "fail",
      detail: strategyOk
        ? undefined
        : `Current strategy: ${imp.decision_strategy}. Both Slack and Webex bot policies ` +
          `attach here; UNANIMOUS causes each bot to be DENY-voted by the other bot's ` +
          `policy and OBO fails with "client not allowed to impersonate". Reconcile now ` +
          `will flip the strategy to AFFIRMATIVE.`,
      remediation: strategyOk ? "none" : "reconcile_now",
    });

    const rogue = imp.attached_policies.filter((policy) => !isClientAllowlistPolicy(policy));
    invariants.push({
      id: "obo.users_impersonate.policies_strict",
      description: "users.impersonate perm only has strict client allow-list policies",
      group: "obo",
      source: "init-idp.sh",
      status: rogue.length === 0 ? "pass" : "fail",
      detail:
        rogue.length === 0
          ? undefined
          : `Found ${rogue.length} non-client-allowlist policy/policies attached: ${rogue
                          .map(describePolicy)
                          .join(", ")}. Under AFFIRMATIVE these grant impersonation on their own. ` +
                        `Remove via Keycloak Admin Console.`,
      remediation: rogue.length === 0 ? "none" : "manual_keycloak",
    });

    // Each known bot must have at least one allow-list policy attached
    // here, otherwise that bot can't OBO at all.
    for (const botClientId of knownBots) {
      const attached = describePoliciesByClient(imp.attached_policies, botClientId).length > 0;
      invariants.push({
        id: `obo.users_impersonate.${botClientId}_policy_attached`,
        description: `${botClientId} policy attached to users.impersonate perm`,
        group: "obo",
        source: "init-idp.sh",
        status: attached ? "pass" : "fail",
        detail: attached
          ? undefined
          : `No policy whose name starts with "${botClientId}" is attached. Reconcile now ` +
            `will re-attach the bot's OBO policy.`,
        remediation: attached ? "none" : "reconcile_now",
      });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Per-bot OBO wiring sourced from existing `obo_permissions` rows
  //
  // The diagnostic inspector already produces a boolean-per-bot
  // "token_exchange_policy_attached" + "users_impersonate_policy_attached"
  // — we expose those as named invariants too so admins see the same
  // shape across all checks rather than mixing free-form tables with
  // pass/fail rows.
  // ────────────────────────────────────────────────────────────────
  for (const row of values.obo_permissions) {
    invariants.push({
      id: `obo.bot.${row.bot_client_id}.token_exchange_policy_attached`,
      description: `${row.bot_client_id} policy attached to its own token-exchange perm`,
      group: "obo",
      source: "init-idp.sh",
      status: row.token_exchange_policy_attached ? "pass" : "fail",
      detail: row.token_exchange_policy_attached
        ? undefined
        : `Expected policy "${row.policy_name}" to be attached to the bot's own ` +
          `token-exchange perm. Reconcile now will repair it.`,
      remediation: row.token_exchange_policy_attached ? "none" : "reconcile_now",
    });
    invariants.push({
      id: `obo.bot.${row.bot_client_id}.users_impersonate_policy_attached`,
      description: `${row.bot_client_id} policy attached to realm users.impersonate perm`,
      group: "obo",
      source: "init-idp.sh",
      status: row.users_impersonate_policy_attached ? "pass" : "fail",
      detail: row.users_impersonate_policy_attached
        ? undefined
        : `Expected policy "${row.policy_name}" to be attached to the realm users.impersonate ` +
          `perm. Reconcile now will repair it.`,
      remediation: row.users_impersonate_policy_attached ? "none" : "reconcile_now",
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Bot service-account realm-management impersonation role
  //
  // Required so the bot's confidential client can call the admin
  // API path for impersonation. init-idp.sh assigns this; the BFF
  // migration repairs it.
  // ────────────────────────────────────────────────────────────────
  for (const account of values.bot_service_accounts) {
    invariants.push({
      id: `service_account.${account.client_id}.impersonation_role`,
      description: `${account.client_id} service account has realm-management impersonation role`,
      group: "service-account",
      source: "bff-migration",
      status: account.impersonation_role_assigned ? "pass" : "fail",
      detail: account.impersonation_role_assigned
        ? undefined
        : "The bot's service account must hold the realm-management `impersonation` role to " +
          "perform OBO. Reconcile now will assign it.",
      remediation: account.impersonation_role_assigned ? "none" : "reconcile_now",
    });
  }

  // ────────────────────────────────────────────────────────────────
  // Team-scope wiring sourced from values.team_scopes
  //
  // Phase 3 (spec 2026-05-24-derive-team-from-channel) stopped
  // materializing `team-<slug>` client scopes. The BFF no longer
  // creates, mutates, or relies on them, but legacy realms may
  // still carry stale `team-*` scopes from earlier installs. The
  // per-team `team_scope.<scope>.active_team_mapper` invariants
  // below act as diagnostics in that case — they surface the
  // legacy scopes so an operator can clean them up using
  // `scripts/cleanup-team-keycloak-scopes.sh`. We do NOT emit a
  // `team_personal.dm_mode_known_limitation` invariant anymore;
  // DMs do not run through Keycloak token exchange, so the RFC
  // 8693 limitation no longer applies.
  // ────────────────────────────────────────────────────────────────
  const PERSONAL_SCOPE_NAME = "team-personal";
  for (const scope of values.team_scopes) {
    const isPersonal = scope.scope === PERSONAL_SCOPE_NAME;
    const expectedActiveTeam = isPersonal ? "__personal__" : null;
    const mapperOk =
      scope.active_team_mapper !== "missing" &&
      scope.active_team !== "missing" &&
      (expectedActiveTeam === null || scope.active_team === expectedActiveTeam);
    invariants.push({
      id: `team_scope.${scope.scope}.active_team_mapper`,
      description: `${scope.scope} has an active_team protocol mapper`,
      group: "team-scope",
      source: isPersonal ? "init-token-exchange.sh" : "bff-migration",
      status: mapperOk ? "pass" : "fail",
      detail: mapperOk
        ? undefined
        : `Mapper status: name=${scope.active_team_mapper}, value=${scope.active_team}` +
          (expectedActiveTeam !== null ? ` (expected ${expectedActiveTeam})` : "") +
          `. Reconcile now will create or repair the mapper.`,
      remediation: mapperOk ? "none" : "reconcile_now",
    });
    const slackBound = scope.optional_on_slack_bot;
    invariants.push({
      id: `team_scope.${scope.scope}.optional_on_slack_bot`,
      description: `${scope.scope} bound optional on ${slackBotClientId}`,
      group: "team-scope",
      source: isPersonal ? "init-token-exchange.sh" : "bff-migration",
      status: slackBound ? "pass" : "fail",
      detail: slackBound
        ? undefined
        : `Scope not listed in the Slack bot's optional client scopes. Reconcile now will bind it.`,
      remediation: slackBound ? "none" : "reconcile_now",
    });
    const webexBound = scope.optional_on_webex_bot;
    invariants.push({
      id: `team_scope.${scope.scope}.optional_on_webex_bot`,
      description: `${scope.scope} bound optional on ${webexBotClientId}`,
      group: "team-scope",
      source: isPersonal ? "init-token-exchange.sh" : "bff-migration",
      status: webexBound ? "pass" : "fail",
      detail: webexBound
        ? undefined
        : `Scope not listed in the Webex bot's optional client scopes. Reconcile now will bind it.`,
      remediation: webexBound ? "none" : "reconcile_now",
    });
    if (!isPersonal) {
      const audienceBound = scope.default_on_obo_audience;
      invariants.push({
        id: `team_scope.${scope.scope}.default_on_obo_audience`,
        description: `${scope.scope} bound default on ${oboAudienceClientId}`,
        group: "team-scope",
        source: "bff-migration",
        status: audienceBound ? "pass" : "fail",
        detail: audienceBound
          ? undefined
          : `Scope not listed in the OBO audience client's default scopes. Token exchange relies ` +
            `on the audience contributing the team scope as a default — Reconcile now will bind it.`,
        remediation: audienceBound ? "none" : "reconcile_now",
      });
    }
    // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
    // `team_personal.dm_mode_known_limitation` invariant: DM-mode no longer
    // relies on a token-exchange-injected `active_team` claim, so the
    // structural limitation it described no longer applies.
  }

  // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
  // `audience.<client>.single_team_default` audience-cardinality invariant.
  // The OBO audience client no longer needs at-most-one `team-*` default
  // scope because no service consumes the `active_team` claim. Operators
  // who still have legacy `team-*` scopes bound on the audience can clean
  // them up with `scripts/cleanup-team-keycloak-scopes.sh`.

  return invariants;
}

export interface KeycloakInvariantSummary {
  total: number;
  passing: number;
  failing: number;
  unknown: number;
  /** True iff any failing invariant has remediation === "reconcile_now". */
  reconcile_now_recommended: boolean;
}

export function summarizeKeycloakInvariants(
  invariants: KeycloakInvariant[]
): KeycloakInvariantSummary {
  let passing = 0;
  let failing = 0;
  let unknown = 0;
  let reconcileRecommended = false;
  for (const inv of invariants) {
    if (inv.status === "pass") passing += 1;
    else if (inv.status === "fail") {
      failing += 1;
      if (inv.remediation === "reconcile_now") reconcileRecommended = true;
    } else unknown += 1;
  }
  return {
    total: invariants.length,
    passing,
    failing,
    unknown,
    reconcile_now_recommended: reconcileRecommended,
  };
}
