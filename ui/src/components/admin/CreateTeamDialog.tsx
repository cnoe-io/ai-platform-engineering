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
import { MultiSelect } from "@/components/ui/multi-select";
import { Loader2 } from "lucide-react";

interface CreateTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function CreateTeamDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateTeamDialogProps) {
  const [teamName, setTeamName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // /api/admin/users returns Keycloak realm users in the shape
    // { users: [{ email, ... }], total, page, pageSize } (no success/data envelope).
    fetch("/api/admin/users?pageSize=100")
      .then((r) => r.json())
      .then((res) => {
        const users = Array.isArray(res?.users) ? res.users : res?.data?.users;
        if (Array.isArray(users)) {
          setUserEmails(
            users
              .map((u: { email?: string }) => u.email)
              .filter(Boolean)
          );
        }
      })
      .catch(() => {});
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/teams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: teamName,
          description: description || undefined,
          members: selectedMembers.length > 0 ? selectedMembers : undefined,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to create team");
      }

      // Reset form
      setTeamName("");
      setDescription("");
      setSelectedMembers([]);

      // Close dialog and trigger refresh
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      console.error("[CreateTeamDialog] Failed to create team:", err);
      setError(err.message || "Failed to create team");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setTeamName("");
      setDescription("");
      setSelectedMembers([]);
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Team</DialogTitle>
          <DialogDescription>
            Create a team to enable collaboration and conversation sharing among members.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Team Name */}
            <div className="space-y-2">
              <Label htmlFor="teamName">
                Team Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="teamName"
                placeholder="e.g., Platform Engineering Team"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="What is this team for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>

            {/* Members */}
            <div className="space-y-2">
              <Label>
                Members (Optional)
              </Label>
              <MultiSelect
                options={userEmails}
                selected={selectedMembers}
                onChange={setSelectedMembers}
                placeholder="Search and select members..."
                searchPlaceholder="Search by email..."
                emptyLabel="No users found"
                badgeLabel="members"
                className="w-full max-w-full"
              />
              <p className="text-xs text-muted-foreground">
                You will be added as the team owner automatically
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !teamName.trim()}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Team"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
