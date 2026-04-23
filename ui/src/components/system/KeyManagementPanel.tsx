"use client";

import React, { useState, useEffect } from "react";
import {
  RotateCw, Loader2, CheckCircle, Eye, EyeOff, Lock,
  Copy, Check, ShieldAlert, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

type KeySource = "environment" | "database" | null;

export function KeyManagementPanel() {
  const [keySource, setKeySource] = useState<KeySource>(null);
  const [keyFingerprint, setKeyFingerprint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-wrap state (env path)
  const [oldSecret, setOldSecret] = useState("");
  const [showOldSecret, setShowOldSecret] = useState(false);
  const [rewrapping, setRewrapping] = useState(false);
  const [rewrapError, setRewrapError] = useState<string | null>(null);
  const [rewrapCount, setRewrapCount] = useState<number | null>(null);
  const [confirmRewrap, setConfirmRewrap] = useState(false);

  useEffect(() => {
    fetch("/api/admin/rotate-keys")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setKeySource(d.source);
          setKeyFingerprint(d.fingerprint ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRewrap = async () => {
    setRewrapError(null);
    setRewrapping(true);
    setConfirmRewrap(false);
    try {
      const res = await fetch("/api/admin/rotate-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_master_secret: oldSecret.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setRewrapError(data.error || "Re-wrap failed.");
        return;
      }
      setRewrapCount(data.count ?? 0);
      setOldSecret("");
    } catch {
      setRewrapError("An unexpected error occurred.");
    } finally {
      setRewrapping(false);
    }
  };

  const [copied, setCopied] = useState(false);
  const copyGenCommand = async () => {
    await navigator.clipboard.writeText("openssl rand -base64 32");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Key in MongoDB: not yet secured ──────────────────────────────────
  if (keySource === "database") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-destructive/60 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-destructive">
                Encryption key stored in database
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                The master key exists in MongoDB alongside the data it encrypts.
                Move it outside the database — set <code className="font-mono text-[10px]">NEXTAUTH_SECRET</code>{" "}
                in a Kubernetes Secret or <code className="font-mono text-[10px]">.env.local</code>,
                then restart. CAIPE will rotate all encrypted data to the new key and
                remove it from the database. Warning disappears once the database no longer
                contains the key.
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground font-medium">
              1. Generate a secret:
            </p>
            <div className="flex gap-1">
              <code className="flex-1 text-[11px] font-mono bg-muted/70 rounded px-3 py-2 text-foreground">
                openssl rand -base64 32
              </code>
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={copyGenCommand}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground font-medium">
              2. Add to <code className="font-mono text-[10px]">.env.local</code> or a Kubernetes Secret:
            </p>
            <code className="block text-[11px] font-mono bg-muted/70 rounded px-3 py-2 text-foreground">
              NEXTAUTH_SECRET=&lt;generated-value&gt;
            </code>
            <p className="text-xs text-muted-foreground font-medium">
              3. Restart the server — CAIPE will use the new key automatically.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Environment key: secured ──────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Key secured in environment
            </p>
          </div>
          {keyFingerprint && (
            <code className="text-sm font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {keyFingerprint}
            </code>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          <code className="font-mono text-[10px]">NEXTAUTH_SECRET</code> is set externally.
          Encrypted secrets survive pod restarts and database changes.
        </p>
      </div>

      {/* Re-wrap section — for when env key was rotated */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="text-sm font-medium">Key rotation</h3>
        <p className="text-xs text-muted-foreground">
          If you update <code className="font-mono text-[10px]">NEXTAUTH_SECRET</code> and restart,
          CAIPE auto-detects the change and re-wraps all encrypted data. Use this only if you need
          to manually re-wrap after already updating the environment.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="old-secret" className="text-xs">
            Previous <code className="font-mono text-[10px]">NEXTAUTH_SECRET</code>{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="relative">
            <Input
              id="old-secret"
              type={showOldSecret ? "text" : "password"}
              placeholder="Only needed if env was already updated before restarting"
              value={oldSecret}
              onChange={e => setOldSecret(e.target.value)}
              className="font-mono text-xs pr-10"
              autoComplete="off"
            />
            <button type="button" onClick={() => setShowOldSecret(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}>
              {showOldSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {rewrapError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{rewrapError}</AlertDescription>
          </Alert>
        )}

        {rewrapCount !== null && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Re-wrap complete — {rewrapCount} secret{rewrapCount !== 1 ? "s" : ""} updated.
            </AlertDescription>
          </Alert>
        )}

        {!confirmRewrap && !rewrapping && (
          <Button variant="outline" size="sm" className="w-full gap-2"
            onClick={() => setConfirmRewrap(true)}>
            <RotateCw className="h-3.5 w-3.5" />
            Re-wrap Encrypted Data
          </Button>
        )}

        {confirmRewrap && (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={handleRewrap} className="flex-1 text-xs">
              Confirm
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmRewrap(false)} className="flex-1 text-xs">
              Cancel
            </Button>
          </div>
        )}

        {rewrapping && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Re-wrapping…
          </div>
        )}
      </div>
    </div>
  );
}
