"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  AlertCircle,
  Sparkles,
  Search,
  CheckSquare,
  TriangleAlert,
  X,
  Plus,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSkill } from "@/types/agent-skill";

interface SkillsSelectorProps {
  value: string[];
  onChange: (skillIds: string[]) => void;
  disabled?: boolean;
  maxSkills?: number;
}

const DEFAULT_MAX_SKILLS = 500;

export function SkillsSelector({ value, onChange, disabled, maxSkills = DEFAULT_MAX_SKILLS }: SkillsSelectorProps) {
  const [availableSkills, setAvailableSkills] = React.useState<AgentSkill[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null);
  const [tagFilters, setTagFilters] = React.useState<Set<string>>(new Set());

  // Fetch available skills on mount
  React.useEffect(() => {
    fetchSkills();
  }, []);

  async function fetchSkills() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-skills");
      const data = await response.json();
      // API returns array directly (not wrapped in {success, data})
      const skills: AgentSkill[] = Array.isArray(data) ? data : data.data ?? [];
      if (skills.length > 0) {
        setAvailableSkills(skills);
      } else if (!Array.isArray(data) && data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to load skills");
    } finally {
      setLoading(false);
    }
  }

  // Extract unique categories and tags for filter dropdowns
  const categories = React.useMemo(() => {
    const cats = new Set<string>();
    for (const s of availableSkills) {
      if (s.category) cats.add(s.category);
    }
    return Array.from(cats).sort();
  }, [availableSkills]);

  const tags = React.useMemo(() => {
    const t = new Set<string>();
    for (const s of availableSkills) {
      for (const tag of s.metadata?.tags ?? []) {
        t.add(tag);
      }
    }
    return Array.from(t).sort();
  }, [availableSkills]);

  // Filter by search, category, and tags
  const filtered = React.useMemo(() => {
    return availableSkills.filter((s) => {
      // Exclude already-selected skills from the "available" list
      if (value.includes(s.id)) return false;

      if (categoryFilter && s.category !== categoryFilter) return false;
      if (tagFilters.size > 0) {
        const skillTags = s.metadata?.tags ?? [];
        if (!Array.from(tagFilters).some((t) => skillTags.includes(t))) return false;
      }

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.category && s.category.toLowerCase().includes(q))
      );
    });
  }, [availableSkills, search, categoryFilter, tagFilters, value]);

  // Selected skills resolved to full objects
  const selectedSkills = React.useMemo(() => {
    const byId = new Map(availableSkills.map((s) => [s.id, s]));
    return value.map((id) => byId.get(id)).filter(Boolean) as AgentSkill[];
  }, [availableSkills, value]);

  const atLimit = value.length >= maxSkills;

  function addSkill(skillId: string) {
    if (!value.includes(skillId) && !atLimit) {
      onChange([...value, skillId]);
    }
  }

  function removeSkill(skillId: string) {
    onChange(value.filter((id) => id !== skillId));
  }

  function selectAllFiltered() {
    const existing = new Set(value);
    for (const s of filtered) {
      if (existing.size >= maxSkills) break;
      existing.add(s.id);
    }
    onChange(Array.from(existing));
  }

  function addAll() {
    onChange(availableSkills.map((s) => s.id).slice(0, maxSkills));
  }

  function clearFilters() {
    setSearch("");
    setCategoryFilter(null);
    setTagFilters(new Set());
  }

  const hasActiveFilters = search || categoryFilter || tagFilters.size > 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading skills...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive py-4">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  if (availableSkills.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No skills available.</p>
        <p className="text-xs mt-1">Create skills in the Skills tab first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Selected skills ── */}
      {selectedSkills.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Selected Skills</Label>
            <Badge variant="default" className="text-xs">
              {value.length} selected
            </Badge>
          </div>

          {/* Tiered warnings */}
          {value.length > maxSkills && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
              <p className="text-xs text-destructive">
                Maximum {maxSkills} skills allowed. Remove {value.length - maxSkills} skill
                {value.length - maxSkills !== 1 ? "s" : ""} to save.
              </p>
            </div>
          )}
          {value.length > 100 && value.length <= maxSkills && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
              <TriangleAlert className="h-3.5 w-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Too many skills can dilute agent focus. Consider selecting only the most relevant ones.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto border rounded-lg p-2">
            {selectedSkills.map((skill) => (
              <Badge
                key={skill.id}
                variant="secondary"
                className="text-xs px-2 py-0.5 gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={() => !disabled && removeSkill(skill.id)}
              >
                {skill.name}
                <X className="h-3 w-3" />
              </Badge>
            ))}
            {/* Show IDs that don't resolve (orphaned references) */}
            {value
              .filter((id) => !availableSkills.some((s) => s.id === id))
              .map((id) => (
                <Badge
                  key={id}
                  variant="outline"
                  className="text-xs px-2 py-0.5 gap-1 cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  onClick={() => !disabled && removeSkill(id)}
                >
                  {id}
                  <X className="h-3 w-3" />
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* ── Add skills section ── */}
      <div className="space-y-2">
        <Label>Add Skills</Label>

        {/* Search + filters — all on one row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs w-36"
            disabled={disabled}
          />
          {categories.length > 1 && (
            <select
              value={categoryFilter || ""}
              onChange={(e) => setCategoryFilter(e.target.value || null)}
              className="h-7 text-xs rounded-md border border-input bg-background px-2"
              disabled={disabled}
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
          {tags.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setTagFilters((prev) => new Set([...prev, e.target.value]));
                }
              }}
              className="h-7 text-xs rounded-md border border-input bg-background px-2"
              disabled={disabled}
            >
              <option value="">Add tag filter...</option>
              {tags
                .filter((t) => !tagFilters.has(t))
                .map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
            </select>
          )}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 text-xs px-2"
            >
              Clear
            </Button>
          )}
          {filtered.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={selectAllFiltered}
              disabled={disabled || atLimit}
              className="h-7 text-xs px-2 ml-auto"
            >
              <CheckSquare className="h-3 w-3 mr-1" />
              Select {hasActiveFilters ? "filtered" : "all"} ({filtered.length})
            </Button>
          )}
        </div>

        {/* Active tag filter chips */}
        {tagFilters.size > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {Array.from(tagFilters).map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 gap-1 cursor-pointer hover:bg-destructive/10 hover:text-destructive transition-colors"
                onClick={() =>
                  setTagFilters((prev) => {
                    const next = new Set(prev);
                    next.delete(tag);
                    return next;
                  })
                }
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
                <X className="h-2.5 w-2.5" />
              </Badge>
            ))}
          </div>
        )}

        {/* Available skills list — compact single-line rows */}
        <div className="max-h-96 overflow-y-auto border rounded-lg p-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {hasActiveFilters
                ? "No skills match current filters"
                : "All skills have been selected"}
            </p>
          ) : (
            filtered.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => addSkill(skill.id)}
                disabled={disabled || atLimit}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left transition-colors",
                  "hover:bg-muted cursor-pointer",
                  (disabled || atLimit) && "opacity-50 cursor-not-allowed"
                )}
              >
                <Plus className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate flex-shrink-0 max-w-[40%]">{skill.name}</span>
                {skill.description && (
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    — {skill.description}
                  </span>
                )}
                {skill.category && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                    {skill.category}
                  </Badge>
                )}
                {skill.visibility && skill.visibility !== "private" && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                    {skill.visibility}
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Help text */}
      {value.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skills inject domain-specific instructions into the agent&apos;s context via progressive disclosure.
        </p>
      )}
    </div>
  );
}
