"use client";

import React, { useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Clock,
  Layers,
  Wrench,
  CheckCircle,
  AlertCircle,
  Activity,
  Download,
  Filter,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Box,
  Radio,
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

type ViewMode = "sequence" | "agents" | "swimlane";

export function A2ATimelineModal({
  isOpen,
  onClose,
  events,
  conversationId,
}: A2ATimelineModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("sequence");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set(["supervisor"]));

  // Calculate timing
  const { baseTime, totalDuration } = useMemo(() => {
    if (events.length === 0) return { baseTime: 0, totalDuration: 0 };
    const times = events.map(e => e.timestamp.getTime());
    const base = Math.min(...times);
    const total = Math.max(...times) - base;
    return { baseTime: base, totalDuration: total };
  }, [events]);

  // Format time
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
  };

  // Group events by agent
  const eventsByAgent = useMemo(() => {
    const groups = new Map<string, A2AEvent[]>();
    
    events.forEach(event => {
      const agent = event.sourceAgent || "supervisor";
      if (!groups.has(agent)) {
        groups.set(agent, []);
      }
      groups.get(agent)!.push(event);
    });

    return groups;
  }, [events]);

  // Get agent color
  const getAgentColor = (agent: string) => {
    const colors: Record<string, string> = {
      supervisor: "bg-blue-500",
      argocd: "bg-orange-500",
      github: "bg-purple-500",
      jira: "bg-cyan-500",
      aws: "bg-yellow-500",
      slack: "bg-green-500",
      pagerduty: "bg-red-500",
    };
    return colors[agent.toLowerCase()] || "bg-gray-500";
  };

  // Download timeline
  const downloadTimeline = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      conversationId,
      totalDuration: formatTime(totalDuration),
      eventCount: events.length,
      agents: Array.from(eventsByAgent.keys()),
      events: events.map(e => ({
        id: e.id,
        timestamp: e.timestamp.toISOString(),
        type: e.type,
        displayName: e.displayName,
        sourceAgent: e.sourceAgent || "supervisor",
        displayContent: e.displayContent,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2a-timeline-${conversationId || "debug"}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleAgent = (agent: string) => {
    const newExpanded = new Set(expandedAgents);
    if (newExpanded.has(agent)) {
      newExpanded.delete(agent);
    } else {
      newExpanded.add(agent);
    }
    setExpandedAgents(newExpanded);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Radio className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>A2A Event Timeline</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {events.length} events • {formatTime(totalDuration)} • {eventsByAgent.size} agents
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTimeline}
              disabled={events.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </DialogHeader>

        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-2 pb-0 shrink-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="sequence">Sequence Diagram</TabsTrigger>
              <TabsTrigger value="agents">Agent Activity</TabsTrigger>
              <TabsTrigger value="swimlane">Swimlane Timeline</TabsTrigger>
            </TabsList>
          </div>

          {/* Sequence Diagram View */}
          <TabsContent value="sequence" className="flex-1 overflow-hidden mt-2">
            <SequenceDiagramView
              events={events}
              baseTime={baseTime}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>

          {/* Agent Activity View */}
          <TabsContent value="agents" className="flex-1 overflow-hidden mt-2">
            <AgentActivityView
              eventsByAgent={eventsByAgent}
              expandedAgents={expandedAgents}
              onToggleAgent={toggleAgent}
              getAgentColor={getAgentColor}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>

          {/* Swimlane Timeline View */}
          <TabsContent value="swimlane" className="flex-1 overflow-hidden mt-2">
            <SwimlaneTimelineView
              events={events}
              eventsByAgent={eventsByAgent}
              baseTime={baseTime}
              totalDuration={totalDuration}
              getAgentColor={getAgentColor}
              formatTime={formatTime}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
            />
          </TabsContent>
        </Tabs>

        {/* Selected Event Details */}
        <AnimatePresence>
          {selectedEventId && (
            <EventDetailsPanel
              event={events.find(e => e.id === selectedEventId)}
              onClose={() => setSelectedEventId(null)}
            />
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// Sequence Diagram View Component
function SequenceDiagramView({
  events,
  baseTime,
  selectedEventId,
  onSelectEvent,
}: {
  events: A2AEvent[];
  baseTime: number;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  // Extract participants (unique agents)
  const participants = useMemo(() => {
    const agents = new Set<string>(["user", "supervisor"]);
    events.forEach(e => {
      if (e.sourceAgent) agents.add(e.sourceAgent);
    });
    return Array.from(agents);
  }, [events]);

  // Build sequence flows
  const sequences = useMemo(() => {
    return events.map(event => {
      const from = event.sourceAgent ? "supervisor" : "user";
      const to = event.sourceAgent || "supervisor";
      const relativeTime = event.timestamp.getTime() - baseTime;
      
      // Build descriptive label
      let label = event.displayName;
      if (event.type === "tool_start" || event.type === "tool_end") {
        label = `🔧 ${event.displayName}`;
      } else if (event.type === "artifact") {
        label = `📦 ${event.artifact?.name || event.displayName}`;
      } else if (event.type === "status") {
        label = `✓ ${event.status?.state || "Status"}`;
      } else if (event.type === "execution_plan") {
        label = `📋 Execution Plan`;
      }
      
      return {
        id: event.id,
        from,
        to,
        label,
        content: event.displayContent,
        type: event.type,
        time: relativeTime,
      };
    });
  }, [events, baseTime]);

  return (
    <ScrollArea className="h-full">
      <div className="p-6 min-w-max">
        {/* Participants Header */}
        <div className="flex items-center justify-around mb-8 pb-4 border-b">
          {participants.map(participant => (
            <div key={participant} className="flex flex-col items-center gap-2 w-32">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Box className="h-6 w-6 text-primary" />
              </div>
              <span className="text-sm font-medium capitalize">{participant}</span>
            </div>
          ))}
        </div>

        {/* Sequence Flow */}
        <div className="space-y-6">
          {sequences.map((seq, index) => {
            const fromIndex = participants.indexOf(seq.from);
            const toIndex = participants.indexOf(seq.to);
            const isSelected = selectedEventId === seq.id;

            return (
              <div key={seq.id} className="relative">
                {/* Vertical lines for participants */}
                <div className="absolute top-0 bottom-0 flex justify-around w-full pointer-events-none">
                  {participants.map(p => (
                    <div key={p} className="w-32 flex justify-center">
                      <div className="w-0.5 h-full bg-border/30" />
                    </div>
                  ))}
                </div>

                {/* Message Arrow */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="relative flex items-center justify-around h-16 cursor-pointer group"
                  onClick={() => onSelectEvent(isSelected ? null : seq.id)}
                >
                  <div 
                    className={cn(
                      "absolute h-0.5 transition-all",
                      isSelected ? "bg-primary h-1" : "bg-muted-foreground/50 group-hover:bg-primary/70"
                    )}
                    style={{
                      left: `${(fromIndex / (participants.length - 1)) * 100}%`,
                      right: `${100 - (toIndex / (participants.length - 1)) * 100}%`,
                    }}
                  />
                  
                  {/* Arrow head */}
                  <div
                    className={cn(
                      "absolute w-0 h-0 border-t-4 border-b-4 border-l-8 transition-colors",
                      "border-t-transparent border-b-transparent",
                      isSelected ? "border-l-primary" : "border-l-muted-foreground/50 group-hover:border-l-primary/70"
                    )}
                    style={{
                      left: `calc(${(toIndex / (participants.length - 1)) * 100}% - 8px)`,
                    }}
                  />

                  {/* Message Label with Type Badge */}
                  <div
                    className={cn(
                      "absolute px-3 py-1.5 rounded-lg border transition-all flex items-center gap-2",
                      isSelected 
                        ? "bg-primary text-primary-foreground border-primary shadow-lg scale-105" 
                        : "bg-card border-border group-hover:border-primary/50 group-hover:shadow-md"
                    )}
                    style={{
                      left: `${((fromIndex + toIndex) / 2 / (participants.length - 1)) * 100}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    <span className="text-xs font-medium whitespace-nowrap">{seq.label}</span>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-[9px] px-1 py-0 h-4",
                        isSelected ? "border-primary-foreground/30" : ""
                      )}
                    >
                      {seq.type}
                    </Badge>
                  </div>

                  {/* Time marker */}
                  <div className="absolute -left-16 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-mono">
                    {formatTime(seq.time)}
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {sequences.length === 0 && (
          <div className="text-center py-12">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No sequence events to display</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );

  function formatTime(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

// Agent Activity View Component
function AgentActivityView({
  eventsByAgent,
  expandedAgents,
  onToggleAgent,
  getAgentColor,
  selectedEventId,
  onSelectEvent,
}: {
  eventsByAgent: Map<string, A2AEvent[]>;
  expandedAgents: Set<string>;
  onToggleAgent: (agent: string) => void;
  getAgentColor: (agent: string) => string;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const getEventIcon = (type: A2AEvent["type"]) => {
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

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-3">
        {Array.from(eventsByAgent.entries()).map(([agent, agentEvents]) => {
          const isExpanded = expandedAgents.has(agent);
          const agentColor = getAgentColor(agent);

          return (
            <div
              key={agent}
              className="rounded-lg border bg-card overflow-hidden"
            >
              {/* Agent Header */}
              <button
                onClick={() => onToggleAgent(agent)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-3 h-3 rounded-full", agentColor)} />
                  <h3 className="font-semibold capitalize">{agent}</h3>
                  <Badge variant="secondary">{agentEvents.length} events</Badge>
                </div>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {/* Agent Events */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t overflow-hidden"
                  >
                    <div className="p-3 space-y-2">
                      {agentEvents.map((event, idx) => {
                        const Icon = getEventIcon(event.type);
                        const isSelected = selectedEventId === event.id;

                        // Build detailed label
                        let typeLabel = event.type;
                        let detailLabel = "";
                        
                        if (event.type === "tool_start" || event.type === "tool_end") {
                          typeLabel = event.type === "tool_start" ? "Tool Started" : "Tool Completed";
                          detailLabel = event.displayName;
                        } else if (event.type === "artifact") {
                          typeLabel = "Artifact";
                          detailLabel = event.artifact?.name || event.displayName;
                        } else if (event.type === "status") {
                          typeLabel = "Status Update";
                          detailLabel = event.status?.state || "";
                        } else if (event.type === "execution_plan") {
                          typeLabel = "Execution Plan";
                          detailLabel = "Task orchestration";
                        }

                        return (
                          <motion.div
                            key={event.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.02 }}
                            onClick={() => onSelectEvent(isSelected ? null : event.id)}
                            className={cn(
                              "flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-all",
                              isSelected 
                                ? "bg-primary/10 border-primary shadow-sm" 
                                : "bg-muted/30 border-transparent hover:border-border hover:bg-muted/50"
                            )}
                          >
                            <div className={cn("p-1.5 rounded-md shrink-0", agentColor)}>
                              <Icon className="h-3.5 w-3.5 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {typeLabel}
                                </Badge>
                                {detailLabel && (
                                  <span className="text-xs font-medium">{detailLabel}</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {event.displayContent}
                              </p>
                              <span className="text-[10px] text-muted-foreground font-mono mt-1 block">
                                {event.timestamp.toLocaleTimeString()}.{event.timestamp.getMilliseconds().toString().padStart(3, '0')}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {eventsByAgent.size === 0 && (
          <div className="text-center py-12">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No agent activity to display</p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// Swimlane Timeline View Component
function SwimlaneTimelineView({
  events,
  eventsByAgent,
  baseTime,
  totalDuration,
  getAgentColor,
  formatTime,
  selectedEventId,
  onSelectEvent,
}: {
  events: A2AEvent[];
  eventsByAgent: Map<string, A2AEvent[]>;
  baseTime: number;
  totalDuration: number;
  getAgentColor: (agent: string) => string;
  formatTime: (ms: number) => string;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate timeline width (minimum 800px, scales with duration)
  const timelineWidth = Math.max(800, totalDuration * zoom);
  const pixelsPerMs = timelineWidth / (totalDuration || 1);

  const getEventIcon = (type: A2AEvent["type"]) => {
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

  return (
    <div className="h-full flex flex-col">
      {/* Zoom Controls */}
      <div className="px-4 py-2 border-b flex items-center justify-between shrink-0">
        <span className="text-xs text-muted-foreground">Duration: {formatTime(totalDuration)}</span>
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
            onClick={() => setZoom(Math.min(4, zoom + 0.5))}
            className="h-7 px-2"
          >
            <ZoomIn className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex min-h-full">
          {/* Agent Labels */}
          <div className="w-40 shrink-0 border-r bg-muted/20 sticky left-0 z-10">
            <div className="h-12 border-b px-4 flex items-center bg-background">
              <span className="text-xs font-medium text-muted-foreground">Agents</span>
            </div>
            {Array.from(eventsByAgent.keys()).map(agent => (
              <div key={agent} className="h-16 px-4 border-b flex items-center gap-2">
                <div className={cn("w-2.5 h-2.5 rounded-full", getAgentColor(agent))} />
                <span className="text-xs font-medium capitalize truncate">{agent}</span>
              </div>
            ))}
          </div>

          {/* Timeline Area */}
          <div className="flex-1 relative" ref={timelineRef}>
            {/* Time Grid */}
            <div className="h-12 border-b bg-background sticky top-0 z-10" style={{ width: `${timelineWidth}px` }}>
              {Array.from({ length: Math.ceil(totalDuration / 1000) + 1 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-border/30"
                  style={{ left: `${i * 1000 * pixelsPerMs}px` }}
                >
                  <span className="absolute top-2 left-2 text-[10px] text-muted-foreground font-mono">
                    {formatTime(i * 1000)}
                  </span>
                </div>
              ))}
            </div>

            {/* Agent Swimlanes */}
            {Array.from(eventsByAgent.entries()).map(([agent, agentEvents], laneIndex) => (
              <div
                key={agent}
                className="h-16 border-b relative bg-card/30"
                style={{ width: `${timelineWidth}px` }}
              >
                {agentEvents.map(event => {
                  const eventStart = event.timestamp.getTime() - baseTime;
                  const eventLeft = eventStart * pixelsPerMs;
                  const eventWidth = Math.max(80, 120 * zoom); // Wider bars for labels
                  const Icon = getEventIcon(event.type);
                  const isSelected = selectedEventId === event.id;

                  // Build compact label for the bar
                  let barLabel = "";
                  if (event.type === "tool_start" || event.type === "tool_end") {
                    barLabel = "🔧 " + event.displayName.split(" ").slice(0, 2).join(" ");
                  } else if (event.type === "artifact") {
                    barLabel = "📦 " + (event.artifact?.name || "Artifact");
                  } else if (event.type === "status") {
                    barLabel = "✓ " + (event.status?.state || "Status");
                  } else if (event.type === "execution_plan") {
                    barLabel = "📋 Plan";
                  } else {
                    barLabel = event.displayName.split(" ").slice(0, 2).join(" ");
                  }

                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="absolute top-2 cursor-pointer group"
                      style={{
                        left: `${eventLeft}px`,
                        width: `${eventWidth}px`,
                      }}
                      onClick={() => onSelectEvent(isSelected ? null : event.id)}
                    >
                      <div
                        className={cn(
                          "h-12 rounded-lg border-2 flex items-center gap-2 px-2 transition-all",
                          getAgentColor(agent),
                          isSelected
                            ? "border-primary ring-2 ring-primary/50 scale-105"
                            : "border-white/20 hover:border-white/40 hover:scale-105"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 text-white shrink-0" />
                        <span className="text-[10px] font-medium text-white truncate">
                          {barLabel}
                        </span>
                      </div>
                      
                      {/* Enhanced Tooltip */}
                      <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50 pointer-events-none">
                        <div className="bg-popover border border-border rounded-lg shadow-lg p-2 text-xs whitespace-nowrap">
                          <div className="font-semibold">{event.displayName}</div>
                          <div className="text-muted-foreground text-[10px] mt-0.5">
                            {event.timestamp.toLocaleTimeString()}.{event.timestamp.getMilliseconds().toString().padStart(3, '0')}
                          </div>
                          {event.artifact?.name && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              Artifact: <span className="font-mono">{event.artifact.name}</span>
                            </div>
                          )}
                          {event.status?.state && (
                            <div className="text-[10px] text-muted-foreground mt-1">
                              State: <span className="font-mono">{event.status.state}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Event Details Panel Component
function EventDetailsPanel({
  event,
  onClose,
}: {
  event?: A2AEvent;
  onClose: () => void;
}) {
  if (!event) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="border-t bg-muted/20 overflow-hidden shrink-0"
    >
      <div className="p-4 max-h-48 overflow-y-auto">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h4 className="font-semibold text-sm mb-1">{event.displayName}</h4>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">{event.type}</Badge>
              {event.sourceAgent && (
                <Badge variant="secondary" className="text-xs">
                  Agent: {event.sourceAgent}
                </Badge>
              )}
              {event.artifact?.name && (
                <Badge variant="secondary" className="text-xs">
                  Artifact: {event.artifact.name}
                </Badge>
              )}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground font-medium">Time:</span>
            <span className="ml-2 font-mono">{event.timestamp.toLocaleTimeString()}.{event.timestamp.getMilliseconds()}</span>
          </div>
          
          {event.type === "artifact" && event.artifact && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded p-2">
              <span className="text-muted-foreground font-medium">Artifact Details:</span>
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-[10px]">Name:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">
                    {event.artifact.name}
                  </code>
                </div>
                {event.artifact.description && (
                  <p className="text-[10px] text-muted-foreground">{event.artifact.description}</p>
                )}
              </div>
            </div>
          )}

          {(event.type === "tool_start" || event.type === "tool_end") && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded p-2">
              <span className="text-muted-foreground font-medium">Tool: </span>
              <span className="font-medium">{event.displayName}</span>
              <p className="mt-1 text-muted-foreground">{event.displayContent}</p>
            </div>
          )}

          {event.type === "status" && event.status && (
            <div className="bg-green-500/5 border border-green-500/20 rounded p-2">
              <span className="text-muted-foreground font-medium">Status Update:</span>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="text-xs">{event.status.state}</Badge>
                {event.status.message?.parts?.[0]?.text && (
                  <span className="text-[10px] text-muted-foreground">{event.status.message.parts[0].text}</span>
                )}
              </div>
            </div>
          )}

          {event.displayContent && !["tool_start", "tool_end", "status", "artifact"].includes(event.type) && (
            <div>
              <span className="text-muted-foreground font-medium">Content:</span>
              <p className="mt-1 text-muted-foreground">{event.displayContent}</p>
            </div>
          )}

          {event.taskId && (
            <div>
              <span className="text-muted-foreground font-medium">Task ID:</span>
              <code className="ml-2 bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono">
                {event.taskId.slice(0, 16)}...
              </code>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Missing imports for Agent Activity View
import { ListTodo, MessageSquare, ZoomIn, ZoomOut } from "lucide-react";
