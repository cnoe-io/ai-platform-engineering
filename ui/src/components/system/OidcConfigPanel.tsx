"use client";

import React, { useEffect, useState } from "react";
import { Shield, Save, TestTube, CheckCircle, XCircle, Loader2, Eye, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";

interface OidcConfigData {
  source?: 'env' | 'db';
  readonly?: boolean;
  // Per-field env-lock map — group-claim knobs can be individually overridden
  // by env vars even when the core OIDC config (issuer/clientId/clientSecret)
  // comes from the DB, so we need field-level granularity.
  envLockedFields?: {
    issuer?: boolean;
    clientId?: boolean;
    clientSecret?: boolean;
    groupClaim?: boolean;
    requiredGroup?: boolean;
    adminGroup?: boolean;
    adminViewGroup?: boolean;
  };
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  groupClaim?: string;
  requiredGroup?: string;
  adminGroup?: string;
  adminViewGroup?: string;
  enabled?: boolean;
  updated_at?: string;
  updated_by?: string;
}

const MASKED = '••••••••';

export function OidcConfigPanel() {
  const [config, setConfig] = useState<OidcConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'success' | 'failure' | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  // Form state
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState(MASKED);
  const [groupClaim, setGroupClaim] = useState("");
  const [requiredGroup, setRequiredGroup] = useState("");
  const [adminGroup, setAdminGroup] = useState("");
  const [adminViewGroup, setAdminViewGroup] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/admin/oidc-config")
      .then((r) => r.json())
      .then((data: OidcConfigData) => {
        setConfig(data);
        setIssuer(data.issuer ?? "");
        setClientId(data.clientId ?? "");
        setClientSecret(data.clientSecret ?? MASKED);
        setGroupClaim(data.groupClaim ?? "");
        setRequiredGroup(data.requiredGroup ?? "");
        setAdminGroup(data.adminGroup ?? "");
        setAdminViewGroup(data.adminViewGroup ?? "");
        setEnabled(data.enabled ?? true);
      })
      .catch(() => setError("Failed to load OIDC configuration."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/oidc-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuer,
          clientId,
          clientSecret: clientSecret === MASKED ? MASKED : clientSecret,
          groupClaim,
          requiredGroup,
          adminGroup,
          adminViewGroup,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save OIDC configuration.");
        return;
      }
      setSuccess("OIDC configuration saved. Reloading page to apply SSO changes…");
      // Re-mask the secret after save
      setClientSecret(MASKED);
      // Reload so RootLayout re-runs getServerConfigAsync() and injects the
      // updated ssoEnabled value into window.__APP_CONFIG__
      setTimeout(() => window.location.reload(), 1500);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`);
      setTestResult(res.ok ? 'success' : 'failure');
    } catch {
      setTestResult('failure');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Whole-form readonly when all three core OIDC settings are env-locked.
  const isReadonly = config?.source === 'env' || config?.readonly;
  const envLocks = config?.envLockedFields ?? {};
  // Are any individual fields env-locked while the form as a whole is still editable?
  // Happens when OIDC core is DB-configured but group-claim env vars are set.
  const hasPartialEnvLocks = !isReadonly && Object.values(envLocks).some(Boolean);

  // Helper: small "Set by environment" badge rendered next to a field label.
  const EnvLockBadge = ({ envVar }: { envVar: string }) => (
    <span
      title={`Overridden by ${envVar}; this form cannot change it. Update your deployment environment.`}
      className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
    >
      <Lock className="h-2.5 w-2.5" />
      Env
    </span>
  );

  return (
    <div className="space-y-4">
      {isReadonly && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription>
            <div className="font-semibold mb-1">OIDC is configured via environment variables</div>
            <div className="text-xs text-muted-foreground">
              The values shown below come from <code className="font-mono">OIDC_ISSUER</code>,{' '}
              <code className="font-mono">OIDC_CLIENT_ID</code>, and{' '}
              <code className="font-mono">OIDC_CLIENT_SECRET</code> in the deployment. Changes
              here will not take effect — update your Kubernetes Secret / environment and
              restart the pod.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {hasPartialEnvLocks && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription>
            <div className="font-semibold mb-1">Some fields are overridden by environment variables</div>
            <div className="text-xs text-muted-foreground">
              Fields marked <span className="font-mono">ENV</span> below are read from deployment
              environment variables and cannot be edited here. Other fields are stored in the
              database and can be updated normally.
            </div>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="oidc-enabled" className="text-sm font-medium">Enable OIDC SSO</Label>
          <Switch id="oidc-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={isReadonly} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="oidc-issuer" className="text-xs text-muted-foreground">Issuer URL</Label>
            {envLocks.issuer && <EnvLockBadge envVar="OIDC_ISSUER" />}
          </div>
          <div className="flex gap-2">
            <Input id="oidc-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://accounts.example.com" disabled={isReadonly || envLocks.issuer}
              className="text-sm" />
            <Button type="button" variant="outline" size="sm" onClick={handleTest}
              disabled={!issuer || testing} title="Test connection">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                testResult === 'success' ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> :
                testResult === 'failure' ? <XCircle className="h-3.5 w-3.5 text-destructive" /> :
                <TestTube className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="oidc-client-id" className="text-xs text-muted-foreground">Client ID</Label>
            {envLocks.clientId && <EnvLockBadge envVar="OIDC_CLIENT_ID" />}
          </div>
          <Input id="oidc-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)}
            placeholder="your-client-id" disabled={isReadonly || envLocks.clientId} className="text-sm" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Label htmlFor="oidc-client-secret" className="text-xs text-muted-foreground">Client Secret</Label>
            {envLocks.clientSecret && <EnvLockBadge envVar="OIDC_CLIENT_SECRET" />}
          </div>
          <div className="relative">
            <Input id="oidc-client-secret"
              type={showSecret ? "text" : "password"}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              onFocus={() => { if (clientSecret === MASKED) setClientSecret(""); }}
              onBlur={() => { if (!clientSecret) setClientSecret(MASKED); }}
              placeholder="Enter new client secret to change"
              disabled={isReadonly || envLocks.clientSecret}
              className="text-sm pr-10" />
            <button type="button" onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Leave masked to keep the existing secret.</p>
        </div>

        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Group Claims</p>
            <p className="text-[10px] text-muted-foreground">Comma-separate multiple groups: <span className="font-mono">group1, group2</span></p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="oidc-group-claim" className="text-xs text-muted-foreground">Group Claim Name</Label>
              {envLocks.groupClaim && <EnvLockBadge envVar="OIDC_GROUP_CLAIM" />}
            </div>
            <Input id="oidc-group-claim" value={groupClaim} onChange={(e) => setGroupClaim(e.target.value)}
              placeholder="groups (auto-detect if empty)" disabled={isReadonly || envLocks.groupClaim} className="text-sm" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="oidc-required-group" className="text-xs text-muted-foreground">Required Group (for access)</Label>
              {envLocks.requiredGroup && <EnvLockBadge envVar="OIDC_REQUIRED_GROUP" />}
            </div>
            <Input id="oidc-required-group" value={requiredGroup} onChange={(e) => setRequiredGroup(e.target.value)}
              placeholder="caipe-users" disabled={isReadonly || envLocks.requiredGroup} className="text-sm" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="oidc-admin-group" className="text-xs text-muted-foreground">Admin Group</Label>
              {envLocks.adminGroup && <EnvLockBadge envVar="OIDC_REQUIRED_ADMIN_GROUP" />}
            </div>
            <Input id="oidc-admin-group" value={adminGroup} onChange={(e) => setAdminGroup(e.target.value)}
              placeholder="caipe-admins" disabled={isReadonly || envLocks.adminGroup} className="text-sm" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="oidc-admin-view-group" className="text-xs text-muted-foreground">Admin View Group (read-only admin)</Label>
              {envLocks.adminViewGroup && <EnvLockBadge envVar="OIDC_REQUIRED_ADMIN_VIEW_GROUP" />}
            </div>
            <Input id="oidc-admin-view-group" value={adminViewGroup} onChange={(e) => setAdminViewGroup(e.target.value)}
              placeholder="caipe-viewers (empty = all users)" disabled={isReadonly || envLocks.adminViewGroup} className="text-sm" />
          </div>
        </div>
      </div>

      {config?.updated_by && (
        <p className="text-xs text-muted-foreground">
          Last updated by {config.updated_by} on {config.updated_at ? new Date(config.updated_at).toLocaleString() : "unknown"}
        </p>
      )}

      {!isReadonly && (
        <Button onClick={handleSave} disabled={saving || !issuer || !clientId} className="w-full">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          {saving ? "Saving…" : "Save OIDC Configuration"}
        </Button>
      )}
    </div>
  );
}
