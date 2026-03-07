"use client";

import React from "react";
import { Bot, ChevronDown, Check, Loader2 } from "lucide-react";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

interface AgentSelectorProps {
  selectedAgentId?: string; // undefined = default supervisor
  onSelectAgent: (agentId: string | undefined) => void;
  disabled?: boolean;
}

interface AgentOption {
  id: string;
  name: string;
  description?: string;
  isDefault?: boolean;
}

export function AgentSelector({ selectedAgentId, onSelectAgent, disabled }: AgentSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [agents, setAgents] = React.useState<DynamicAgentConfig[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Fetch available agents
  React.useEffect(() => {
    const fetchAgents = async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/dynamic-agents/available");
        const data = await response.json();
        if (data.success) {
          setAgents(data.data || []);
        } else {
          setError(data.error || "Failed to fetch agents");
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to fetch agents";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    fetchAgents();
  }, []);

  // Close on click outside
  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Build options list
  const options: AgentOption[] = React.useMemo(() => {
    const opts: AgentOption[] = [
      {
        id: "default",
        name: "Platform Engineer",
        description: "Default multi-agent supervisor",
        isDefault: true,
      },
    ];

    agents.forEach((agent) => {
      opts.push({
        id: agent._id,
        name: agent.name,
        description: agent.description,
      });
    });

    return opts;
  }, [agents]);

  // Find currently selected option
  const selectedOption = options.find(
    (opt) => (selectedAgentId ? opt.id === selectedAgentId : opt.isDefault)
  ) || options[0];

  const handleSelect = (optionId: string) => {
    if (optionId === "default") {
      onSelectAgent(undefined);
    } else {
      onSelectAgent(optionId);
    }
    setOpen(false);
  };

  // Don't show if no dynamic agents available
  if (!loading && agents.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled || loading}
        className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md px-3 gap-2 h-8"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Bot className="h-4 w-4" />
            <span className="max-w-[150px] truncate">{selectedOption?.name}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-72 p-1 max-h-80 overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-lg border border-border animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"
        >
          <div className="space-y-1">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Select Agent
            </p>
            {error ? (
              <p className="px-2 py-2 text-sm text-destructive">{error}</p>
            ) : (
              options.map((option) => {
                const isSelected = selectedAgentId
                  ? option.id === selectedAgentId
                  : option.isDefault;

                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelect(option.id)}
                    className={`w-full flex items-start gap-3 px-2 py-2 rounded-md text-left transition-colors ${
                      isSelected
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div
                      className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{option.name}</div>
                      {option.description && (
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {option.description}
                        </div>
                      )}
                      {option.isDefault && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Multi-agent with ArgoCD, GitHub, AWS, RAG...
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
