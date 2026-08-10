/**
 * Plain-English explainer for the Keycloak realm invariant IDs emitted
 * by `ui/src/lib/rbac/keycloak-invariants.ts`.
 *
 * Each invariant row in the Admin → Security & Policy → Keycloak panel
 * carries a stable machine ID like `obo.token_exchange.shared_audience.exists`
 * and a one-line description. The IDs are accurate but cryptic to humans
 * (especially the team-scope and per-bot families), and the one-line
 * description doesn't say *why* the check matters or *what breaks* when
 * it fails.
 *
 * This module is a pure ID → `InvariantExplanation` decoder. It is
 * intentionally co-located with the panel (rather than emitted from the
 * BFF) because:
 *
 * 1. Wording is presentation, not policy — keeping it next to the panel
 *    avoids API contract churn every time we improve a sentence.
 * 2. Parametric IDs (`team_scope.<slug>.…`, `obo.token_exchange.<client>.…`,
 *    `service_account.<client>.…`) decompose cleanly into a "family +
 *    captured params" shape on the client.
 * 3. Tests can pin every family + every fixed ID without spinning up a
 *    Keycloak fixture.
 *
 * If a new invariant ID is added in `keycloak-invariants.ts` without a
 * matching family here, `explainInvariant` returns a safe generic
 * fallback — the UI still works, the tooltip just becomes less helpful.
 * The decoder tests below assert every emitted ID is recognised, so the
 * generic fallback should never ship.
 *
 * Wording style — "keep both technical and plain-English":
 *
 *   Every tooltip body is written for an admin who hasn't been living
 *   inside the RBAC system. We do NOT strip the technical names (OBO,
 *   token exchange, AFFIRMATIVE, RFC 8693, `caipe-platform`, etc.) —
 *   engineers need them to
 *   grep, and the raw invariant ID is already rendered in mono right
 *   under the description by the panel itself. Instead, each body:
 *
 *     1. Opens with a one-sentence plain-English statement of what the
 *        check is verifying ("This row checks that …").
 *     2. Defines each unavoidable technical term inline the first time
 *        it appears, in the shape `term (plain-English gloss)`.
 *     3. Closes with a one-sentence statement of what breaks if the
 *        row is red, in plain English.
 *
 *   The unit tests pin all the technical strings, so the shape "term
 *   (gloss)" is enforced — if a future edit drops a keyword the build
 *   breaks before it ships.
 */

/** Structured explanation rendered into the row's hover tooltip. */
export interface InvariantExplanation {
  /** One-line title (`What is this checking?`). */
  title: string;
  /** Two- to four-sentence body covering what the check verifies (in plain English), why it matters, and what breaks if it fails. */
  body: string;
}

// ─────────────────────────────────────────────────────────────────────
// Reusable glosses. Centralising the wording keeps the tooltips
// consistent (every body says "OBO" the same way, every body explains
// "slug" the same way) and means future copy edits land in one place.
// ─────────────────────────────────────────────────────────────────────

/** First-mention gloss for "OBO" inside a body. */
const OBO_GLOSS = "OBO (on-behalf-of, i.e. the bot acting as a real user)";

/**
 * First-mention gloss for "token exchange". OAuth2 / RFC 8693 jargon
 * for "swap one token for another", which is how the bot gets a
 * user-shaped token from its own service-account token.
 */
const TOKEN_EXCHANGE_GLOSS =
  "token exchange (the OAuth2 / RFC 8693 flow that swaps the bot's own login token for a user-shaped one)";

/**
 * First-mention gloss for the shared OBO audience client. Used by both
 * the Slack-bot and Webex-bot paths.
 */
const SHARED_AUDIENCE_GLOSS =
  "the `caipe-platform` client (the shared OBO audience — both the Slack bot and the Webex bot exchange their own service-account token for a user-impersonation token aimed at `caipe-platform`)";

/** First-mention gloss for "scope-permission" inside a body. */
const SCOPE_PERMISSION_GLOSS =
  "scope-permission (a Keycloak authorization rule attached to a client that gates whether token-exchange is allowed at all)";

/** First-mention gloss for "policy" inside a body. */
const POLICY_GLOSS =
  "policy (a Keycloak rule that says *which* callers are allowed to use a permission — a `type=client` policy keys on the calling clientId)";

/** First-mention gloss for AFFIRMATIVE vs UNANIMOUS. */
const DECISION_STRATEGY_GLOSS =
  "decision strategy (Keycloak evaluates the policies attached to a permission with either AFFIRMATIVE — any one policy may allow — or UNANIMOUS — every policy must allow)";

/** First-mention gloss for "service account". */
const SERVICE_ACCOUNT_GLOSS =
  "service account (the bot's own machine-user identity inside Keycloak, separate from any human user)";

/** First-mention gloss for "client scope". */
// ─────────────────────────────────────────────────────────────────────
// Anchor sentences. Bodies compose a plain-English opener + the
// reusable glosses + the structural "what breaks" closer below.
// ─────────────────────────────────────────────────────────────────────

const SHARED_AUDIENCE_OPENER =
  "This row checks that the shared spot where both bots ask Keycloak to mint user-impersonation tokens is correctly set up.";

const PER_BOT_OPENER =
  "This row checks that this specific bot client is itself allowed to mint user-impersonation tokens.";

const USERS_IMPERSONATE_OPENER =
  "This row checks that Keycloak's realm-wide \"may impersonate users\" gate is correctly set up — without it, no client can ever act on behalf of a user, no matter how the per-bot permissions are configured.";

/**
 * Return a hover-friendly explanation for an invariant ID.
 *
 * The function is pure: same ID in → same explanation out. It handles
 * both fixed IDs (e.g. `obo.users_impersonate.exists`) and parametric
 * families with embedded clientId / scope-name segments.
 */
export function explainInvariant(id: string): InvariantExplanation {
  // ─────────────────────────────────────────────────────────────
  // OBO — Shared audience (caipe-platform) token-exchange
  // ─────────────────────────────────────────────────────────────
  if (id === "obo.token_exchange.shared_audience.exists") {
    return {
      title: "Shared OBO audience permission exists",
      body:
        `${SHARED_AUDIENCE_OPENER} Specifically, it verifies that a ` +
        `${TOKEN_EXCHANGE_GLOSS} ${SCOPE_PERMISSION_GLOSS} exists on ` +
        `${SHARED_AUDIENCE_GLOSS}. If it is missing, every ${OBO_GLOSS} ` +
        `request from every bot is denied with "Client not allowed to ` +
        `exchange tokens" and the bot can't act as a user.`,
    };
  }
  if (id === "obo.token_exchange.shared_audience.affirmative") {
    return {
      title: "Shared OBO audience uses AFFIRMATIVE decision strategy",
      body:
        `${SHARED_AUDIENCE_OPENER} It verifies that the shared token-exchange ` +
        `permission on ${SHARED_AUDIENCE_GLOSS} uses the AFFIRMATIVE ` +
        `${DECISION_STRATEGY_GLOSS}. This permission MUST use AFFIRMATIVE ` +
        `because both bot client-allowlist policies are attached — one for ` +
        `the Slack bot and one for the Webex bot — and only one of them is ` +
        `ever the caller. Under UNANIMOUS, every request would be denied ` +
        `because the "other" bot's ${POLICY_GLOSS} never authorises the ` +
        `caller.`,
    };
  }
  if (id === "obo.token_exchange.shared_audience.policies_strict") {
    return {
      title: "Shared OBO audience uses only strict client-allowlist policies",
      body:
        `${SHARED_AUDIENCE_OPENER} It verifies the *shape* of every ${POLICY_GLOSS} ` +
        `attached to the shared token-exchange permission: each must be a ` +
        `\`type=client\` policy whose \`clients\` allow-list resolves to a known ` +
        `bot clientId. Any other policy type (role, group, time, JS) would ` +
        `either weaken the allow-list or fail closed under AFFIRMATIVE, so it ` +
        `is rejected here. If this is red, OBO requests behave unpredictably — ` +
        `they may be allowed for callers we did not intend, or silently denied.`,
    };
  }
  if (id === "obo.token_exchange.shared_audience.slack_policy_attached") {
    return {
      title: "Slack bot client-allowlist policy is attached to the shared OBO audience",
      body:
        `${SHARED_AUDIENCE_OPENER} For the Slack bot to be authorised against ` +
        `${SHARED_AUDIENCE_GLOSS}, a ${POLICY_GLOSS} whose \`clients\` list ` +
        `contains \`caipe-slack-bot\` must be attached to that audience's ` +
        `${TOKEN_EXCHANGE_GLOSS} permission. If it's missing or replaced ` +
        `with an unrelated policy, every Slack-bot ${OBO_GLOSS} call returns ` +
        `403 — the bot can chat, but it can't act as the real user behind ` +
        `the message.`,
    };
  }
  if (id === "obo.token_exchange.shared_audience.webex_policy_attached") {
    return {
      title: "Webex bot client-allowlist policy is attached to the shared OBO audience",
      body:
        `${SHARED_AUDIENCE_OPENER} Same shape as the Slack-side check, but ` +
        `for the Webex bot — a ${POLICY_GLOSS} whose \`clients\` list contains ` +
        `\`caipe-webex-bot\` must be attached to the shared token-exchange ` +
        `permission. Without it, every Webex-bot ${OBO_GLOSS} request is ` +
        `denied with "Client not allowed to exchange tokens".`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Per-bot token-exchange permissions (the bot's OWN client owns
  // a second `token-exchange` permission, distinct from the shared
  // audience permission above).
  //
  // The parametric segment is the bot's clientId. We skip the
  // "shared_audience" value so the fixed handlers above always
  // win for that case.
  // ─────────────────────────────────────────────────────────────
  const perBotExists = id.match(/^obo\.token_exchange\.(.+)\.exists$/);
  if (perBotExists && perBotExists[1] !== "shared_audience") {
    const bot = perBotExists[1];
    return {
      title: `Per-bot token-exchange permission exists on ${bot}`,
      body:
        `${PER_BOT_OPENER} It verifies that the \`${bot}\` client itself owns ` +
        `a ${TOKEN_EXCHANGE_GLOSS} ${SCOPE_PERMISSION_GLOSS}, separate from ` +
        `the one on the shared audience. Keycloak checks both — the per-bot ` +
        `one AND the shared audience one — before issuing an ${OBO_GLOSS} ` +
        `token. If the per-bot permission is missing, the bot can't ` +
        `impersonate any user even when everything else is configured ` +
        `correctly.`,
    };
  }
  const perBotAffirmative = id.match(/^obo\.token_exchange\.(.+)\.affirmative$/);
  if (perBotAffirmative && perBotAffirmative[1] !== "shared_audience") {
    const bot = perBotAffirmative[1];
    return {
      title: `Per-bot token-exchange permission uses AFFIRMATIVE on ${bot}`,
      body:
        `${PER_BOT_OPENER} It verifies that \`${bot}\`'s own ` +
        `${TOKEN_EXCHANGE_GLOSS} permission uses the AFFIRMATIVE ` +
        `${DECISION_STRATEGY_GLOSS}, so a single ${POLICY_GLOSS} whose ` +
        `\`clients\` list contains \`${bot}\` is enough to authorise the ` +
        `request. Under UNANIMOUS, any future policy added to the same ` +
        `permission would silently start blocking OBO for that bot.`,
    };
  }
  const perBotStrict = id.match(/^obo\.token_exchange\.(.+)\.policies_strict$/);
  if (perBotStrict && perBotStrict[1] !== "shared_audience") {
    const bot = perBotStrict[1];
    return {
      title: `Per-bot token-exchange permission uses only strict client-allowlist policies on ${bot}`,
      body:
        `${PER_BOT_OPENER} Same *shape* rule as the shared audience: every ` +
        `${POLICY_GLOSS} attached to \`${bot}\`'s own ${TOKEN_EXCHANGE_GLOSS} ` +
        `permission must be a \`type=client\` policy whose \`clients\` ` +
        `allow-list contains \`${bot}\`. Anything else (role policies, ` +
        `JS policies) weakens the audit story and is flagged here.`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // OBO — Realm-wide users.impersonate gate
  // ─────────────────────────────────────────────────────────────
  if (id === "obo.users_impersonate.exists") {
    return {
      title: "Realm-level users.impersonate permission exists",
      body:
        `${USERS_IMPERSONATE_OPENER} Keycloak ships a built-in realm-level ` +
        `\`users.impersonate\` ${SCOPE_PERMISSION_GLOSS} that gates *all* ` +
        `user impersonation regardless of audience. It must exist and be ` +
        `enabled. If it's missing, no client (bot or otherwise) can ever ` +
        `issue an ${OBO_GLOSS} token, even when their per-bot and shared ` +
        `audience permissions are perfectly configured.`,
    };
  }
  if (id === "obo.users_impersonate.affirmative") {
    return {
      title: "users.impersonate permission uses AFFIRMATIVE decision strategy",
      body:
        `${USERS_IMPERSONATE_OPENER} Same rationale as the shared audience ` +
        `check: both bot client-allowlist policies are attached to ` +
        `\`users.impersonate\` (each bot is a legitimate impersonator), ` +
        `and only one applies per request — so the permission MUST use the ` +
        `AFFIRMATIVE ${DECISION_STRATEGY_GLOSS}. Under UNANIMOUS, every ` +
        `request would be denied because the other bot's ${POLICY_GLOSS} ` +
        `never authorises the caller.`,
    };
  }
  if (id === "obo.users_impersonate.policies_strict") {
    return {
      title: "users.impersonate permission uses only strict client-allowlist policies",
      body:
        `${USERS_IMPERSONATE_OPENER} It verifies the *shape* of every ` +
        `${POLICY_GLOSS} attached to the realm-wide \`users.impersonate\` ` +
        `permission: each must be a \`type=client\` policy whose ` +
        `\`clients\` allow-list resolves to a known bot clientId. This is ` +
        `the realm-wide impersonation gate, so a single weak policy attached ` +
        `here would let *any* client in the allow-list impersonate *any* ` +
        `user — much broader blast radius than a per-bot mistake.`,
    };
  }
  const usersImpersonateAttached = id.match(/^obo\.users_impersonate\.(.+)_policy_attached$/);
  if (usersImpersonateAttached) {
    const bot = usersImpersonateAttached[1];
    return {
      title: `${bot} client-allowlist policy is attached to users.impersonate`,
      body:
        `${USERS_IMPERSONATE_OPENER} For \`${bot}\` to impersonate any user, ` +
        `a ${POLICY_GLOSS} whose \`clients\` list contains \`${bot}\` must be ` +
        `attached to the realm-wide \`users.impersonate\` permission. If ` +
        `this attachment is missing, every ${OBO_GLOSS} call from that bot ` +
        `is denied at the realm gate — before the per-audience and per-bot ` +
        `policies are even evaluated.`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // OBO — Per-bot self-policy attachments on the bot's OWN
  // token-exchange permission and on users.impersonate.
  // ─────────────────────────────────────────────────────────────
  const botSelfTokenExchange = id.match(/^obo\.bot\.(.+)\.token_exchange_policy_attached$/);
  if (botSelfTokenExchange) {
    const bot = botSelfTokenExchange[1];
    return {
      title: `${bot}'s own client-allowlist policy is attached to its token-exchange permission`,
      body:
        `${PER_BOT_OPENER} It verifies that the specific ${POLICY_GLOSS} named ` +
        `\`${bot}-token-exchange\` (a \`type=client\` policy whose \`clients\` ` +
        `list is exactly \`[${bot}]\`) is attached to the ${TOKEN_EXCHANGE_GLOSS} ` +
        `permission on \`${bot}\`. Without that attachment the bot can't ` +
        `authenticate itself for the OBO exchange — its own permission ` +
        `exists, but no policy says it's allowed to use it.`,
    };
  }
  const botUsersImpersonate = id.match(/^obo\.bot\.(.+)\.users_impersonate_policy_attached$/);
  if (botUsersImpersonate) {
    const bot = botUsersImpersonate[1];
    return {
      title: `${bot}'s own client-allowlist policy is attached to users.impersonate`,
      body:
        `${USERS_IMPERSONATE_OPENER} Same shape as the previous check, but ` +
        `on the realm-wide \`users.impersonate\` permission instead of the ` +
        `per-bot one. \`${bot}\` needs BOTH attachments — the per-bot ` +
        `${TOKEN_EXCHANGE_GLOSS} attachment AND this realm-wide ` +
        `users.impersonate attachment — for ${OBO_GLOSS} to succeed.`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Service-account realm-management role
  // ─────────────────────────────────────────────────────────────
  const serviceAccount = id.match(/^service_account\.(.+)\.impersonation_role$/);
  if (serviceAccount) {
    const bot = serviceAccount[1];
    return {
      title: `${bot}'s service account has the realm impersonation role`,
      body:
        `This row checks that the bot's own machine-user identity inside ` +
        `Keycloak is allowed to act as other users at all. Each bot client ` +
        `has a ${SERVICE_ACCOUNT_GLOSS} called \`service-account-${bot}\` ` +
        `that initiates ${OBO_GLOSS}, and it MUST hold the \`impersonation\` ` +
        `role from the built-in \`realm-management\` client. Without that ` +
        `role the bot's token exchange fails with "User not allowed to ` +
        `impersonate" — even when every ${SCOPE_PERMISSION_GLOSS} and ` +
        `policy attachment is otherwise correct.`,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Fallback — keeps the UI working if a new ID lands without a
  // matching family above. Tests guard against this shipping.
  // ─────────────────────────────────────────────────────────────
  return {
    title: id,
    body:
      `No plain-English explanation is registered for this invariant ID yet. ` +
      `Cross-reference \`ui/src/lib/rbac/keycloak-invariants.ts\` for what the ` +
      `check verifies and add an entry to \`explainInvariant\` in ` +
      `\`ui/src/components/admin/invariant-explanations.ts\` to remove this ` +
      `fallback.`,
  };
}
