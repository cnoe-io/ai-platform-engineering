import type {
  KeycloakInvariant,
  KeycloakInvariantStatus,
} from "@/lib/rbac/keycloak-invariants";
import {
  buildTeamScopeMatrix,
  filterTeamScopeRows,
  TEAM_SCOPE_KIND_ORDER,
  type TeamScopeKind,
  type TeamScopeRow,
} from "../team-scope-matrix";

/**
 * Tests for the team-scope invariant matrix pivot.
 *
 * The pivot is the load-bearing module for the panel's scale story
 * (100s of teams → matrix view), so this file pins:
 *
 *   1. Pivoting correctness: N teams → N rows × 4 cells, with the
 *      structural `team-personal` row dropping the audience column.
 *   2. Sort order: failing first → unknown → passing, then alpha by
 *      slug, with `team-personal` pushed to the end of its tier.
 *   3. Filtering: slug search, "failing only", per-failure-kind
 *      multi-select.
 *   4. Resilience: duplicate emissions, malformed IDs, advisory
 *      handling, and a 100-team fixture.
 */

const SLACK_BOT = "caipe-slack-bot";
const WEBEX_BOT = "caipe-webex-bot";
const OBO_AUDIENCE = "caipe-platform";

function inv(
  slug: string,
  kind: TeamScopeKind,
  status: KeycloakInvariantStatus,
  overrides: Partial<KeycloakInvariant> = {},
): KeycloakInvariant {
  const id = `team_scope.team-${slug}.${kind}`;
  // Mirror the BFF's description shape so tests catch any drift if a
  // future refactor changes wording in only one place.
  const labels: Record<TeamScopeKind, string> = {
    active_team_mapper: `team-${slug} has an active_team protocol mapper`,
    optional_on_slack_bot: `team-${slug} bound optional on ${SLACK_BOT}`,
    optional_on_webex_bot: `team-${slug} bound optional on ${WEBEX_BOT}`,
    default_on_obo_audience: `team-${slug} bound default on ${OBO_AUDIENCE}`,
  };
  return {
    id,
    description: labels[kind],
    group: "team-scope",
    source: "bff-migration",
    status,
    remediation: status === "pass" ? "none" : "reconcile_now",
    ...overrides,
  };
}

function fullyPassingTeam(slug: string): KeycloakInvariant[] {
  return TEAM_SCOPE_KIND_ORDER.map((kind) => inv(slug, kind, "pass"));
}

function fullyPassingPersonalTeam(): KeycloakInvariant[] {
  // `team-personal` only emits 3 cells — no audience invariant.
  return [
    inv("personal", "active_team_mapper", "pass"),
    inv("personal", "optional_on_slack_bot", "pass"),
    inv("personal", "optional_on_webex_bot", "pass"),
  ];
}

describe("buildTeamScopeMatrix", () => {
  describe("pivoting", () => {
    it("returns an empty matrix for an empty input", () => {
      const matrix = buildTeamScopeMatrix([]);
      expect(matrix.rows).toEqual([]);
      expect(matrix.summary).toEqual({
        teams: 0,
        fail_count: 0,
        unknown_count: 0,
        pass_count: 0,
      });
      expect(matrix.advisory).toBeNull();
      expect(matrix.kinds).toEqual(TEAM_SCOPE_KIND_ORDER);
    });

    it("pivots one team into one row with 4 cells in TEAM_SCOPE_KIND_ORDER", () => {
      const matrix = buildTeamScopeMatrix(fullyPassingTeam("platform"));
      expect(matrix.rows).toHaveLength(1);
      const row = matrix.rows[0];
      expect(row.slug).toBe("team-platform");
      expect(row.isPersonal).toBe(false);
      expect(row.total_cells).toBe(4);
      expect(row.pass_count).toBe(4);
      expect(row.fail_count).toBe(0);
      expect(row.unknown_count).toBe(0);
      for (const kind of TEAM_SCOPE_KIND_ORDER) {
        expect(row.cells[kind]).toBeDefined();
        expect(row.cells[kind]?.id).toBe(`team_scope.team-platform.${kind}`);
      }
    });

    it("drops the audience cell for team-personal (3 cells, not 4)", () => {
      const matrix = buildTeamScopeMatrix(fullyPassingPersonalTeam());
      const row = matrix.rows[0];
      expect(row.slug).toBe("team-personal");
      expect(row.isPersonal).toBe(true);
      expect(row.total_cells).toBe(3);
      expect(row.cells.active_team_mapper).toBeDefined();
      expect(row.cells.optional_on_slack_bot).toBeDefined();
      expect(row.cells.optional_on_webex_bot).toBeDefined();
      // The audience cell is genuinely missing — the renderer paints
      // "N/A" for this slot and the kind-summary still counts the
      // present cells across other teams.
      expect(row.cells.default_on_obo_audience).toBeUndefined();
    });

    it("rolls per-row counts up into the matrix summary", () => {
      const matrix = buildTeamScopeMatrix([
        // team-a: 1 fail (slack), rest pass → 3 pass, 1 fail
        inv("a", "active_team_mapper", "pass"),
        inv("a", "optional_on_slack_bot", "fail"),
        inv("a", "optional_on_webex_bot", "pass"),
        inv("a", "default_on_obo_audience", "pass"),
        // team-b: all pass → 4 pass
        ...fullyPassingTeam("b"),
        // team-c: 1 unknown (mapper), rest pass → 3 pass, 1 unknown
        inv("c", "active_team_mapper", "unknown"),
        inv("c", "optional_on_slack_bot", "pass"),
        inv("c", "optional_on_webex_bot", "pass"),
        inv("c", "default_on_obo_audience", "pass"),
      ]);
      expect(matrix.summary).toEqual({
        teams: 3,
        fail_count: 1,
        unknown_count: 1,
        pass_count: 10,
      });
    });

    it("ignores invariants from other groups so callers can pass the whole list", () => {
      const matrix = buildTeamScopeMatrix([
        // Other-group noise — must not appear in the matrix.
        {
          id: "obo.users_impersonate.affirmative",
          description: "users.impersonate uses AFFIRMATIVE",
          group: "obo",
          source: "init-idp.sh",
          status: "fail",
          remediation: "reconcile_now",
        },
        ...fullyPassingTeam("platform"),
      ]);
      expect(matrix.rows).toHaveLength(1);
      expect(matrix.rows[0].slug).toBe("team-platform");
      expect(matrix.advisory).toBeNull();
    });

    it("ignores malformed team_scope IDs without throwing", () => {
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingTeam("platform"),
        // No second dot → unparseable → silently dropped.
        {
          id: "team_scope.bogus_id",
          description: "bogus",
          group: "team-scope",
          source: "bff-migration",
          status: "fail",
          remediation: "reconcile_now",
        },
      ]);
      expect(matrix.rows).toHaveLength(1);
    });

    it("extracts the team_personal.dm_mode_known_limitation advisory separately", () => {
      const advisory: KeycloakInvariant = {
        id: "team_personal.dm_mode_known_limitation",
        description: "team-personal DM mode has a known token-exchange limitation",
        group: "team-scope",
        source: "init-token-exchange.sh",
        status: "unknown",
        detail: "Keycloak's RFC 8693 drops the scope= parameter…",
        remediation: "manual_keycloak",
      };
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingTeam("platform"),
        ...fullyPassingPersonalTeam(),
        advisory,
      ]);
      expect(matrix.advisory).toBe(advisory);
      // …and it does NOT leak into the matrix rows.
      const personalRow = matrix.rows.find((row) => row.slug === "team-personal");
      expect(personalRow?.total_cells).toBe(3);
      expect(personalRow?.cells.default_on_obo_audience).toBeUndefined();
    });
  });

  describe("kind_summary", () => {
    it("counts pass / fail / unknown per kind across the whole matrix", () => {
      const items: KeycloakInvariant[] = [
        // team-a: slack fails
        inv("a", "active_team_mapper", "pass"),
        inv("a", "optional_on_slack_bot", "fail"),
        inv("a", "optional_on_webex_bot", "pass"),
        inv("a", "default_on_obo_audience", "pass"),
        // team-b: slack fails too
        inv("b", "active_team_mapper", "pass"),
        inv("b", "optional_on_slack_bot", "fail"),
        inv("b", "optional_on_webex_bot", "pass"),
        inv("b", "default_on_obo_audience", "unknown"),
        // team-c: all pass
        ...fullyPassingTeam("c"),
      ];
      const matrix = buildTeamScopeMatrix(items);
      expect(matrix.kind_summary.optional_on_slack_bot.fail_count).toBe(2);
      expect(matrix.kind_summary.optional_on_slack_bot.pass_count).toBe(1);
      expect(matrix.kind_summary.default_on_obo_audience.unknown_count).toBe(1);
      expect(matrix.kind_summary.default_on_obo_audience.pass_count).toBe(2);
      expect(matrix.kind_summary.active_team_mapper.pass_count).toBe(3);
    });

    it("excludes team-personal from the audience kind_summary (no cell emitted there)", () => {
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingTeam("platform"),
        ...fullyPassingPersonalTeam(),
      ]);
      expect(matrix.kind_summary.default_on_obo_audience.pass_count).toBe(1);
      expect(matrix.kind_summary.optional_on_slack_bot.pass_count).toBe(2);
    });
  });

  describe("sort order", () => {
    it("puts failing rows above unknown above passing", () => {
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingTeam("zero-fail"),
        // unknown-only row
        inv("only-unknown", "active_team_mapper", "unknown"),
        inv("only-unknown", "optional_on_slack_bot", "pass"),
        inv("only-unknown", "optional_on_webex_bot", "pass"),
        inv("only-unknown", "default_on_obo_audience", "pass"),
        // 1-fail row
        inv("one-fail", "active_team_mapper", "fail"),
        inv("one-fail", "optional_on_slack_bot", "pass"),
        inv("one-fail", "optional_on_webex_bot", "pass"),
        inv("one-fail", "default_on_obo_audience", "pass"),
        // 2-fail row
        inv("two-fail", "active_team_mapper", "fail"),
        inv("two-fail", "optional_on_slack_bot", "fail"),
        inv("two-fail", "optional_on_webex_bot", "pass"),
        inv("two-fail", "default_on_obo_audience", "pass"),
      ]);
      expect(matrix.rows.map((r) => r.slug)).toEqual([
        "team-two-fail",
        "team-one-fail",
        "team-only-unknown",
        "team-zero-fail",
      ]);
    });

    it("ties within a tier alphabetically by slug", () => {
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingTeam("zulu"),
        ...fullyPassingTeam("alpha"),
        ...fullyPassingTeam("mike"),
      ]);
      expect(matrix.rows.map((r) => r.slug)).toEqual([
        "team-alpha",
        "team-mike",
        "team-zulu",
      ]);
    });

    it("pushes team-personal to the end of its tier (so the structural row sits at the bottom)", () => {
      const matrix = buildTeamScopeMatrix([
        ...fullyPassingPersonalTeam(),
        ...fullyPassingTeam("alpha"),
        ...fullyPassingTeam("zebra"),
      ]);
      // All three rows pass, so they're in the passing tier; alpha
      // → zebra → personal regardless of pure alpha order.
      expect(matrix.rows.map((r) => r.slug)).toEqual([
        "team-alpha",
        "team-zebra",
        "team-personal",
      ]);
    });
  });

  describe("duplicate emission resilience", () => {
    it("keeps the worse status when the BFF accidentally emits the same (slug,kind) twice", () => {
      const matrix = buildTeamScopeMatrix([
        // First emission: pass.
        inv("dup", "active_team_mapper", "pass"),
        // Hypothetical duplicate from a re-run: fail. The matrix
        // must surface the fail (silent green on a real fail would
        // be the worst possible behaviour).
        inv("dup", "active_team_mapper", "fail"),
        inv("dup", "optional_on_slack_bot", "pass"),
        inv("dup", "optional_on_webex_bot", "pass"),
        inv("dup", "default_on_obo_audience", "pass"),
      ]);
      const row = matrix.rows[0];
      expect(row.cells.active_team_mapper?.status).toBe("fail");
      expect(row.fail_count).toBe(1);
      expect(row.pass_count).toBe(3);
      expect(row.total_cells).toBe(4);
    });

    it("does not double-count duplicate emissions in the kind_summary", () => {
      const matrix = buildTeamScopeMatrix([
        inv("dup", "active_team_mapper", "pass"),
        inv("dup", "active_team_mapper", "fail"),
        inv("dup", "optional_on_slack_bot", "pass"),
        inv("dup", "optional_on_webex_bot", "pass"),
        inv("dup", "default_on_obo_audience", "pass"),
      ]);
      expect(matrix.kind_summary.active_team_mapper.fail_count).toBe(1);
      expect(matrix.kind_summary.active_team_mapper.pass_count).toBe(0);
    });
  });

  describe("scale", () => {
    it("handles 100 teams without losing rows or cells", () => {
      const items: KeycloakInvariant[] = [];
      for (let i = 0; i < 100; i += 1) {
        const slug = `t${i.toString().padStart(3, "0")}`;
        // Inject one failing cell on every 17th team so we have a
        // realistic mix at scale (5-6 failing teams out of 100).
        const slackStatus: KeycloakInvariantStatus = i % 17 === 0 ? "fail" : "pass";
        items.push(inv(slug, "active_team_mapper", "pass"));
        items.push(inv(slug, "optional_on_slack_bot", slackStatus));
        items.push(inv(slug, "optional_on_webex_bot", "pass"));
        items.push(inv(slug, "default_on_obo_audience", "pass"));
      }
      const matrix = buildTeamScopeMatrix(items);
      expect(matrix.rows).toHaveLength(100);
      // Every row got 4 cells.
      for (const row of matrix.rows) {
        expect(row.total_cells).toBe(4);
      }
      // The 6 failing teams (i=0, 17, 34, 51, 68, 85) appear at the top.
      const failingSlugs = matrix.rows
        .filter((row) => row.fail_count > 0)
        .map((row) => row.slug);
      expect(failingSlugs).toEqual([
        "team-t000",
        "team-t017",
        "team-t034",
        "team-t051",
        "team-t068",
        "team-t085",
      ]);
      // Summary is correct (6 fails, 394 passes, 0 unknown).
      expect(matrix.summary).toEqual({
        teams: 100,
        fail_count: 6,
        unknown_count: 0,
        pass_count: 394,
      });
    });
  });
});

describe("filterTeamScopeRows", () => {
  function makeRows(): TeamScopeRow[] {
    return buildTeamScopeMatrix([
      // 1 slack fail
      inv("alpha", "active_team_mapper", "pass"),
      inv("alpha", "optional_on_slack_bot", "fail"),
      inv("alpha", "optional_on_webex_bot", "pass"),
      inv("alpha", "default_on_obo_audience", "pass"),
      // 1 webex fail
      inv("beta", "active_team_mapper", "pass"),
      inv("beta", "optional_on_slack_bot", "pass"),
      inv("beta", "optional_on_webex_bot", "fail"),
      inv("beta", "default_on_obo_audience", "pass"),
      // all pass
      ...fullyPassingTeam("gamma"),
      // all pass — sluglike but not matching "alpha"
      ...fullyPassingTeam("delta"),
    ]).rows;
  }

  it("returns every row when no filters are set", () => {
    const rows = makeRows();
    expect(filterTeamScopeRows({ rows })).toHaveLength(4);
  });

  it("filters by slug substring (case-insensitive)", () => {
    const rows = makeRows();
    const result = filterTeamScopeRows({ rows, slugQuery: "ALPHA" });
    expect(result.map((r) => r.slug)).toEqual(["team-alpha"]);
  });

  it("filters by 'failing only'", () => {
    const rows = makeRows();
    const result = filterTeamScopeRows({ rows, failingOnly: true });
    expect(result.map((r) => r.slug).sort()).toEqual([
      "team-alpha",
      "team-beta",
    ]);
  });

  it("filters by failure kind (OR semantics across multiple chips)", () => {
    const rows = makeRows();
    const slackOnly = filterTeamScopeRows({
      rows,
      failureKinds: ["optional_on_slack_bot"],
    });
    expect(slackOnly.map((r) => r.slug)).toEqual(["team-alpha"]);

    const bothBots = filterTeamScopeRows({
      rows,
      failureKinds: ["optional_on_slack_bot", "optional_on_webex_bot"],
    });
    expect(bothBots.map((r) => r.slug).sort()).toEqual([
      "team-alpha",
      "team-beta",
    ]);
  });

  it("ignores rows whose failing cell is on a *different* kind than the chip", () => {
    const rows = makeRows();
    const audienceOnly = filterTeamScopeRows({
      rows,
      failureKinds: ["default_on_obo_audience"],
    });
    // No row has a failing audience cell in our fixture.
    expect(audienceOnly).toHaveLength(0);
  });

  it("composes filters with AND semantics", () => {
    const rows = makeRows();
    const compound = filterTeamScopeRows({
      rows,
      failingOnly: true,
      slugQuery: "beta",
    });
    expect(compound.map((r) => r.slug)).toEqual(["team-beta"]);
  });
});
