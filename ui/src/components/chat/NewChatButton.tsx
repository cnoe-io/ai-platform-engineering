"use client";

import React, { useState, useEffect, useRef } from "react";
import { Plus, ChevronDown, Bot, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getConfig } from "@/lib/config";
import type { DynamicAgentConfig } from "@/types/dynamic-agent";

interface NewChatButtonProps {
  collapsed: boolean;
  onNewChat: (agentId?: string) => void;
}

export function NewChatButton({ collapsed, onNewChat }: NewChatButtonProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [agents, setAgents] = useState<DynamicAgentConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const dynamicAgentsEnabled = getConfig("dynamicAgentsEnabled");

  // Fetch available dynamic agents when dropdown opens
  useEffect(() => {
    if (!dropdownOpen || !dynamicAgentsEnabled) return;

    const fetchAgents = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/dynamic-agents/available");
        if (!response.ok) {
          throw new Error("Failed to fetch agents");
        }
        const data = await response.json();
        setAgents(data.data || []);
      } catch (err) {
        console.error("Error fetching dynamic agents:", err);
        setError("Failed to load agents");
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
  }, [dropdownOpen, dynamicAgentsEnabled]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    // Delay to prevent immediate close from trigger click
    setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dropdownOpen) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [dropdownOpen]);

  const handleMainClick = () => {
    // Main button always creates Platform Engineer chat
    onNewChat(undefined);
  };

  const handleDropdownToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDropdownOpen(!dropdownOpen);
  };

  const handleSelectAgent = (agentId?: string) => {
    setDropdownOpen(false);
    onNewChat(agentId);
  };

  // Collapsed mode: simple button without dropdown
  if (collapsed) {
    return (
      <Button
        onClick={handleMainClick}
        className="w-full px-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow"
        variant="ghost"
        size="icon"
      >
        <Plus className="h-4 w-4 shrink-0" />
      </Button>
    );
  }

  // If dynamic agents not enabled, show simple button
  if (!dynamicAgentsEnabled) {
    return (
      <Button
        onClick={handleMainClick}
        className="w-full gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow"
        variant="ghost"
        size="default"
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span className="whitespace-nowrap">New Chat</span>
      </Button>
    );
  }

  // Split button: main area + dropdown trigger
  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="flex w-full">
        {/* Main button area */}
        <Button
          onClick={handleMainClick}
          className={cn(
            "flex-1 gap-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow",
            "rounded-r-none border-r-0"
          )}
          variant="ghost"
          size="default"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="whitespace-nowrap">New Chat</span>
        </Button>

        {/* Dropdown trigger */}
        <Button
          onClick={handleDropdownToggle}
          className={cn(
            "px-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 hover-glow",
            "rounded-l-none",
            dropdownOpen && "bg-primary/20"
          )}
          variant="ghost"
          size="default"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              dropdownOpen && "rotate-180"
            )}
          />
        </Button>
      </div>

      {/* Dropdown menu */}
      {dropdownOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md bg-popover border border-border shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          <div className="py-1">
            {/* Platform Engineer option */}
            <button
              onClick={() => handleSelectAgent(undefined)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">Platform Engineer</div>
                <div className="text-xs text-muted-foreground truncate">
                  Default AI assistant
                </div>
              </div>
            </button>

            {/* Divider if there are dynamic agents */}
            {(loading || agents.length > 0 || error) && (
              <div className="h-px bg-border my-1" />
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading agents...</span>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Dynamic agents list */}
            {!loading && !error && agents.map((agent) => (
              <button
                key={agent._id}
                onClick={() => handleSelectAgent(agent._id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{agent.name}</div>
                  {agent.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {agent.description}
                    </div>
                  )}
                </div>
              </button>
            ))}

            {/* No dynamic agents */}
            {!loading && !error && agents.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No custom agents configured
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
