"use client";

// assisted-by claude code claude-sonnet-4-6
// assisted-by Cursor claude-opus-4-7

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

interface PlatformSettingsTabProps {
  isAdmin: boolean;
}

type PendingAction = "set" | "clear";

export function PlatformSettingsTab({ isAdmin }: PlatformSettingsTabProps) {
  const [agents, setAgents] = useState<DynamicAgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [configSource, setConfigSource] = useState<string>('fallback');
  const [confirmAction, setConfirmAction] = useState<PendingAction | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/dynamic-agents/available').then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/admin/platform-config').then((r) => r.json()).catch(() => ({ success: false })),
    ]).then(([agentsRes, configRes]) => {
      setAgents(agentsRes.data || []);
      setLoadingAgents(false);

      if (configRes.success) {
        const id = configRes.data.default_agent_id ?? null;
        setSelectedAgentId(id);
        setSavedAgentId(id);
        setConfigSource(configRes.data.source || 'fallback');
      }
      setLoadingConfig(false);
    });
  }, []);

  const handleSaveClick = () => {
    if (!isAdmin) return;
    if (selectedAgentId === savedAgentId) return;
    // Clearing the default → lighter confirmation.
    // Setting a new default → public-access confirmation.
    setConfirmAction(selectedAgentId === null ? "clear" : "set");
  };

  const handleConfirmSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/admin/platform-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_agent_id: selectedAgentId,
          // Always include the ack so the BFF can enforce it on set; the
          // BFF ignores the field for clears.
          acknowledge_public_access: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedAgentId(selectedAgentId);
        setConfigSource('db');
        setSaveResult('success');
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult('error');
      }
    } catch {
      setSaveResult('error');
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  };

  const selectedAgent = agents.find((a) => a._id === selectedAgentId);
  const savedAgentMissing = savedAgentId && !agents.find((a) => a._id === savedAgentId);
  const selectedAgentName = selectedAgent?.name ?? selectedAgentId ?? "this agent";

  if (loadingConfig || loadingAgents) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Default Agent</CardTitle>
          <CardDescription>
            Select which agent new chats open with. Admins can override this at runtime;
            it takes precedence over the <code>DEFAULT_AGENT_ID</code> Helm value.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex gap-2 px-3 py-2 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300 text-sm"
            data-testid="default-agent-public-banner"
          >
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">
                Whichever agent you pick here becomes available to every signed-in user.
              </p>
              <p className="text-xs">
                The platform default is the agent new users land on in direct messages and the
                Web UI before any team grants kick in. Choose <em>Default CAIPE Supervisor</em> if
                you don&apos;t want any agent to be public by default — users will only see agents
                their teams have granted them.
              </p>
            </div>
          </div>

          {savedAgentMissing && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              The previously configured default agent is no longer available. New chats will fall back to the supervisor.
            </div>
          )}

          {configSource === 'env' && (
            <p className="text-xs text-muted-foreground">
              Currently using <code>DEFAULT_AGENT_ID</code> env var as bootstrap default. Saving here overrides it at runtime.
            </p>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Default agent for new chats</label>
            <select
              value={selectedAgentId ?? ''}
              onChange={(e) => setSelectedAgentId(e.target.value || null)}
              disabled={!isAdmin}
              className="w-full max-w-sm h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60 md:ml-4"
            >
              <option value="">Default CAIPE Supervisor</option>
              {agents.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <p className="text-xs text-muted-foreground">{selectedAgent.description}</p>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleSaveClick}
                disabled={saving || selectedAgentId === savedAgentId}
                size="sm"
                className="gap-2"
                data-testid="default-agent-save"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
              {saveResult === 'success' && (
                <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved
                </span>
              )}
              {saveResult === 'error' && (
                <span className="text-sm text-destructive">Failed to save. Try again.</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirmAction(null);
        }}
      >
        <DialogContent>
          {confirmAction === "set" && (
            <>
              <DialogHeader>
                <DialogTitle>Make &ldquo;{selectedAgentName}&rdquo; the platform default?</DialogTitle>
                <DialogDescription>
                  Every signed-in user will be able to chat with this agent in direct messages and
                  the Web UI until you change this. Anyone in any Slack workspace connected to
                  CAIPE will see it in <code>/caipe-list</code>. New users get instant access on
                  first login.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmAction(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirmSave} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Make it the default
                </Button>
              </DialogFooter>
            </>
          )}
          {confirmAction === "clear" && (
            <>
              <DialogHeader>
                <DialogTitle>Remove platform default agent?</DialogTitle>
                <DialogDescription>
                  New chats will fall back to the supervisor. Users will no longer have automatic
                  access to the previous default agent unless their team grants it. Continue?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmAction(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirmSave} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Remove default
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
