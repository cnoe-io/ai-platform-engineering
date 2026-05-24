/**
 * Plain-English explainer for the migration warnings emitted by the
 * Keycloak RBAC reconciliation pipeline (see
 * `ui/src/lib/rbac/keycloak-rbac-reconciliation.ts` and
 * `ui/src/lib/rbac/keycloak-bootstrap-admins.ts`).
 *
 * Warnings end up in two places on the Admin → Security & Policy →
 * Keycloak panel:
 *
 *   1. The dedicated "Bootstrap admin reconciliation failed" amber
 *      bar at the top of the card, which renders one row per failed
 *      email (`<email>: <error>`).
 *   2. The general "Warnings" bar at the bottom of the card, which
 *      renders one row per migration warning (e.g. "Skipped
 *      active_team default selection because
 *      `KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` is unset and there is not
 *      exactly one Mongo team.").
 *
 * Both groups of strings are accurate but unfriendly to admins who
 * have not been living inside the RBAC system: they reference
 * uppercase env vars, internal phrases like "active_team default
 * selection", and ops-only concepts like "OBO audience client". This
 * decoder turns each known warning into a structured
 * `{ title, body, fix? }` tooltip explanation in the same "keep both
 * technical and plain-English" style we use for invariant IDs (see
 * `invariant-explanations.ts` for the wording-style policy).
 *
 * Design notes:
 *
 *   - The decoder is **pattern-based**, not exact-match: the raw
 *     warnings include captured values (email addresses, slugs,
 *     error text), so each family is matched with a regex that
 *     yields the captured params for the explanation.
 *   - Adding a new explainer means:
 *       1. add the warning string in `keycloak-rbac-reconciliation.ts`
 *          (or `keycloak-bootstrap-admins.ts`), and
 *       2. add a matching `WarningPattern` entry below.
 *     The tests in `warning-explanations.test.ts` lock in every
 *     family.
 *   - Unknown warnings still get a non-throwing generic explanation
 *     so the UI never blows up.
 *
 * The reason this lives next to the panel (rather than inside the
 * BFF migration code) is the same as for `invariant-explanations.ts`:
 * wording is presentation, not policy.
 */

/** Structured explanation rendered into the warning row's tooltip. */
export interface WarningExplanation {
  /** One-line title summarising the warning in plain English. */
  title: string;
  /** Two- to four-sentence body explaining what triggered it, why it matters, and what the system did instead. */
  body: string;
  /**
   * Optional "How to fix" sentence. Separated from the body so the
   * tooltip can lay it out with a visual divider — the body is "why
   * this is firing", the fix is "what to actually do".
   */
  fix?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Reusable glosses, mirrored from invariant-explanations.ts so the two
// modules speak the same plain-English vocabulary.
// ─────────────────────────────────────────────────────────────────────

const OBO_GLOSS = "OBO (on-behalf-of, i.e. the bot acting as a real user)";

const SHARED_AUDIENCE_GLOSS =
  "the `caipe-platform` client (the shared OBO audience — both the Slack bot and the Webex bot exchange their own service-account token for a user-impersonation token aimed at `caipe-platform`)";

const ACTIVE_TEAM_CLAIM_GLOSS =
  "`active_team` claim (the field in the OBO token that tells the bot which team identity to assume for this request)";

const SLUG_GLOSS =
  "team slug (a short, URL-safe team name like `platform` or `eti-sre-admin`)";

// ─────────────────────────────────────────────────────────────────────
// Pattern table. Each entry's `match` function is run against the raw
// warning string; the first match wins. `explain` receives the regex
// match (if any) so it can interpolate captured values.
// ─────────────────────────────────────────────────────────────────────

interface WarningPattern {
  /** Stable id for tests / telemetry, not shown to the user. */
  id: string;
  /** Regex tested against the raw warning text. */
  pattern: RegExp;
  /** Build the explanation, given the regex match against the raw warning. */
  explain(match: RegExpMatchArray): WarningExplanation;
}

const WARNING_PATTERNS: WarningPattern[] = [
  // ────────────────────────────────────────────────────────────────
  // KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG — emitted from
  // `keycloak-rbac-reconciliation.ts` when the BFF migration can't
  // decide which team scope should be the audience-default on
  // `caipe-platform`.
  //
  // There are two near-identical phrasings from the same code path:
  //
  //   "Skipped active_team default selection because
  //    KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG is unset and there is not
  //    exactly one Mongo team."
  //
  //   "No KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG configured and multiple/no
  //    Mongo teams exist; active_team default selection will be
  //    skipped."
  //
  // We catch both with a generous pattern keyed on the env var name.
  // ────────────────────────────────────────────────────────────────
  {
    id: "active_team_slug_unset",
    pattern: /KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG/,
    explain: () => ({
      title:
        "`KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG` is not set — no team is being used as the default `active_team`",
      body:
        `This warning fires when the BFF (the UI server) startup migration ` +
        `couldn't decide which team scope should be the *audience-default* ` +
        `on ${SHARED_AUDIENCE_GLOSS}. ` +
        `That default scope is what stamps the ${ACTIVE_TEAM_CLAIM_GLOSS} ` +
        `into every ${OBO_GLOSS} token the bots issue, because Keycloak's ` +
        `OAuth2 / RFC 8693 token-exchange flow ignores the bot's requested ` +
        `\`scope=\` parameter and only injects mappers from scopes that are ` +
        `*default* on the audience. The migration safely skips the selection ` +
        `(rather than guessing) whenever \`KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG\` ` +
        `is unset AND there is not exactly one team in MongoDB. With ` +
        `multiple teams and no default chosen, OBO tokens will lack an ` +
        `\`active_team\` claim, so the bots fall back to personal / ` +
        `tokenless mode for every channel that maps to a team.`,
      fix:
        `Set the \`KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG\` environment variable on ` +
        `the \`caipe-ui\` deployment to the ${SLUG_GLOSS} of the team that ` +
        `should be the default. For example, if your main team's slug is ` +
        `\`platform\`, set \`KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG=platform\`. ` +
        `Then click \`Reconcile all\` (or restart the UI pod) — the ` +
        `migration will bind \`team-platform\` as the single default ` +
        `\`team-*\` scope on \`caipe-platform\` and the warning goes ` +
        `away. If you really do operate with a single team in MongoDB, ` +
        `you can leave the env var unset: the migration auto-picks that ` +
        `team as the default in the single-team case.`,
    }),
  },

  // ────────────────────────────────────────────────────────────────
  // Bootstrap admin — per-email failure pushed from
  // `keycloak-bootstrap-admins.ts`: `${email}: ${error message}`.
  //
  // We deliberately match very loosely (any string that looks like
  // "<email>: <something>") and rely on this being inside the
  // "Bootstrap admin reconciliation failed" bar — i.e. the panel
  // only ever feeds bootstrap warnings into this branch.
  // ────────────────────────────────────────────────────────────────
  {
    id: "bootstrap_admin_email_failed",
    pattern: /^\s*([^\s:][^\s@]*@[^\s:]+)\s*:\s*(.+)$/,
    explain: (match) => {
      const email = match[1];
      const error = match[2];
      return {
        title: `Couldn't seed \`${email}\` as a bootstrap admin`,
        body:
          `Bootstrap admin emails are listed in the \`BOOTSTRAP_ADMIN_EMAILS\` ` +
          `(or \`RBAC_BOOTSTRAP_ADMIN_EMAILS\`) environment variable on the ` +
          `\`caipe-ui\` deployment and are seeded as realm admins on every ` +
          `startup so an empty Keycloak realm always has at least one ` +
          `human who can sign in and manage things. For each email, the ` +
          `migration looks up a Keycloak user with that email (creating a ` +
          `placeholder user if none exists) and writes the OpenFGA tuples ` +
          `that grant them admin access. ` +
          `For \`${email}\` that handshake failed with: \`${error}\`. The ` +
          `migration left every other admin alone and surfaced this warning ` +
          `instead of failing the whole run.`,
        fix:
          `Read the error fragment above to figure out what specifically ` +
          `went wrong. Common causes: (1) a typo in the email — fix it in ` +
          `the \`BOOTSTRAP_ADMIN_EMAILS\` env var and restart; (2) Keycloak's ` +
          `user-profile policy is rejecting the placeholder user — check ` +
          `\`KEYCLOAK_USER_PROFILE_UNMANAGED_ATTRIBUTE_POLICY\` (it should be ` +
          `\`ADMIN_VIEW\` or laxer); (3) OpenFGA is unreachable — check the ` +
          `OpenFGA tab and the supervisor logs; (4) the user already exists ` +
          `but with a *different* email casing — Keycloak email lookup is ` +
          `case-sensitive in some configurations. After fixing the cause, ` +
          `click \`Reconcile all\` to retry; this warning clears as soon ` +
          `as the email resolves cleanly.`,
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────
// Header explainers — exposed separately so panel section headers
// (e.g. the "Bootstrap admin reconciliation failed" bar) can host a
// HelpCircle that explains the *concept*, independent of any specific
// failing row.
// ─────────────────────────────────────────────────────────────────────

export const BOOTSTRAP_ADMIN_HEADER_EXPLANATION: WarningExplanation = {
  title: "What is bootstrap admin reconciliation?",
  body:
    `On every startup the BFF (the UI server) re-runs a small migration ` +
    `that takes the list of emails in the \`BOOTSTRAP_ADMIN_EMAILS\` ` +
    `(or \`RBAC_BOOTSTRAP_ADMIN_EMAILS\`) environment variable, looks up ` +
    `each one in Keycloak (creating a placeholder user with that email if ` +
    `none exists), and writes the OpenFGA tuples that grant them admin ` +
    `access to this realm. This is what guarantees that a brand-new ` +
    `deployment with an empty Keycloak realm always has at least one human ` +
    `who can sign in and reach this admin panel — without it you'd be ` +
    `locked out the moment you spin the stack up. Failed-for-N rows here ` +
    `mean N of those emails couldn't be resolved or seeded; the rest of ` +
    `the admin set is unaffected, and the migration retries on the next ` +
    `start or every time you click \`Reconcile all\`.`,
  fix:
    `Each failed row prints the failing email and the underlying error in ` +
    `the list below the header. Hover the \`?\` next to a row for a ` +
    `detailed explanation and common fixes. Once the email resolves ` +
    `cleanly, click \`Reconcile all\` (or restart \`caipe-ui\`) to retry.`,
};

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Return a hover-friendly explanation for a raw migration warning
 * string. Falls back to a safe generic explanation when no pattern
 * matches so the panel never blows up on a new warning string.
 */
export function explainWarning(raw: string): WarningExplanation {
  const trimmed = raw.trim();
  for (const entry of WARNING_PATTERNS) {
    const match = trimmed.match(entry.pattern);
    if (match) {
      return entry.explain(match);
    }
  }
  return {
    title: "Migration warning",
    body:
      `This warning was raised by the BFF (the UI server) startup ` +
      `migration but does not have a plain-English explanation registered ` +
      `yet. The raw text above is the authoritative description. If you ` +
      `see this frequently, add a matching entry to \`WARNING_PATTERNS\` ` +
      `in \`ui/src/components/admin/warning-explanations.ts\` so future ` +
      `admins get a real explanation.`,
  };
}

/**
 * Return the id of the matching pattern (or `null` for the fallback
 * path). Exposed so tests can pin which family handled each canonical
 * warning string without re-running the explain step.
 */
export function classifyWarning(raw: string): string | null {
  const trimmed = raw.trim();
  for (const entry of WARNING_PATTERNS) {
    if (entry.pattern.test(trimmed)) return entry.id;
  }
  return null;
}
