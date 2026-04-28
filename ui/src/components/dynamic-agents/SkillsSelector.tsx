"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Sparkles, Search, CheckSquare, TriangleAlert } from "lucide-react";
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

  // Filter by search (title AND id)
  const filtered = React.useMemo(() => {
    if (!search.trim()) return availableSkills;
    const q = search.toLowerCase();
    return availableSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q))
    );
  }, [availableSkills, search]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => value.includes(s.id));
  const atLimit = value.length >= maxSkills;

  function toggleSkill(skillId: string) {
    if (value.includes(skillId)) {
      onChange(value.filter((id) => id !== skillId));
    } else if (!atLimit) {
      onChange([...value, skillId]);
    }
  }

  function selectAllFiltered() {
    const filteredIds = filtered.map((s) => s.id);
    const existing = new Set(value);
    for (const id of filteredIds) {
      if (existing.size >= maxSkills) break;
      existing.add(id);
    }
    onChange(Array.from(existing));
  }

  function deselectAllFiltered() {
    const filteredIds = new Set(filtered.map((s) => s.id));
    onChange(value.filter((id) => !filteredIds.has(id)));
  }

  function addAll() {
    onChange(availableSkills.map((s) => s.id).slice(0, maxSkills));
  }

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
    <div className="space-y-3">
      {/* Header row: search + actions */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            disabled={disabled}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={allFilteredSelected ? deselectAllFiltered : selectAllFiltered}
          disabled={disabled || filtered.length === 0 || atLimit}
          className="h-9 text-xs whitespace-nowrap"
        >
          <CheckSquare className="h-3.5 w-3.5 mr-1" />
          {allFilteredSelected ? "Deselect" : "Select"} {search ? "filtered" : "all"}
        </Button>
        {search && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addAll}
            disabled={disabled || value.length === availableSkills.length || atLimit}
            className="h-9 text-xs whitespace-nowrap"
          >
            Add all ({availableSkills.length})
          </Button>
        )}
      </div>

      {/* Selected count + tiered warnings */}
      {value.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {value.length} skill{value.length !== 1 ? "s" : ""} selected
          </p>
          {value.length > maxSkills && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
              <p className="text-xs text-destructive">
                Maximum {maxSkills} skills allowed. Remove {value.length - maxSkills} skill{value.length - maxSkills !== 1 ? "s" : ""} to save.
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
        </div>
      )}

      {/* Skills list */}
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {filtered.map((skill) => {
          const isSelected = value.includes(skill.id);
          return (
            <label
              key={skill.id}
              className={cn(
                "flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors",
                isSelected
                  ? "bg-primary/5 border-primary/30"
                  : "bg-background border-border hover:bg-muted/50",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleSkill(skill.id)}
                disabled={disabled}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{skill.name}</span>
                  {skill.category && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {skill.category}
                    </Badge>
                  )}
                  {skill.visibility && skill.visibility !== "private" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {skill.visibility}
                    </Badge>
                  )}
                </div>
                {skill.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {skill.description}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5">
                  {skill.id}
                </p>
              </div>
            </label>
          );
        })}

        {filtered.length === 0 && search && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No skills match &quot;{search}&quot;
          </p>
        )}
      </div>
    </div>
  );
}
