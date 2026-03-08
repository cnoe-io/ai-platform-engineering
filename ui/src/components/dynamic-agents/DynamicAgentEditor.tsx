"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Loader2, Globe, Users, Lock } from "lucide-react";
import type {
  DynamicAgentConfig,
  DynamicAgentConfigCreate,
  DynamicAgentConfigUpdate,
  VisibilityType,
  SubAgentRef,
  BuiltinToolsConfig,
} from "@/types/dynamic-agent";
import { AllowedToolsPicker } from "./AllowedToolsPicker";
import { BuiltinToolsPicker } from "./BuiltinToolsPicker";
import { SubagentPicker } from "./SubagentPicker";

interface DynamicAgentEditorProps {
  agent: DynamicAgentConfig | null; // null = creating new
  onSave: () => void;
  onCancel: () => void;
}

const VISIBILITY_OPTIONS: { value: VisibilityType; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    value: "private", 
    label: "Private", 
    icon: <Lock className="h-4 w-4" />,
    description: "Only you can use this agent" 
  },
  { 
    value: "team", 
    label: "Team", 
    icon: <Users className="h-4 w-4" />,
    description: "Share with specific teams" 
  },
  { 
    value: "global", 
    label: "Global", 
    icon: <Globe className="h-4 w-4" />,
    description: "Available to all users" 
  },
];

export function DynamicAgentEditor({ agent, onSave, onCancel }: DynamicAgentEditorProps) {
  const isEditing = !!agent;

  // Form state
  const [name, setName] = React.useState(agent?.name || "");
  const [description, setDescription] = React.useState(agent?.description || "");
  const [systemPrompt, setSystemPrompt] = React.useState(agent?.system_prompt || "");
  const [agentsMd, setAgentsMd] = React.useState(agent?.agents_md || "");
  const [extensionPrompt, setExtensionPrompt] = React.useState(agent?.extension_prompt || "");
  const [visibility, setVisibility] = React.useState<VisibilityType>(agent?.visibility || "private");
  const [allowedTools, setAllowedTools] = React.useState<Record<string, string[]>>(
    agent?.allowed_tools || {}
  );
  const [builtinTools, setBuiltinTools] = React.useState<BuiltinToolsConfig | undefined>(
    agent?.builtin_tools
  );
  const [subagents, setSubagents] = React.useState<SubAgentRef[]>(
    agent?.subagents || []
  );

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Tabs for the form sections
  const [activeSection, setActiveSection] = React.useState<"basic" | "instructions" | "tools" | "subagents">("basic");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isEditing) {
        // Update existing agent
        const updateData: DynamicAgentConfigUpdate = {
          name,
          description: description || undefined,
          system_prompt: systemPrompt,
          agents_md: agentsMd || undefined,
          extension_prompt: extensionPrompt || undefined,
          visibility,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
        };

        const response = await fetch(`/api/dynamic-agents?id=${agent._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to update agent");
        }
      } else {
        // Create new agent
        const createData: DynamicAgentConfigCreate = {
          name,
          description: description || undefined,
          system_prompt: systemPrompt,
          agents_md: agentsMd || undefined,
          extension_prompt: extensionPrompt || undefined,
          visibility,
          allowed_tools: allowedTools,
          builtin_tools: builtinTools,
          subagents: subagents.length > 0 ? subagents : undefined,
        };

        const response = await fetch("/api/dynamic-agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createData),
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to create agent");
        }
      }

      onSave();
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const isValid = name.trim() && systemPrompt.trim();

  const sections = [
    { id: "basic" as const, label: "Basic Info" },
    { id: "instructions" as const, label: "Instructions" },
    { id: "tools" as const, label: "Tools" },
    { id: "subagents" as const, label: "Subagents" },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <CardTitle>{isEditing ? "Edit Agent" : "Create Agent"}</CardTitle>
            <CardDescription>
              {isEditing
                ? "Update the agent configuration"
                : "Configure a new dynamic AI agent"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section tabs */}
          <div className="flex gap-1 border-b">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === section.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>

          {/* Basic Info Section */}
          {activeSection === "basic" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Agent Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  placeholder="e.g., Code Review Agent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="What does this agent do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Visibility</Label>
                <div className="grid grid-cols-3 gap-2">
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVisibility(opt.value)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        visibility === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-primary/50"
                      }`}
                      disabled={loading}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {opt.icon}
                        <span className="font-medium text-sm">{opt.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Instructions Section */}
          {activeSection === "instructions" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="systemPrompt">
                  System Prompt <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="systemPrompt"
                  placeholder="You are a helpful AI assistant that..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  disabled={loading}
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  The main instructions for the agent. This defines its behavior and capabilities.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="agentsMd">AGENTS.md (Optional)</Label>
                <Textarea
                  id="agentsMd"
                  placeholder="# Agent Instructions&#10;&#10;Additional context about the codebase, workflows, etc."
                  value={agentsMd}
                  onChange={(e) => setAgentsMd(e.target.value)}
                  disabled={loading}
                  rows={6}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Additional markdown instructions, similar to an AGENTS.md file. Can include project context,
                  coding standards, or workflow information.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="extensionPrompt">Extension Prompt (Optional)</Label>
                <Textarea
                  id="extensionPrompt"
                  placeholder="Additional instructions appended to the system prompt..."
                  value={extensionPrompt}
                  onChange={(e) => setExtensionPrompt(e.target.value)}
                  disabled={loading}
                  rows={4}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Platform-level instructions appended after the system prompt. Leave empty to use defaults.
                </p>
              </div>
            </div>
          )}

          {/* Tools Section */}
          {activeSection === "tools" && (
            <div className="space-y-6">
              {/* Built-in Tools */}
              <BuiltinToolsPicker
                value={builtinTools}
                onChange={setBuiltinTools}
                disabled={loading}
              />

              {/* MCP Tools */}
              <div className="space-y-4">
                <div>
                  <Label>MCP Tool Access</Label>
                  <p className="text-xs text-muted-foreground mb-4">
                    Select which MCP servers and tools this agent can use. If no servers are selected,
                    the agent will have no external tool access.
                  </p>
                </div>

                <AllowedToolsPicker
                  value={allowedTools}
                  onChange={setAllowedTools}
                  disabled={loading}
                />
              </div>
            </div>
          )}

          {/* Subagents Section */}
          {activeSection === "subagents" && (
            <div className="space-y-4">
              <div>
                <Label>Subagent Delegation</Label>
                <p className="text-xs text-muted-foreground mb-4">
                  Configure other dynamic agents that this agent can delegate tasks to.
                  The LLM will automatically decide when to use each subagent based on the description you provide.
                </p>
              </div>

              <SubagentPicker
                agentId={agent?._id || null}
                value={subagents}
                onChange={setSubagents}
                disabled={loading}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              <span>
                {builtinTools?.fetch_url?.enabled ? "1 built-in, " : ""}
                {Object.keys(allowedTools).length} MCP server(s), {subagents.length} subagent(s)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !isValid}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEditing ? "Saving..." : "Creating..."}
                  </>
                ) : isEditing ? (
                  "Save Changes"
                ) : (
                  "Create Agent"
                )}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
