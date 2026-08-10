"use client";

/**
 * OverviewTab — metadata editing surface for the Skill Workspace.
 *
 * Wraps `useSkillForm` outputs into a clean form (name, description,
 * category, thumbnail icon, tags, visibility, teams).
 * Intentionally simpler than the legacy Builder header; no nested popovers
 * or expandable accordions — every field is always visible.
 */

import { Globe,Lock,Users as TeamsIcon } from "lucide-react";
import React from "react";

import { AiAssistButton } from "@/components/ai-assist";
import type { UseSkillFormResult } from "@/components/skills/workspace/use-skill-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TeamMultiPicker,type TeamPickerOption } from "@/components/ui/team-picker";
import { cn } from "@/lib/utils";
import type { SkillVisibility } from "@/types/agent-skill";

export interface OverviewTabProps {
  form: UseSkillFormResult;
}

interface ShareableTeamRow {
  slug?: string;
  name?: string;
  _id?: string;
}

/**
 * Teams a member may share a skill with come from the same app-wide
 * "teams available for sharing" endpoint the RAG KB / MCP / Dynamic-Agent
 * editors use (`GET /api/dynamic-agents/teams`). It returns the caller's
 * own teams (org admins get every team) and is member-accessible, so a
 * generic user can finally pick teams in the Skill Builder instead of the
 * old dead-end "use the gallery" hint.
 */
function useShareableTeams(enabled: boolean): {
  options: TeamPickerOption[];
  loading: boolean;
} {
  const [options, setOptions] = React.useState<TeamPickerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/dynamic-agents/teams");
        const data = (await res.json()) as {
          success?: boolean;
          data?: ShareableTeamRow[];
        };
        if (cancelled) return;
        const rows = data?.success && Array.isArray(data.data) ? data.data : [];
        setOptions(
          rows
            .filter((t): t is ShareableTeamRow & { slug: string } =>
              Boolean(t.slug),
            )
            .map((t) => ({ slug: t.slug, name: t.name ?? t.slug, _id: t._id })),
        );
      } catch {
        // Non-fatal: picker simply shows nothing to choose from.
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);

  return { options, loading };
}

const VISIBILITY_OPTIONS: {
  id: SkillVisibility;
  label: string;
  icon: React.ElementType;
  description: string;
}[] = [
  {
    id: "private",
    label: "Private",
    icon: Lock,
    description: "Only you can see this skill",
  },
  {
    id: "team",
    label: "Team",
    icon: TeamsIcon,
    description: "Shared with selected teams",
  },
  {
    id: "global",
    label: "Global",
    icon: Globe,
    description: "Visible to everyone in the org",
  },
];

export function OverviewTab({ form }: OverviewTabProps) {
  const {
    formData,
    setFormData,
    tags,
    setTags,
    visibility,
    setVisibility,
    selectedTeamIds,
    setSelectedTeamIds,
    errors,
  } = form;

  const [tagInput, setTagInput] = React.useState("");
  const { options: teamOptions, loading: teamsLoading } = useShareableTeams(
    visibility === "team",
  );

  const addTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    if (tags.includes(v)) {
      setTagInput("");
      return;
    }
    setTags([...tags, v]);
    setTagInput("");
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Identity</h2>

        <div>
          <label
            htmlFor="overview-name"
            className="text-xs font-medium text-muted-foreground"
          >
            Name <span className="text-destructive">*</span>
          </label>
          <Input
            id="overview-name"
            value={formData.name}
            onChange={(e) =>
              setFormData((f) => ({ ...f, name: e.target.value }))
            }
            placeholder="e.g. Triage GitHub Issues"
            className={cn(
              "mt-1",
              errors.name && "border-destructive focus-visible:ring-destructive",
            )}
          />
          {errors.name && (
            <p className="text-xs text-destructive mt-1">{errors.name}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="overview-description"
              className="text-xs font-medium text-muted-foreground"
            >
              Description
            </label>
            <AiAssistButton
              task="describe-skill"
              triggerTestId="overview-description-ai"
              getContext={() => ({
                name: formData.name,
                current_value: formData.description,
              })}
              onApply={(text) =>
                setFormData((f) => ({ ...f, description: text }))
              }
              presets={[
                "Make it concise (1 sentence)",
                "Add when an agent should use this",
                "Make it more specific",
              ]}
            />
          </div>
          <textarea
            id="overview-description"
            rows={3}
            className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={formData.description}
            onChange={(e) =>
              setFormData((f) => ({ ...f, description: e.target.value }))
            }
            placeholder="What does this skill do? When should an agent reach for it?"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Classification</h2>

        {/* Category is the only classification we still surface in the
            Overview form. The "Difficulty" radio (beginner / intermediate
            / advanced) was removed because nothing in the gallery, the
            scanner or the agent runtime actually
            consumed it — it was a label without a job. The underlying
            `difficulty` field on AgentSkill is kept for back-compat
            with any persisted skills that already set it; new skills
            simply default to "beginner". */}
        <div>
          <label
            htmlFor="overview-category"
            className="text-xs font-medium text-muted-foreground"
          >
            Category <span className="text-destructive">*</span>
          </label>
          <Input
            id="overview-category"
            value={formData.category}
            onChange={(e) =>
              setFormData((f) => ({ ...f, category: e.target.value }))
            }
            placeholder="Custom"
            className={cn(
              "mt-1",
              errors.category &&
                "border-destructive focus-visible:ring-destructive",
            )}
          />
          {errors.category && (
            <p className="text-xs text-destructive mt-1">
              {errors.category}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Tags
          </label>
          <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-border/60 bg-background p-2">
            {tags.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="gap-1 text-xs"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  aria-label={`Remove tag ${t}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </Badge>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                } else if (e.key === "Backspace" && !tagInput && tags.length) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              placeholder={tags.length === 0 ? "Add tags…" : ""}
              className="flex-1 min-w-[100px] bg-transparent outline-none text-xs"
              aria-label="Add tag"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Sharing</h2>
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Visibility"
        >
          {VISIBILITY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = visibility === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVisibility(opt.id)}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-3 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/60 hover:bg-muted/40",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 mt-0.5 shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">
                    {opt.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {visibility === "team" && (
          <div className="space-y-1.5">
            <TeamMultiPicker
              options={teamOptions}
              selected={selectedTeamIds}
              onChange={setSelectedTeamIds}
              ariaLabel="Share skill with teams"
              placeholder={
                teamsLoading ? "Loading teams…" : "Share with teams…"
              }
              emptyLabel={
                teamsLoading
                  ? "Loading teams…"
                  : "You're not a member of any team yet"
              }
              triggerClassName={cn(
                errors.teams &&
                  "border-destructive focus-visible:ring-destructive",
              )}
            />
            {errors.teams ? (
              <p className="text-xs text-destructive">{errors.teams}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {selectedTeamIds.length === 0
                  ? "Pick one or more of your teams to share this skill with."
                  : `Sharing with ${selectedTeamIds.length} team${selectedTeamIds.length === 1 ? "" : "s"}.`}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
