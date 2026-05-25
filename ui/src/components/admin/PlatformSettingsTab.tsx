"use client";

// assisted-by claude code claude-sonnet-4-6

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

interface PlatformSettingsTabProps {
  isAdmin: boolean;
}

export function PlatformSettingsTab({ isAdmin }: PlatformSettingsTabProps) {
  const [agents, setAgents] = useState<DynamicAgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [configSource, setConfigSource] = useState<string>('fallback');

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

  const handleSave = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/admin/platform-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_agent_id: selectedAgentId }),
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
    }
  };

  const selectedAgent = agents.find((a) => a._id === selectedAgentId);
  const savedAgentMissing = savedAgentId && !agents.find((a) => a._id === savedAgentId);

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
                onClick={handleSave}
                disabled={saving || selectedAgentId === savedAgentId}
                size="sm"
                className="gap-2"
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

    </div>
  );
}
