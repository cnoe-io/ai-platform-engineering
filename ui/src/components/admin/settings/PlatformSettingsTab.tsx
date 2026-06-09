"use client";

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
import { UnlinkedServiceAccountModal } from "@/components/admin/UnlinkedServiceAccountModal";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";
import { AlertTriangle,Info,Loader2,Shield } from "lucide-react";
import { useEffect,useState } from "react";

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
  const [anonymousModalOpen, setAnonymousModalOpen] = useState(false);

  useEffect(() => {
    // Sequence: hit /api/dynamic-agents/available FIRST so its side-effect
    // (auto-granting `user:*` `user` on every visibility:"global" agent in
    // OpenFGA) runs before we read the platform default. Otherwise a fresh
    // viewer can race: platform-config returns default_agent_id="hello-world",
    // but their agents list doesn't include it yet, the <select> can't bind
    // to a non-existent option and silently falls through to the "Default
    // CAIPE Supervisor" placeholder option — making it look like the
    // platform default is the supervisor when it really isn't.
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
  const savedAgentMissing = Boolean(savedAgentId) && !agents.find((a) => a._id === savedAgentId);
  // When the saved/selected agent isn't in the viewer's `available` list,
  // we still inject a synthetic <option> for it so:
  //   1. <select> binds correctly (otherwise it silently falls through to
  //      the first option — the "Default CAIPE Supervisor" placeholder — and
  //      misleads the viewer into thinking the supervisor is the default).
  //   2. The viewer sees the actual configured agent id, even if they don't
  //      have `agent#use` on it (e.g. read-only admins, federated SSO users
  //      whose OpenFGA bootstrap hasn't fully reconciled yet).
  const missingSelectedOption =
    selectedAgentId && !agents.find((a) => a._id === selectedAgentId)
      ? { _id: selectedAgentId, label: `${selectedAgentId} (not visible to you)` }
      : null;
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
            Select which agent new chats open with across the Web UI <em>and</em> Slack
            (channel fallback when no route matches, and direct messages). Admins can
            override this at runtime; it takes precedence over the <code>DEFAULT_AGENT_ID</code>
            Helm value.
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
                {!isAdmin && (
                  <p className="text-xs">
                    You&apos;re viewing this in read-only mode, so the dropdown
                    above shows the configured agent id even though you can&apos;t
                    chat with it. Ask a full admin to verify or change the
                    default.
                  </p>
                )}
              </div>
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
              {missingSelectedOption && (
                <option
                  key={missingSelectedOption._id}
                  value={missingSelectedOption._id}
                  data-testid="default-agent-missing-option"
                >
                  {missingSelectedOption.label}
                </option>
              )}
            </select>
            {selectedAgent && (
              <p className="text-xs text-muted-foreground">{selectedAgent.description}</p>
            )}
          </div>

          {isAdmin && (
            <div className="pt-2">
              <SaveButton
                onSave={handleSaveClick}
                saving={saving}
                dirty={selectedAgentId !== savedAgentId}
                result={saveResult}
                testId="default-agent-save"
              />
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
            </CardTitle>
            <CardDescription>
              Manage scopes for the platform unlinked service account — the identity used
              for callers with no linked user (unlinked Slack users, Slack bots). These
              scopes set the base access every unlinked caller receives.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => setAnonymousModalOpen(true)}
              data-testid="unlinked-access-button"
            >
              <Shield className="h-4 w-4" />
              Manage Unlinked Access
            </Button>
          </CardContent>
        </Card>
      )}

      {/* [TS-S3] Guard the modal under isAdmin so non-admins never mount it. */}
      {isAdmin && (
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
