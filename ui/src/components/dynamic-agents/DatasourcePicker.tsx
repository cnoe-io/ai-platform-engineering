"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card,CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle,Database,Loader2,Trash2 } from "lucide-react";
import React from "react";

interface AvailableDatasource {
  datasource_id: string;
  name: string;
  permission?: string;
}

interface DatasourcePickerProps {
  /** Owning team slug this agent belongs to — the picker's data scope. */
  ownerTeamSlug: string;
  value: string[];
  onChange: (datasourceIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select of datasource ids the owning team can see (via OpenFGA
 * `knowledge_base` grants), used to narrow this agent's search tool.
 * Narrows, never widens: the runtime still intersects this list with the
 * caller's own RBAC-accessible datasources at query time.
 */
export function DatasourcePicker({
  ownerTeamSlug,
  value,
  onChange,
  disabled,
}: DatasourcePickerProps) {
  const [available, setAvailable] = React.useState<AvailableDatasource[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!ownerTeamSlug) {
      setAvailable([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/dynamic-agents/datasources?team_slug=${encodeURIComponent(ownerTeamSlug)}`,
        );
        const data = await response.json();
        if (cancelled) return;
        if (data.success && data.data?.datasources) {
          setAvailable(data.data.datasources);
        } else {
          setError(data.error || "Failed to load team datasources");
        }
      } catch {
        if (!cancelled) setError("Failed to load team datasources");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerTeamSlug]);

  const removeDatasource = (id: string) => {
    onChange(value.filter((v) => v !== id));
  };

  const addDatasource = (id: string) => {
    if (value.includes(id)) return;
    onChange([...value, id]);
  };

  const getDisplayName = (id: string): string =>
    available.find((d) => d.datasource_id === id)?.name || id;

  const selectableDatasources = available.filter(
    (ds) => !value.includes(ds.datasource_id),
  );
  const filteredDatasources = selectableDatasources.filter((ds) => {
    if (!search) return true;
    return ds.name.toLowerCase().includes(search.toLowerCase());
  });

  if (!ownerTeamSlug) {
    return (
      <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
        <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Choose an owner team first to pick its datasources</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading team datasources...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-destructive bg-destructive/10 rounded-lg">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium">Note:</span> Only datasources the owning
        team can see are listed here. Leaving this empty means the agent
        searches everything the caller can see, rather than nothing.
      </p>

      {value.length > 0 && (
        <div className="space-y-2">
          <Label>Configured Datasources</Label>
          {value.map((id) => (
            <Card key={id} className="border-primary/20">
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm truncate">
                    {getDisplayName(id)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeDatasource(id)}
                  disabled={disabled}
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectableDatasources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Add Datasource</Label>
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs w-1/3 mr-2"
            />
          </div>
          <div className="grid grid-cols-1 gap-1 max-h-64 overflow-y-auto border rounded-lg p-2">
            {filteredDatasources.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                No datasources match &ldquo;{search}&rdquo;
              </div>
            ) : (
              filteredDatasources.map((ds) => (
                <button
                  key={ds.datasource_id}
                  type="button"
                  onClick={() => addDatasource(ds.datasource_id)}
                  disabled={disabled}
                  className="flex items-center gap-3 p-2 rounded-md text-left transition-colors w-full min-w-0 hover:bg-muted"
                >
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm truncate">{ds.name}</span>
                  {ds.permission && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-auto shrink-0">
                      {ds.permission}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {value.length === 0 && selectableDatasources.length === 0 && (
        <div className="text-center p-8 text-muted-foreground border border-dashed rounded-lg">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">
            The owning team has no visible datasources yet — share a data
            source with this team from the Data Sources tab first.
          </p>
        </div>
      )}
    </div>
  );
}
