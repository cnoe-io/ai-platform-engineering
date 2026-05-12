"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Shield, Save, RotateCcw, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CelTabPoliciesEditor } from "@/components/admin/CelTabPoliciesEditor";

interface PolicyData {
  name: string;
  content: string;
  is_system: boolean;
  updated_at?: string;
  updated_by?: string;
  exists: boolean;
}

interface PolicyTabProps {
  isAdmin: boolean;
}

export function PolicyTab({ isAdmin }: PolicyTabProps) {
  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const seedRes = await fetch("/api/policies/seed");
      if (!seedRes.ok) {
        console.warn("[PolicyTab] Seed endpoint returned", seedRes.status);
      }

      const res = await fetch("/api/policies");
      if (!res.ok) throw new Error("Failed to load policy");
      const data = await res.json();
      if (data.success) {
        setPolicy(data.data);
        setEditedContent(data.data.content || "");
        setHasChanges(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load policy";
      setMessage({ type: "error", text: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasChanges(value !== (policy?.content || ""));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save policy");
      }
      setPolicy((prev) => prev ? { ...prev, content: editedContent } : prev);
      setHasChanges(false);
      setMessage({ type: "success", text: "Policy saved successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setMessage({ type: "error", text: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset policy to the default from file? This will overwrite any changes.")) {
      return;
    }
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/policies?action=reset", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to reset");
      }
      await loadPolicy();
      setMessage({ type: "success", text: "Policy reset to default" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset";
      setMessage({ type: "error", text: msg });
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <CelTabPoliciesEditor isAdmin={isAdmin} />
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Global Tool Authorization Policy
            </CardTitle>
            <CardDescription>
              Answer Set Programming (ASP) policy governing tool access for system workflows.
              {!isAdmin && " Read-only access."}
            </CardDescription>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleReset}
                disabled={resetting || saving}
                className="gap-1.5"
              >
                {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Reset to Default
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="gap-1.5"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {message.text}
          </div>
        )}

        <Textarea
          value={editedContent}
          onChange={(e) => handleContentChange(e.target.value)}
          readOnly={!isAdmin}
          className="font-mono text-xs min-h-[500px] resize-y leading-relaxed"
          placeholder="% ASP policy rules..."
        />

        {policy?.updated_at && (
          <p className="text-[10px] text-muted-foreground">
            Last updated: {new Date(policy.updated_at).toLocaleString()}
            {policy.updated_by && ` by ${policy.updated_by}`}
          </p>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
