"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  UserPlus,
  Trash2,
  Crown,
  Shield,
  User,
  Pencil,
  Check,
  X,
} from "lucide-react";
import type { Team, TeamMember } from "@/types/teams";

type DialogMode = "details" | "members";

interface TeamDetailsDialogProps {
  team: Team | null;
  mode: DialogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTeamUpdated: () => void;
}

function getRoleIcon(role: string) {
  switch (role) {
    case "owner":
      return <Crown className="h-3.5 w-3.5 text-yellow-500" />;
    case "admin":
      return <Shield className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <User className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getRoleBadgeVariant(role: string) {
  switch (role) {
    case "owner":
      return "default" as const;
    case "admin":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function TeamDetailsDialog({
  team,
  mode,
  open,
  onOpenChange,
  onTeamUpdated,
}: TeamDetailsDialogProps) {
  const [activeMode, setActiveMode] = useState<DialogMode>(mode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit team fields
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  // Add member fields
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"member" | "admin">("member");
  const [addingMember, setAddingMember] = useState(false);

  // Removing member
  const [removingMember, setRemovingMember] = useState<string | null>(null);

  // Current team data (may be refreshed after mutations)
  const [currentTeam, setCurrentTeam] = useState<Team | null>(team);

  useEffect(() => {
    if (open && team) {
      setCurrentTeam(team);
      setActiveMode(mode);
      setIsEditing(false);
      setEditName(team.name);
      setEditDescription(team.description || "");
      setError(null);
      setNewMemberEmail("");
      setNewMemberRole("member");
    }
  }, [open, team, mode]);

  const refreshTeam = async () => {
    if (!currentTeam) return;
    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCurrentTeam(data.data.team);
        }
      }
    } catch (err) {
      console.error("[TeamDetails] Failed to refresh team:", err);
    }
  };

  const handleSaveEdit = async () => {
    if (!currentTeam) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update team");
      }

      setCurrentTeam(data.data.team);
      setIsEditing(false);
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to update team");
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentTeam || !newMemberEmail.trim()) return;

    setAddingMember(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/teams/${currentTeam._id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: newMemberEmail.trim(),
          role: newMemberRole,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to add member");
      }

      setCurrentTeam(data.data.team);
      setNewMemberEmail("");
      setNewMemberRole("member");
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (email: string) => {
    if (!currentTeam) return;

    if (!confirm(`Remove ${email} from ${currentTeam.name}?`)) return;

    setRemovingMember(email);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/teams/${currentTeam._id}/members?user_id=${encodeURIComponent(email)}`,
        { method: "DELETE" }
      );

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to remove member");
      }

      setCurrentTeam(data.data.team);
      onTeamUpdated();
    } catch (err: any) {
      setError(err.message || "Failed to remove member");
    } finally {
      setRemovingMember(null);
    }
  };

  if (!currentTeam) return null;

  const members = currentTeam.members || [];
  const sortedMembers = [...members].sort((a, b) => {
    const roleOrder = { owner: 0, admin: 1, member: 2 };
    return (roleOrder[a.role as keyof typeof roleOrder] ?? 2) -
           (roleOrder[b.role as keyof typeof roleOrder] ?? 2);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEditing ? "Edit Team" : currentTeam.name}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the team name and description"
              : currentTeam.description || "No description"}
          </DialogDescription>
        </DialogHeader>

        {/* Mode Tabs */}
        <div className="flex gap-1 border-b pb-2">
          <Button
            variant={activeMode === "details" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("details")}
            className="text-xs"
          >
            Details
          </Button>
          <Button
            variant={activeMode === "members" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveMode("members")}
            className="text-xs"
          >
            Members ({members.length})
          </Button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Details Mode */}
        {activeMode === "details" && (
          <div className="space-y-4 py-2">
            {isEditing ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="editName">Team Name</Label>
                  <Input
                    id="editName"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDesc">Description</Label>
                  <Textarea
                    id="editDesc"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    disabled={loading}
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={loading || !editName.trim()}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Check className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(currentTeam.name);
                      setEditDescription(currentTeam.description || "");
                      setError(null);
                    }}
                    disabled={loading}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">{currentTeam.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Description</span>
                    <span className="text-sm">{currentTeam.description || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Owner</span>
                    <span className="text-sm">{currentTeam.owner_id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Members</span>
                    <span className="text-sm">{members.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="text-sm">
                      {new Date(currentTeam.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  className="gap-1"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </>
            )}
          </div>
        )}

        {/* Members Mode */}
        {activeMode === "members" && (
          <div className="space-y-4 py-2 flex-1 min-h-0 flex flex-col">
            {/* Add Member Form */}
            <form onSubmit={handleAddMember} className="flex gap-2">
              <Input
                placeholder="user@example.com"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                disabled={addingMember}
                className="flex-1"
                type="email"
              />
              <select
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value as "member" | "admin")}
                disabled={addingMember}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <Button
                type="submit"
                size="sm"
                disabled={addingMember || !newMemberEmail.trim()}
                className="gap-1 h-9"
              >
                {addingMember ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                Add
              </Button>
            </form>

            {/* Members List */}
            <ScrollArea className="flex-1 -mx-1 px-1" style={{ maxHeight: "320px" }}>
              <div className="space-y-1">
                {sortedMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No members yet. Add members above.
                  </p>
                ) : (
                  sortedMembers.map((member) => (
                    <div
                      key={member.user_id}
                      className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm shrink-0">
                          {member.user_id.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm truncate">{member.user_id}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {new Date(member.added_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={getRoleBadgeVariant(member.role)} className="gap-1 text-xs">
                          {getRoleIcon(member.role)}
                          {member.role}
                        </Badge>
                        {member.role !== "owner" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveMember(member.user_id)}
                            disabled={removingMember === member.user_id}
                          >
                            {removingMember === member.user_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
