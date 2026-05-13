import type {
  ExternalGroup,
  IdentityGroupSyncRule,
  TeamRelationshipRole,
} from "@/types/identity-group-sync";

import { normalizeTeamSlug } from "./team-slugs";

export interface IdentityGroupRuleMatch {
  group: ExternalGroup;
  rule: IdentityGroupSyncRule;
  captured: Record<string, string>;
  relationship: TeamRelationshipRole;
  teamName: string;
  teamSlug: string;
}

export interface IgnoredIdentityGroup {
  group: ExternalGroup;
  reason: "excluded_by_rule" | "no_matching_rule" | "rule_disabled" | "role_unmapped";
  ruleId?: string;
}

export interface IdentityGroupRuleConflict {
  group: ExternalGroup;
  reason: string;
  ruleId: string;
  teamSlug?: string;
}

export interface EvaluateIdentityGroupRulesInput {
  groups: ExternalGroup[];
  rules: IdentityGroupSyncRule[];
  existingTeamSlugs: string[];
}

export interface EvaluateIdentityGroupRulesResult {
  matches: IdentityGroupRuleMatch[];
  ignored: IgnoredIdentityGroup[];
  conflicts: IdentityGroupRuleConflict[];
}

function patternMatches(pattern: string, value: string): RegExpMatchArray | null {
  return value.match(new RegExp(pattern));
}

function capturedGroups(match: RegExpMatchArray): Record<string, string> {
  return Object.fromEntries(Object.entries(match.groups ?? {}).filter(([, value]) => value !== undefined));
}

function renderTemplate(template: string, captured: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}|\$\{([A-Za-z0-9_]+)\}/g, (_all, hbs, shell) => {
    const key = hbs || shell;
    return captured[key] ?? "";
  });
}

function roleFromCapture(
  rule: IdentityGroupSyncRule,
  captured: Record<string, string>
): TeamRelationshipRole | null {
  const roleLabel = captured.role ?? captured.relationship ?? captured.access;
  if (!roleLabel) return "member";
  return rule.role_map[roleLabel] ?? null;
}

export function evaluateIdentityGroupRules(
  input: EvaluateIdentityGroupRulesInput
): EvaluateIdentityGroupRulesResult {
  const existingSlugs = new Set(input.existingTeamSlugs.map((slug) => normalizeTeamSlug(slug)));
  const matches: IdentityGroupRuleMatch[] = [];
  const ignored: IgnoredIdentityGroup[] = [];
  const conflicts: IdentityGroupRuleConflict[] = [];
  const rules = [...input.rules].sort((a, b) => a.priority - b.priority);

  for (const group of input.groups) {
    let resolved = false;
    for (const rule of rules) {
      if (!rule.enabled || rule.review_status === "disabled") {
        continue;
      }
      if (rule.exclude_patterns.some((pattern) => patternMatches(pattern, group.display_name))) {
        ignored.push({ group, reason: "excluded_by_rule", ruleId: rule.id });
        resolved = true;
        break;
      }

      for (const pattern of rule.include_patterns) {
        const match = patternMatches(pattern, group.display_name);
        if (!match) continue;

        const captured = capturedGroups(match);
        const relationship = roleFromCapture(rule, captured);
        if (!relationship) {
          ignored.push({ group, reason: "role_unmapped", ruleId: rule.id });
          resolved = true;
          break;
        }

        const teamName = renderTemplate(rule.team_name_template, captured).trim();
        const teamSlug = normalizeTeamSlug(renderTemplate(rule.team_slug_template, captured));
        if (existingSlugs.has(teamSlug)) {
          conflicts.push({
            group,
            reason: `Generated team slug "${teamSlug}" already exists`,
            ruleId: rule.id,
            teamSlug,
          });
        } else {
          matches.push({ group, rule, captured, relationship, teamName, teamSlug });
          existingSlugs.add(teamSlug);
        }
        resolved = true;
        break;
      }
      if (resolved) break;
    }
    if (!resolved) {
      ignored.push({ group, reason: "no_matching_rule" });
    }
  }

  return { matches, ignored, conflicts };
}
