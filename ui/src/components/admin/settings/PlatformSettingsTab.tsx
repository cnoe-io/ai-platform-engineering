"use client";

// assisted-by Codex Codex-sonnet-4-6
// assisted-by claude code claude-sonnet-4-6
// assisted-by Cursor claude-opus-4-7

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
Dialog,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { AdminBadge } from "@/components/admin/shared/AdminBadge";
import { UnlinkedServiceAccountModal } from "@/components/admin/UnlinkedServiceAccountModal";
import { UserDefaultAgentsPanel } from "@/components/settings/DefaultAgents/UserDefaultAgentsPanel";
import { AgentPicker,type AgentPickerOption } from "@/components/ui/agent-picker";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";
import { AlertTriangle,Loader2,Shield } from "lucide-react";
import { useEffect,useState } from "react";

interface PlatformSettingsTabProps {
  isAdmin: boolean;
  readOnly?: boolean;
}

type PendingAction = "set" | "clear";

export function PlatformSettingsTab({ isAdmin, readOnly = false }: PlatformSettingsTabProps) {
  const [agents, setAgents] = useState<DynamicAgentConfig[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'success' | 'error' | null>(null);
  const [configSource, setConfigSource] = useState<string>('fallback');
  const [confirmAction, setConfirmAction] = useState<PendingAction | null>(null);
  const [anonymousModalOpen, setAnonymousModalOpen] = useState(false);

  useEffect(() => {
    // Sequence: hit /api/dynamic-agents/available FIRST so its side-effect
    // (auto-granting `user:*` `user` on every visibility:"global" agent in
    // OpenFGA) runs before we read the platform default. Otherwise a fresh
    // viewer can race: platform-config returns default_agent_id="hello-world",
    // but their agents list doesn't include it yet, making it look like there
    // is no platform default when there really is one.
    let cancelled = false;
    (async () => {
      const agentsRes = await fetch('/api/dynamic-agents/available')
        .then((r) => r.json())
        .catch(() => ({ data: [] }));
      if (cancelled) return;
      setAgents(agentsRes.data || []);
      setLoadingAgents(false);

      const configRes = await fetch('/api/admin/platform-config')
        .then((r) => r.json())
        .catch(() => ({ success: false }));
      if (cancelled) return;
      if (configRes.success) {
        const id = configRes.data.default_agent_id ?? null;
        setSelectedAgentId(id);
        setSavedAgentId(id);
        setConfigSource(configRes.data.source || 'fallback');
      }
      setLoadingConfig(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveClick = () => {
    if (!isAdmin || readOnly) return;
    if (selectedAgentId === savedAgentId) return;
    // Clearing the default → lighter confirmation.
    // Setting a new default → public-access confirmation.
    setConfirmAction(selectedAgentId === null ? "clear" : "set");
  };

  const handleConfirmSave = async () => {
    if (!isAdmin || readOnly) return;
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
  const savedAgentMissing = Boolean(savedAgentId) && !agents.find((a) => a._id === savedAgentId);
  // When the saved/selected agent isn't in the viewer's `available` list,
  // inject a synthetic picker option so the viewer still sees the configured
  // id (e.g. read-only admins or users whose access has not reconciled yet).
  const missingSelectedOption =
    selectedAgentId && !agents.find((a) => a._id === selectedAgentId)
      ? { _id: selectedAgentId, label: `${selectedAgentId} (not visible to you)` }
      : null;
  const platformPickerOptions: AgentPickerOption[] = [
    { value: "", label: "No default agent" },
    ...agents.map((agent) => ({ value: agent._id, label: agent.name })),
    ...(missingSelectedOption
      ? [{ value: missingSelectedOption._id, label: missingSelectedOption.label }]
      : []),
  ];
  const selectedAgentName = selectedAgent?.name ?? selectedAgentId ?? "this agent";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Default Agent</CardTitle>
          <CardDescription>
            Choose your personal defaults for new conversations
            {isAdmin
              ? ", or set the platform default for users who have not chosen one."
              : "."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Personal defaults — every signed-in user gets them. In an access
              preview (readOnly) writes are suppressed because the preferences
              API keys off the signed-in admin, not the previewed user. */}
          <UserDefaultAgentsPanel disabled={readOnly} />

          {/* Platform-wide default — admin only, below a divider mirroring the
              Release Notes settings layout. */}
          {isAdmin && (
            <div className="space-y-4 border-t pt-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Platform default agent</p>
                  <AdminBadge />
                </div>
                <p className="text-xs text-muted-foreground">
                  Choose the agent that opens new direct-message and Web UI chats for
                  users without a personal default. Select <em>No default agent</em> to
                  have users rely only on access granted through their teams.
                </p>
              </div>

              {loadingConfig || loadingAgents ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    data-testid="default-agent-access-note"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      Selecting an agent here makes it available to every signed-in user,
                      regardless of agent sharing permissions.
                    </span>
                  </div>

                  {savedAgentMissing && (
                    <div
                      className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-sm"
                      data-testid="default-agent-missing-banner"
                    >
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p>
                          The platform default agent (<code>{savedAgentId}</code>) is not
                          in your accessible agent list. This usually means it was
                          deleted, disabled, or you don&apos;t have permission to use
                          it.
                        </p>
                      </div>
                    </div>
                  )}

                  {configSource === 'env' && (
                    <p className="text-xs text-muted-foreground">
                      Currently using the deployment default (<code>DEFAULT_AGENT_ID</code>). Saving here
                      updates the live default.
                    </p>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="platform-default-agent" className="text-sm font-medium">
                      Agent for new chats
                    </label>
                    <AgentPicker
                      id="platform-default-agent"
                      ariaLabel="Platform default agent for new chats"
                      options={platformPickerOptions}
                      value={selectedAgentId ?? ''}
                      onChange={(value) => setSelectedAgentId(value || null)}
                      disabled={readOnly}
                      hideIdSuffix
                      placeholder="Select the platform default agent..."
                      searchPlaceholder="Search agents..."
                      emptyLabel="No agents match"
                      triggerClassName="max-w-sm md:ml-4"
                    />
                    {selectedAgent && (
                      <p className="text-xs text-muted-foreground">
                        {`Agent Description: ${selectedAgent.description}`}
                      </p>
                    )}
                  </div>

                  <div className="pt-2">
                    <SaveButton
                      onSave={handleSaveClick}
                      saving={saving}
                      dirty={selectedAgentId !== savedAgentId}
                      disabled={readOnly}
                      result={saveResult}
                      ariaLabel="Save platform default agent"
                      testId="default-agent-save"
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unlinked Access — platform-admin only */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              Unlinked Access
              <AdminBadge />
            </CardTitle>
            <CardDescription>
              Set the starting access for people who message the platform from Slack or Webex
              before they have signed in to the web UI. Agents and tools granted here are
              available to every unlinked caller and bot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setAnonymousModalOpen(true)}
              disabled={readOnly}
              data-testid="unlinked-access-button"
            >
              <Shield className="h-4 w-4" />
              Manage Unlinked Access
            </Button>
          </CardContent>
        </Card>
      )}

      {/* [TS-S3] Guard the modal under isAdmin so non-admins never mount it. */}
      {isAdmin && !readOnly && (
        <UnlinkedServiceAccountModal
          open={anonymousModalOpen}
          onOpenChange={setAnonymousModalOpen}
          isAdmin={isAdmin}
        />
      )}

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
                  Everyone who signs in will be able to use this agent for new chats until you
                  change the default. Connected Slack users may also see it in{" "}
                  <code>/caipe-list</code>.
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
                  New chats will no longer open with a default agent. Users will no longer have automatic
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
