"use client";

import { useState } from "react";
import { GitBranch, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface RebacGraphTeamOption {
  slug: string;
  name: string;
}

export interface RebacGraphUserOption {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

function userLabel(user: RebacGraphUserOption): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const primary = name || user.email || user.username || user.id;
  const secondary = primary === user.id ? "" : ` (${user.id})`;
  return `${primary}${secondary}`;
}

export function RebacGraphFilters({
  teams,
  scope,
  allScopeValue,
  selectedUser,
  onScopeChange,
  onUserChange,
  onRender,
}: {
  teams: RebacGraphTeamOption[];
  scope: string;
  allScopeValue: string;
  selectedUser: RebacGraphUserOption | null;
  onScopeChange: (scope: string) => void;
  onUserChange: (user: RebacGraphUserOption | null) => void;
  onRender: () => void;
}) {
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<RebacGraphUserOption[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  async function searchUsers() {
    const query = userSearch.trim();
    if (!query) {
      setUserResults([]);
      return;
    }
    setSearchingUsers(true);
    setUserSearchError(null);
    try {
      const params = new URLSearchParams({ search: query, pageSize: "20" });
      const response = await fetch(`/api/admin/users?${params.toString()}`);
      if (!response.ok) throw new Error(`User search failed: ${response.status}`);
      const payload = await response.json();
      setUserResults(Array.isArray(payload.users) ? payload.users : []);
    } catch (err) {
      setUserSearchError(err instanceof Error ? err.message : "User search failed");
    } finally {
      setSearchingUsers(false);
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div>
        <Label htmlFor="graph-scope">Graph scope</Label>
        <select
          id="graph-scope"
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={scope}
          onChange={(event) => onScopeChange(event.target.value)}
        >
          <option value={allScopeValue}>All relationships in the system</option>
          {teams.map((team) => (
            <option key={team.slug} value={team.slug}>
              {team.name} ({team.slug})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="graph-user-search">User filter</Label>
        <div className="mt-1 flex gap-2">
          <input
            id="graph-user-search"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Search by name, email, or username"
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void searchUsers();
              }
            }}
          />
          <Button type="button" variant="outline" className="gap-2" onClick={() => void searchUsers()}>
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>
        {selectedUser && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="min-w-0 truncate">
              Showing graph for <strong>{userLabel(selectedUser)}</strong>
            </span>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1" onClick={() => onUserChange(null)}>
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        )}
        {userSearchError && (
          <p className="mt-2 text-xs text-destructive">{userSearchError}</p>
        )}
        {userResults.length > 0 && (
          <div className="mt-2 max-h-44 overflow-auto rounded-md border bg-background">
            {userResults.map((user) => (
              <button
                key={user.id}
                type="button"
                className="block w-full border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted"
                onClick={() => {
                  onUserChange(user);
                  setUserResults([]);
                  setUserSearch(user.email || user.username || user.id);
                }}
              >
                <span className="block font-medium">{userLabel(user)}</span>
                <span className="block text-muted-foreground">user:{user.id}</span>
              </button>
            ))}
          </div>
        )}
        {searchingUsers && <p className="mt-2 text-xs text-muted-foreground">Searching users...</p>}
      </div>
      <Button variant="outline" className="self-end gap-2" onClick={onRender}>
        <GitBranch className="h-4 w-4" />
        Render graph
      </Button>
    </div>
  );
}
