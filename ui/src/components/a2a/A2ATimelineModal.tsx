"use client";

import React, { useMemo, useState } from "react";
import {
  X,
  Clock,
  Layers,
  Wrench,
  CheckCircle,
  AlertCircle,
  Activity,
  Download,
  ChevronDown,
  ChevronRight,
  Box,
  Radio,
  ListTodo,
  MessageSquare,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { A2AEvent } from "@/types/a2a";
import { cn } from "@/lib/utils";

interface A2ATimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: A2AEvent[];
  conversationId?: string;
}

export function A2ATimelineModal({
  isOpen,
  onClose,
  events,
  conversationId,
}: A2ATimelineModalProps) {
  const [viewMode, setViewMode] = useState<"flow" | "agents" | "trace">("flow");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Group events by agent
  const eventsByAgent = useMemo(() => {
    const groups = new Map<string, A2AEvent[]>();
    events.forEach(event => {
      const agent = event.sourceAgent || "supervisor";
      if (!groups.has(agent)) groups.set(agent, []);
      groups.get(agent)!.push(event);
    });
    return groups;
  }, [events]);

  const downloadTimeline = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      conversationId,
      eventCount: events.length,
      agents: Array.from(eventsByAgent.keys()),
      events: events.map(e => ({
        timestamp: e.timestamp.toISOString(),
        type: e.type,
        agent: e.sourceAgent || "supervisor",
        displayName: e.displayName,
        content: e.displayContent,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2a-events-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Radio className="h-5 w-5 text-primary" />
              <div>
                <DialogTitle>A2A Event Debugger</DialogTitle>
                <p className="text-sm text-muted-foreground">
                  {events.length} events • {eventsByAgent.size} agents
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTimeline}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-4 mt-2 grid grid-cols-3">
            <TabsTrigger value="flow">Event Flow</TabsTrigger>
            <TabsTrigger value="agents">By Agent</TabsTrigger>
            <TabsTrigger value="trace">Trace View</TabsTrigger>
          </TabsList>

          {/* Event Flow View */}
          <TabsContent value="flow" className="flex-1 overflow-hidden mt-2">
            <EventFlowView
              events={compressedEvents}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>

          {/* Agent Activity View */}
          <TabsContent value="agents" className="flex-1 overflow-hidden mt-2">
            <AgentGroupView
              eventsByAgent={eventsByAgent}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>

          {/* Trace View */}
          <TabsContent value="trace" className="flex-1 overflow-hidden mt-2">
            <TraceView
              events={compressedEvents}
              eventsByAgent={eventsByAgent}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>
        </Tabs>

        {/* Selected Event Details */}
        {selectedEventId && (
          <EventDetails
            event={events.find(e => e.id === selectedEventId)}
            onClose={() => setSelectedEventId(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Simple Event Flow View (chronological list)
function EventFlowView({
  events,
  selectedEventId,
  onSelectEvent,
}: {
  events: CompressedEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const getIcon = (type: A2AEvent["type"]) => {
    const icons: Record<string, React.ElementType> = {
      task: Activity,
      artifact: Layers,
      tool_start: Wrench,
      tool_end: CheckCircle,
      execution_plan: ListTodo,
      status: CheckCircle,
      error: AlertCircle,
      message: MessageSquare,
    };
    return icons[type] || Box;
  };

  const getTypeColor = (type: A2AEvent["type"]) => {
    const colors: Record<string, string> = {
      tool_start: "bg-amber-500",
      tool_end: "bg-green-500",
      artifact: "bg-purple-500",
      status: "bg-blue-500",
      execution_plan: "bg-cyan-500",
      error: "bg-red-500",
    };
    return colors[type] || "bg-gray-500";
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-3">
            {events.map((event, idx) => {
              const Icon = getIcon(event.type);
              const isSelected = event.compressedEventIds
                ? event.compressedEventIds.includes(selectedEventId || "")
                : selectedEventId === event.id;
              
              return (
                <div
                  key={event.id}
                  onClick={() => onSelectEvent(isSelected ? null : event.id)}
                  className={cn(
                    "relative pl-14 cursor-pointer group",
                    isSelected && "scale-[1.02]"
                  )}
                >
                  {/* Timeline dot */}
                  <div className={cn(
                    "absolute left-4 top-3 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center z-10 transition-all",
                    getTypeColor(event.type),
                    isSelected && "scale-125 ring-4 ring-primary/30"
                  )}>
                    <Icon className="h-3 w-3 text-white" />
                  </div>

                  {/* Event card */}
                  <div className={cn(
                    "p-3 rounded-lg border transition-all",
                    isSelected 
                      ? "bg-primary/10 border-primary shadow-md" 
                      : "bg-card border-border hover:border-primary/50 hover:shadow-sm"
                  )}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {event.type.replace("_", " ")}
                      </Badge>
                      {event.artifact?.name && (
                        <Badge variant="secondary" className="text-[10px]">
                          {event.artifact.name}
                        </Badge>
                      )}
                      {event.sourceAgent && (
                        <Badge variant="secondary" className="text-[10px]">
                          {event.sourceAgent}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {event.timestamp.toLocaleTimeString()}.{event.timestamp.getMilliseconds().toString().padStart(3, '0')}
                      </span>
                    </div>
                    <p className="text-xs font-medium mb-1">{event.displayName}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{event.displayContent}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// Agent Group View (grouped by agent, collapsible)
function AgentGroupView({
  eventsByAgent,
  selectedEventId,
  onSelectEvent,
}: {
  eventsByAgent: Map<string, CompressedEvent[]>;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["supervisor"]));

  const getIcon = (type: A2AEvent["type"]) => {
    const icons: Record<string, React.ElementType> = {
      task: Activity,
      artifact: Layers,
      tool_start: Wrench,
      tool_end: CheckCircle,
      execution_plan: ListTodo,
      status: CheckCircle,
      error: AlertCircle,
      message: MessageSquare,
    };
    return icons[type] || Box;
  };

  const getAgentColor = (agent: string) => {
    const colors: Record<string, string> = {
      supervisor: "bg-blue-500",
      argocd: "bg-orange-500",
      github: "bg-purple-500",
      jira: "bg-cyan-500",
      aws: "bg-yellow-500",
    };
    return colors[agent.toLowerCase()] || "bg-gray-500";
  };

  const toggle = (agent: string) => {
    const next = new Set(expanded);
    if (next.has(agent)) next.delete(agent);
    else next.add(agent);
    setExpanded(next);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-2">
        {Array.from(eventsByAgent).map(([agent, agentEvents]) => (
          <div key={agent} className="rounded-lg border bg-card">
            <button
              onClick={() => toggle(agent)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className={cn("w-3 h-3 rounded-full", getAgentColor(agent))} />
                <span className="font-semibold capitalize">{agent}</span>
                <Badge variant="secondary">{agentEvents.length}</Badge>
              </div>
              {expanded.has(agent) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>

            {expanded.has(agent) && (
              <div className="border-t p-3 space-y-2">
                {agentEvents.map(event => {
                  const Icon = getIcon(event.type);
                  const isSelected = event.compressedEventIds
                    ? event.compressedEventIds.includes(selectedEventId || "")
                    : selectedEventId === event.id;

                  return (
                    <div
                      key={event.id}
                      onClick={() => onSelectEvent(isSelected ? null : event.id)}
                      className={cn(
                        "flex items-start gap-2 p-2 rounded-lg border cursor-pointer",
                        isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"
                      )}
                    >
                      <div className={cn("p-1 rounded shrink-0", getAgentColor(agent))}>
                        <Icon className="h-3 w-3 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Badge variant="outline" className="text-[10px]">
                            {event.type === "tool_start" ? "Tool Start" :
                             event.type === "tool_end" ? "Tool End" :
                             event.type === "artifact" ? `Artifact: ${event.artifact?.name}` :
                             event.type === "status" ? "Status" :
                             event.type}
                          </Badge>
                          {event.compressedCount && event.compressedCount > 1 && (
                            <Badge variant="secondary" className="text-[10px] bg-primary/20">
                              ×{event.compressedCount}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{event.displayContent}</p>
                        <span className="text-[10px] text-muted-foreground/70 font-mono">
                          {event.timestamp.toLocaleTimeString('en-US', { hour12: false })}.{event.timestamp.getMilliseconds()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// Trace View (Time on X-axis horizontal, Each event = one row on Y-axis)
function TraceView({
  events,
  eventsByAgent,
  selectedEventId,
  onSelectEvent,
}: {
  events: CompressedEvent[];
  eventsByAgent: Map<string, CompressedEvent[]>;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const [zoom, setZoom] = useState(2);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No events to trace</p>
        </div>
      </div>
    );
  }

  // Sort all events chronologically
  const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  const minTime = sortedEvents[0].timestamp.getTime();
  const maxTime = sortedEvents[sortedEvents.length - 1].timestamp.getTime();
  const timeRange = maxTime - minTime || 1000;
  const timelineWidth = Math.max(1200, timeRange * zoom);

  const getIcon = (type: A2AEvent["type"]) => {
    const icons: Record<string, React.ElementType> = {
      tool_start: Wrench,
      tool_end: CheckCircle,
      artifact: Layers,
      status: Activity,
      execution_plan: ListTodo,
      error: AlertCircle,
      task: Activity,
      message: MessageSquare,
    };
    return icons[type] || Box;
  };

  const getAgentColor = (agent: string) => {
    const colors: Record<string, string> = {
      supervisor: "bg-blue-500",
      argocd: "bg-orange-500",
      github: "bg-purple-500",
      jira: "bg-cyan-500",
      aws: "bg-yellow-500",
      slack: "bg-green-500",
    };
    return colors[agent.toLowerCase()] || "bg-gray-500";
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Zoom Controls */}
      <div className="px-4 py-2 border-b flex items-center justify-between shrink-0 bg-background">
        <span className="text-xs text-muted-foreground">
          {sortedEvents.length} events • {formatTime(timeRange)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}
            className="h-7 px-2"
          >
            <ZoomOut className="h-3 w-3" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">{zoom.toFixed(1)}x</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom(Math.min(5, zoom + 0.5))}
            className="h-7 px-2"
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex">
          {/* Event Labels (left column - fixed) */}
          <div className="w-72 shrink-0 border-r bg-muted/10 sticky left-0 z-10">
            {/* Time ruler header */}
            <div className="h-10 border-b px-3 flex items-center bg-background">
              <span className="text-xs font-medium text-muted-foreground">Event</span>
            </div>
            
            {/* Event rows */}
            {sortedEvents.map((event) => {
              const Icon = getIcon(event.type);
              const agentColor = getAgentColor(event.sourceAgent || "supervisor");
              const isSelected = selectedEventId === event.id;

              // Build label
              let label = event.displayName;
              if (event.type === "artifact" && event.artifact?.name) {
                label = event.artifact.name;
              }

              return (
                <div
                  key={event.id}
                  onClick={() => onSelectEvent(isSelected ? null : event.id)}
                  className={cn(
                    "h-10 border-b px-3 flex items-center gap-2 cursor-pointer transition-colors",
                    isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                >
                  <div className={cn("p-1 rounded shrink-0", agentColor)}>
                    <Icon className="h-3 w-3 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {(event.sourceAgent || "supervisor").slice(0, 8)}
                    </Badge>
                    <span className="text-xs truncate">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline Area (horizontal bars) */}
          <div className="flex-1 relative" style={{ width: `${timelineWidth}px` }}>
            {/* Time Ruler */}
            <div className="h-10 border-b bg-background sticky top-0 z-10 relative">
              {Array.from({ length: Math.ceil(timeRange / 1000) + 1 }).map((_, i) => {
                const timeMs = i * 1000;
                const position = (timeMs / timeRange) * timelineWidth;
                
                return (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/30"
                    style={{ left: `${position}px` }}
                  >
                    <span className="absolute top-2 left-2 text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                      {formatTime(timeMs)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Event Bars (one row per event) */}
            {sortedEvents.map((event, index) => {
              const Icon = getIcon(event.type);
              const agentColor = getAgentColor(event.sourceAgent || "supervisor");
              const isSelected = selectedEventId === event.id;
              
              // Calculate horizontal position
              const eventTime = event.timestamp.getTime() - minTime;
              const xPosition = (eventTime / timeRange) * timelineWidth;
              const barWidth = Math.max(80, 120 * zoom); // Adaptive width

              return (
                <div key={event.id} className="h-10 border-b relative">
                  <div
                    className={cn(
                      "absolute top-1 h-8 rounded-md border-2 flex items-center gap-2 px-3 cursor-pointer transition-all overflow-hidden",
                      agentColor,
                      isSelected
                        ? "border-primary ring-2 ring-primary/30 scale-y-110 shadow-lg z-10"
                        : "border-white/20 hover:border-primary/40 hover:shadow-md"
                    )}
                    style={{
                      left: `${xPosition}px`,
                      width: `${barWidth}px`,
                    }}
                    onClick={() => onSelectEvent(isSelected ? null : event.id)}
                  >
                    <Icon className="h-3.5 w-3.5 text-white shrink-0" />
                    <span className="text-xs text-white font-medium truncate">
                      {event.displayName}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Event Details Panel
function EventDetails({
  event,
  onClose,
}: {
  event?: A2AEvent;
  onClose: () => void;
}) {
  if (!event) return null;

  return (
    <div className="border-t bg-muted/20 p-4 max-h-40 overflow-y-auto shrink-0">
      <div className="flex justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{event.displayName}</span>
          <Badge variant="outline" className="text-xs">{event.type}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-6 w-6">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="space-y-1.5 text-xs">
        {event.sourceAgent && (
          <div><span className="text-muted-foreground">Agent:</span> {event.sourceAgent}</div>
        )}
        {event.artifact?.name && (
          <div><span className="text-muted-foreground">Artifact:</span> {event.artifact.name}</div>
        )}
        <div><span className="text-muted-foreground">Time:</span> {event.timestamp.toLocaleTimeString()}</div>
        <p className="text-muted-foreground">{event.displayContent}</p>
      </div>
    </div>
  );
}
