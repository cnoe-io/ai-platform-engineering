import { explainInvariant } from "../invariant-explanations";

/**
 * Decoder tests for the Keycloak invariant ID → plain-English explainer
 * used by the Admin → Security & Policy → Keycloak panel tooltip.
 *
 * The decoder is the only consumer-facing rendering of these IDs that
 * non-engineers will see, so this file exercises:
 *
 * 1. Every fixed ID emitted by `keycloak-invariants.ts` (no fallback
 *    text should ever leak into a real run).
 * 2. Every parametric family — with `caipe-slack-bot`, `caipe-webex-bot`,
 *    a representative team slug, and the structural `team-personal`
 *    special-case where the wording differs.
 * 3. The fallback path (so an unknown ID returns a safe stub, never
 *    throws).
 *
 * If a new invariant ID is added to `keycloak-invariants.ts`, the
 * decoder must be extended to recognise it; this file is the guardrail.
 */
describe("explainInvariant", () => {
  describe("fixed IDs", () => {
    const fixedIds = [
      "obo.token_exchange.shared_audience.exists",
      "obo.token_exchange.shared_audience.affirmative",
      "obo.token_exchange.shared_audience.policies_strict",
      "obo.token_exchange.shared_audience.slack_policy_attached",
      "obo.token_exchange.shared_audience.webex_policy_attached",
      "obo.users_impersonate.exists",
      "obo.users_impersonate.affirmative",
      "obo.users_impersonate.policies_strict",
      // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed
      // `team_personal.dm_mode_known_limitation`.
    ];

    it.each(fixedIds)(
      "produces a non-fallback explanation for the fixed ID %s",
      (id) => {
        const result = explainInvariant(id);
        expect(result.title).not.toBe(id);
        expect(result.title.length).toBeGreaterThan(0);
        // Body must be a real sentence (the fallback returns a generic
        // "No plain-English explanation is registered" string).
        expect(result.body).not.toMatch(/No plain-English explanation is registered/);
        expect(result.body.length).toBeGreaterThan(40);
      },
    );

    it("decodes obo.token_exchange.shared_audience.affirmative with both the AFFIRMATIVE rationale and the per-bot policy context", () => {
      const result = explainInvariant("obo.token_exchange.shared_audience.affirmative");
      expect(result.title).toMatch(/AFFIRMATIVE/);
      expect(result.body).toMatch(/UNANIMOUS/);
      expect(result.body).toMatch(/Slack/);
      expect(result.body).toMatch(/Webex/);
    });

    it("calls out the realm-wide blast radius of users.impersonate.policies_strict", () => {
      const result = explainInvariant("obo.users_impersonate.policies_strict");
      expect(result.body).toMatch(/realm-wide/);
      expect(result.body).toMatch(/impersonat/);
    });

    // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
    // `team_personal.dm_mode_known_limitation` advisory invariant and its
    // explanation entry.
  });

  describe("per-bot OBO families", () => {
    const bots = ["caipe-slack-bot", "caipe-webex-bot"];

    it.each(bots)("explains obo.token_exchange.%s.exists with the bot's own clientId in the title", (bot) => {
      const result = explainInvariant(`obo.token_exchange.${bot}.exists`);
      expect(result.title).toContain(bot);
      expect(result.body).toContain(bot);
    });

    it.each(bots)("explains obo.token_exchange.%s.affirmative referencing per-bot AFFIRMATIVE rationale", (bot) => {
      const result = explainInvariant(`obo.token_exchange.${bot}.affirmative`);
      expect(result.title).toContain(bot);
      expect(result.title).toMatch(/AFFIRMATIVE/);
    });

    it.each(bots)("explains obo.token_exchange.%s.policies_strict with the bot in scope", (bot) => {
      const result = explainInvariant(`obo.token_exchange.${bot}.policies_strict`);
      expect(result.title).toContain(bot);
      expect(result.body).toContain(bot);
    });

    it.each(bots)("explains obo.users_impersonate.%s_policy_attached", (bot) => {
      const result = explainInvariant(`obo.users_impersonate.${bot}_policy_attached`);
      expect(result.title).toContain(bot);
      expect(result.body).toMatch(/users\.impersonate/);
    });

    it.each(bots)("explains obo.bot.%s.token_exchange_policy_attached", (bot) => {
      const result = explainInvariant(`obo.bot.${bot}.token_exchange_policy_attached`);
      expect(result.title).toContain(bot);
      expect(result.body).toContain(`${bot}-token-exchange`);
    });

    it.each(bots)("explains obo.bot.%s.users_impersonate_policy_attached", (bot) => {
      const result = explainInvariant(`obo.bot.${bot}.users_impersonate_policy_attached`);
      expect(result.title).toContain(bot);
      expect(result.body).toMatch(/users\.impersonate/);
    });

    it("does NOT collide the per-bot exists check with the shared_audience exists check", () => {
      const shared = explainInvariant("obo.token_exchange.shared_audience.exists");
      const perBot = explainInvariant("obo.token_exchange.caipe-slack-bot.exists");
      expect(shared.title).not.toEqual(perBot.title);
      expect(shared.body).not.toEqual(perBot.body);
    });
  });

  describe("service accounts", () => {
    it("explains the realm impersonation role for a bot's service account", () => {
      const result = explainInvariant("service_account.caipe-slack-bot.impersonation_role");
      expect(result.title).toContain("caipe-slack-bot");
      expect(result.title).toMatch(/impersonation role/);
      expect(result.body).toContain("service-account-caipe-slack-bot");
      expect(result.body).toMatch(/realm-management/);
    });
  });

  describe("team scope families", () => {
    it("explains team_scope.<slug>.active_team_mapper for a normal team", () => {
      const result = explainInvariant("team_scope.team-platform.active_team_mapper");
      expect(result.title).toContain("team-platform");
      expect(result.body).toMatch(/active_team/);
      expect(result.body).toMatch(/Reconcile/);
      // For non-personal teams the body should NOT say `__personal__`.
      expect(result.body).not.toContain("__personal__");
    });

    it("explains team_scope.team-personal.active_team_mapper with the __personal__ DM marker", () => {
      const result = explainInvariant("team_scope.team-personal.active_team_mapper");
      expect(result.title).toContain("team-personal");
      expect(result.body).toContain("__personal__");
      expect(result.body).toMatch(/DM|personal mode/);
    });

    it("explains team_scope.<slug>.optional_on_slack_bot", () => {
      const result = explainInvariant("team_scope.team-platform.optional_on_slack_bot");
      expect(result.title).toContain("team-platform");
      expect(result.title).toMatch(/Slack/);
      expect(result.body).toMatch(/active_team/);
    });

    it("explains team_scope.<slug>.optional_on_webex_bot", () => {
      const result = explainInvariant("team_scope.team-platform.optional_on_webex_bot");
      expect(result.title).toContain("team-platform");
      expect(result.title).toMatch(/Webex/);
    });

    it("explains team_scope.<slug>.default_on_obo_audience and references the RFC 8693 gotcha", () => {
      const result = explainInvariant("team_scope.team-platform.default_on_obo_audience");
      expect(result.title).toContain("team-platform");
      expect(result.body).toMatch(/RFC 8693/);
      expect(result.body).toMatch(/caipe-platform/);
      expect(result.body).toMatch(/active_team/);
    });

    // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
    // `audience.<client>.single_team_default` family — both the invariant
    // and the explanation entry are gone now that nothing consumes the
    // `active_team` claim.
  });

  describe("fallback", () => {
    it("returns a safe stub (and does not throw) for an unknown ID", () => {
      const result = explainInvariant("totally.made.up.invariant.id");
      expect(result.title).toBe("totally.made.up.invariant.id");
      expect(result.body).toMatch(/No plain-English explanation is registered/);
      // The fallback body must include the path to extend the decoder so
      // an engineer finds it without grepping for the literal text.
      expect(result.body).toContain("invariant-explanations.ts");
    });
  });

  // ─────────────────────────────────────────────────────────────
  // "Keep both" wording contract.
  //
  // The user requirement is that every tooltip body keep BOTH the
  // technical term (so engineers can grep and so the wording matches
  // the raw invariant ID rendered below the description) AND a plain-
  // English gloss (so an admin who hasn't been living inside the RBAC
  // system can still make sense of it).
  //
  // These tests pin the most common jargon → gloss pairings. They are
  // intentionally fuzzy on exact phrasing — the assertion is "the
  // gloss must appear somewhere in the body that uses the term", not
  // "use exactly these words" — so we can iterate copy without test
  // churn but we still catch a future edit that strips the plain-
  // English half.
  //
  // Convention: each pair is `[regex matching the technical term in a
  // body that should also gloss it, regex matching the plain-English
  // gloss expected somewhere in that same body]`. We sample one
  // representative invariant ID per term so we don't need to spell out
  // every cross product.
  // ─────────────────────────────────────────────────────────────
  describe("technical-term + plain-English gloss pairings", () => {
    type GlossCase = {
      label: string;
      id: string;
      term: RegExp;
      gloss: RegExp;
    };

    const cases: GlossCase[] = [
      {
        label: "OBO is glossed as on-behalf-of",
        id: "obo.token_exchange.shared_audience.exists",
        term: /OBO/,
        gloss: /on-behalf-of/i,
      },
      {
        label: "token exchange is glossed with OAuth2 / RFC 8693",
        id: "obo.token_exchange.shared_audience.exists",
        term: /token exchange|token-exchange/i,
        gloss: /OAuth2 \/ RFC 8693|RFC 8693/,
      },
      {
        label: "scope-permission is glossed as a Keycloak authorization rule",
        id: "obo.token_exchange.shared_audience.exists",
        term: /scope-permission/,
        gloss: /Keycloak authorization rule/i,
      },
      {
        label: "policy is glossed with `type=client` keyed on the calling clientId",
        id: "obo.token_exchange.shared_audience.policies_strict",
        term: /policy/i,
        gloss: /type=client|calling clientId/i,
      },
      {
        label: "AFFIRMATIVE / UNANIMOUS are glossed as decision strategy",
        id: "obo.token_exchange.shared_audience.affirmative",
        term: /AFFIRMATIVE/,
        gloss: /any one policy may allow|every policy must allow|decision strategy/i,
      },
      {
        label: "service account is glossed as the bot's machine-user identity",
        id: "service_account.caipe-slack-bot.impersonation_role",
        term: /service account/i,
        gloss: /machine-user identity/i,
      },
      {
        label: "client scope is glossed as a reusable bundle of token settings",
        id: "team_scope.team-platform.optional_on_slack_bot",
        term: /client scope/i,
        gloss: /reusable bundle|bundle of token settings/i,
      },
      {
        label: "slug is glossed as a short, URL-safe team name",
        id: "team_scope.team-platform.active_team_mapper",
        term: /slug/i,
        gloss: /short, URL-safe team name/i,
      },
      {
        label: "protocol mapper is glossed as injecting an extra claim into the token",
        id: "team_scope.team-platform.active_team_mapper",
        term: /protocol mapper/i,
        gloss: /injects an extra claim|labeled field/i,
      },
      {
        label: "`active_team` claim is glossed as which team identity the bot assumes",
        id: "team_scope.team-platform.default_on_obo_audience",
        term: /active_team/,
        gloss: /which team identity to assume/i,
      },
      {
        label: "`caipe-platform` is glossed as the shared OBO audience",
        id: "obo.token_exchange.shared_audience.exists",
        term: /caipe-platform/,
        gloss: /shared OBO audience/i,
      },
      {
        label: "RFC 8693 is glossed as the OAuth2 token-exchange flow",
        id: "team_scope.team-platform.default_on_obo_audience",
        term: /RFC 8693/,
        gloss: /OAuth2|token.exchange flow/i,
      },
      {
        label: "BFF is glossed as the UI server",
        id: "team_scope.team-platform.default_on_obo_audience",
        term: /BFF/,
        gloss: /UI server/i,
      },
      // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed the
      // `team_personal.dm_mode_known_limitation` advisory invariant and its
      // gloss row. The `__personal__` value lives on as a legacy mapper value
      // surfaced by the per-scope invariants only; we no longer test for
      // its gloss because the special-case explanation block is gone.
    ];

    it.each(cases)(
      "$label",
      ({ id, term, gloss }) => {
        const result = explainInvariant(id);
        // The technical term must still appear so engineers can grep
        // and so the body reads as authoritative.
        expect(result.body).toMatch(term);
        // …and a plain-English gloss must appear in the same body so
        // a non-RBAC-engineer reader can make sense of the term.
        expect(result.body).toMatch(gloss);
      },
    );

    it("every body opens with a plain-English 'This row checks' / 'This is an advisory row' / 'Same as' opener — never with raw jargon", () => {
      // Sample one body from each major family and assert the opener
      // does not lead with a technical noun. The wording style policy
      // is documented at the top of invariant-explanations.ts.
      const samples = [
        "obo.token_exchange.shared_audience.exists",
        "obo.token_exchange.caipe-slack-bot.affirmative",
        "obo.users_impersonate.exists",
        "obo.users_impersonate.caipe-slack-bot_policy_attached",
        "obo.bot.caipe-slack-bot.token_exchange_policy_attached",
        "service_account.caipe-slack-bot.impersonation_role",
        "team_scope.team-platform.active_team_mapper",
        "team_scope.team-platform.optional_on_slack_bot",
        "team_scope.team-platform.optional_on_webex_bot",
        "team_scope.team-platform.default_on_obo_audience",
        // Phase 3 (spec 2026-05-24-derive-team-from-channel) removed
        // `team_personal.dm_mode_known_limitation` from the sample set.
      ];
      for (const id of samples) {
        const result = explainInvariant(id);
        expect(result.body).toMatch(
          // Allows "This is an *advisory* row" (markdown emphasis) too.
          /^(This row checks|This is an (?:\*\w+\* )?advisory row|This is an? \*?advisory\*? row|Same as|Same shape as|Same rationale as|Same \*shape\* rule)/i,
        );
      }
    });
  });
});
