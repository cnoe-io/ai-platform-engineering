"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MappingClusterEditorProps {
  groupName: string;
  setGroupName: (value: string) => void;
  userEmail: string;
  setUserEmail: (value: string) => void;
  onDryRun: () => void;
  disabled?: boolean;
}

export function MappingClusterEditor({
  groupName,
  setGroupName,
  userEmail,
  setUserEmail,
  onDryRun,
  disabled,
}: MappingClusterEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manual preview</CardTitle>
        <CardDescription>
          Use this only to test a specific upstream group before creating sync rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="identity-group-name">External group name</Label>
            <Input
              id="identity-group-name"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Engineering Platform Users"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="identity-group-user">Resolved member email</Label>
            <Input
              id="identity-group-user"
              value={userEmail}
              onChange={(event) => setUserEmail(event.target.value)}
              placeholder="bob@example.test"
            />
          </div>
        </div>
        <Button onClick={onDryRun} disabled={disabled || !groupName.trim()}>
          Run dry-run
        </Button>
      </CardContent>
    </Card>
  );
}
