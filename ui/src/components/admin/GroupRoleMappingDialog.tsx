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
import { Loader2 } from "lucide-react";

interface IdpAlias {
  alias: string;
  displayName?: string;
  providerId: string;
}

interface Role {
  name: string;
}

interface GroupRoleMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  idpAliases: IdpAlias[];
  roles: Role[];
}

export function GroupRoleMappingDialog({
  open,
  onOpenChange,
  onSuccess,
  idpAliases,
  roles,
}: GroupRoleMappingDialogProps) {
  const [selectedIdp, setSelectedIdp] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && idpAliases.length > 0 && !selectedIdp) {
      setSelectedIdp(idpAliases[0].alias);
    }
    if (open && roles.length > 0 && !selectedRole) {
      setSelectedRole(roles[0].name);
    }
  }, [open, idpAliases, roles, selectedIdp, selectedRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/role-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idpAlias: selectedIdp,
          groupName: groupName.trim(),
          roleName: selectedRole,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to create mapping");
      }

      setGroupName("");
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create mapping";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setGroupName("");
      setError(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Map Group to Role</DialogTitle>
          <DialogDescription>
            Create a mapping so that users in the specified IdP group
            automatically receive the selected Keycloak role on login.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="idpAlias">
                Identity Provider <span className="text-destructive">*</span>
              </Label>
              <select
                id="idpAlias"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedIdp}
                onChange={(e) => setSelectedIdp(e.target.value)}
                disabled={loading || idpAliases.length === 0}
              >
                {idpAliases.length === 0 && (
                  <option value="">No identity providers configured</option>
                )}
                {idpAliases.map((idp) => (
                  <option key={idp.alias} value={idp.alias}>
                    {idp.displayName || idp.alias} ({idp.providerId})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupName">
                Group Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="groupName"
                placeholder="e.g., backstage-access"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                disabled={loading}
                required
              />
              <p className="text-xs text-muted-foreground">
                The AD/IdP group name (from the &quot;groups&quot; claim) that
                should receive this role
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetRole">
                Target Role <span className="text-destructive">*</span>
              </Label>
              <select
                id="targetRole"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                disabled={loading || roles.length === 0}
              >
                {roles.length === 0 && (
                  <option value="">No roles available</option>
                )}
                {roles.map((role) => (
                  <option key={role.name} value={role.name}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>

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
            <Button
              type="submit"
              disabled={
                loading ||
                !selectedIdp ||
                !groupName.trim() ||
                !selectedRole
              }
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Mapping"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
