"use client";

import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Clock,
  Layers,
  Wrench,
  CheckCircle,
  AlertCircle,
  Activity,
  ZoomIn,
  ZoomOut,
  Download,
  Filter,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { A2AEvent } from "@/types/a2a";
import { cn } from "@/lib/utils";

interface A2ATimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: A2AEvent[];
  conversationId?: string;
}

interface TimelineEvent {
  id: string;
  type: A2AEvent["type"];
  displayName: string;
  startTime: number;
  endTime: number;
  duration: number;
  color: string;
  icon: React.ElementType;
  details: string;
  status?: string;
}

type TimelineZoom = "1x" | "2x" | "4x" | "8x";

export function A2ATimelineModal({
  isOpen,
  onClose,
  events,
  conversationId,
}: A2ATimelineModalProps) {
  const [zoom, setZoom] = useState<TimelineZoom>("2x");
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | A2AEvent["type"]>("all");

  // Parse events into timeline format
  const timelineEvents = useMemo(() => {
    if (events.length === 0) return [];

    const parsed: TimelineEvent[] = [];
    const toolStartMap = new Map<string, A2AEvent>();
    const taskStartMap = new Map<string, A2AEvent>();

    // Find the earliest timestamp to use as baseline
    const baseTime = Math.min(...events.map(e => e.timestamp.getTime()));

    events.forEach((event) => {
      const eventTime = event.timestamp.getTime();
      const relativeTime = eventTime - baseTime;

      // Handle tool_start/tool_end pairs
      if (event.type === "tool_start" && event.toolId) {
        toolStartMap.set(event.toolId, event);
      } else if (event.type === "tool_end" && event.toolId) {
        const startEvent = toolStartMap.get(event.toolId);
        if (startEvent) {
          const startTime = startEvent.timestamp.getTime() - baseTime;
          const endTime = relativeTime;
          parsed.push({
            id: event.id,
            type: "tool_start",
            displayName: event.displayName,
            startTime,
            endTime,
            duration: endTime - startTime,
            color: "bg-amber-500",
            icon: Wrench,
            details: event.displayContent,
            status: event.status,
          });
        }
      }

      // Handle single-point events (no duration)
      if (event.type === "task") {
        parsed.push({
          id: event.id,
          type: event.type,
          displayName: event.displayName,
          startTime: relativeTime,
          endTime: relativeTime + 100, // Small visual duration
          duration: 100,
          color: "bg-sky-500",
          icon: Activity,
          details: event.displayContent,
          status: event.status,
        });
      } else if (event.type === "artifact") {
        parsed.push({
          id: event.id,
          type: event.type,
          displayName: event.displayName,
          startTime: relativeTime,
          endTime: relativeTime + 100,
          duration: 100,
          color: "bg-purple-500",
          icon: Layers,
          details: event.displayContent,
        });
      } else if (event.type === "execution_plan") {
        parsed.push({
          id: event.id,
          type: event.type,
          displayName: event.displayName,
          startTime: relativeTime,
          endTime: relativeTime + 150,
          duration: 150,
          color: "bg-cyan-500",
          icon: CheckCircle,
          details: event.displayContent,
        });
      } else if (event.type === "status") {
        parsed.push({
          id: event.id,
          type: event.type,
          displayName: event.displayName,
          startTime: relativeTime,
          endTime: relativeTime + 80,
          duration: 80,
          color: "bg-green-500",
          icon: CheckCircle,
          details: event.displayContent,
          status: event.status,
        });
      } else if (event.type === "error") {
        parsed.push({
          id: event.id,
          type: event.type,
          displayName: event.displayName,
          startTime: relativeTime,
          endTime: relativeTime + 120,
          duration: 120,
          color: "bg-red-500",
          icon: AlertCircle,
          details: event.displayContent,
        });
      }
    });

    return parsed.sort((a, b) => a.startTime - b.startTime);
  }, [events]);

  // Calculate timeline dimensions
  const totalDuration = useMemo(() => {
    if (timelineEvents.length === 0) return 1000;
    return Math.max(...timelineEvents.map(e => e.endTime)) + 100;
  }, [timelineEvents]);

  // Zoom multipliers
  const zoomMultiplier = useMemo(() => {
    switch (zoom) {
      case "1x": return 0.5;
      case "2x": return 1;
      case "4x": return 2;
      case "8x": return 4;
      default: return 1;
    }
  }, [zoom]);

  const timelineWidth = totalDuration * zoomMultiplier;

  // Filter events
  const filteredEvents = useMemo(() => {
    if (filterType === "all") return timelineEvents;
    return timelineEvents.filter(e => e.type === filterType);
  }, [timelineEvents, filterType]);

  // Format time in milliseconds to readable format
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Download timeline data
  const downloadTimeline = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      conversationId,
      totalDuration: formatTime(totalDuration),
      eventCount: timelineEvents.length,
      events: timelineEvents.map(e => ({
        id: e.id,
        type: e.type,
        displayName: e.displayName,
        startTime: formatTime(e.startTime),
        endTime: formatTime(e.endTime),
        duration: formatTime(e.duration),
        details: e.details,
        status: e.status,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `a2a-timeline-${conversationId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const eventTypes: Array<"all" | A2AEvent["type"]> = [
    "all",
    "task",
    "artifact",
    "tool_start",
    "execution_plan",
    "status",
    "error",
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>A2A Event Timeline</DialogTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Visualizing {events.length} events over {formatTime(totalDuration)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadTimeline}
                disabled={timelineEvents.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <div className="flex items-center gap-1 border rounded-lg p-1">
                <Button
                  variant={zoom === "1x" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setZoom("1x")}
                  className="h-7 px-2"
                >
                  1x
                </Button>
                <Button
                  variant={zoom === "2x" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setZoom("2x")}
                  className="h-7 px-2"
                >
                  2x
                </Button>
                <Button
                  variant={zoom === "4x" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setZoom("4x")}
                  className="h-7 px-2"
                >
                  4x
                </Button>
                <Button
                  variant={zoom === "8x" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setZoom("8x")}
                  className="h-7 px-2"
                >
                  8x
                </Button>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Filters */}
        <div className="px-6 py-3 border-b bg-muted/30">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            {eventTypes.map((type) => (
              <Button
                key={type}
                variant={filterType === type ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilterType(type)}
                className="shrink-0"
              >
                {type === "all" ? "All" : type.replace("_", " ")}
                <Badge variant="secondary" className="ml-2">
                  {type === "all"
                    ? timelineEvents.length
                    : timelineEvents.filter(e => e.type === type).length}
                </Badge>
              </Button>
            ))}
          </div>
        </div>

        {/* Timeline View */}
        <div className="flex-1 overflow-hidden flex">
          {/* Event Labels */}
          <div className="w-48 border-r bg-muted/20 overflow-hidden flex flex-col">
            <div className="h-12 border-b px-4 flex items-center bg-background">
              <span className="text-sm font-medium text-muted-foreground">Events</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {filteredEvents.map((event) => {
                  const Icon = event.icon;
                  return (
                    <motion.button
                      key={event.id}
                      onClick={() => setSelectedEvent(event.id)}
                      className={cn(
                        "w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors",
                        selectedEvent === event.id
                          ? "bg-primary/20 border border-primary/50"
                          : "hover:bg-muted"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs truncate">{event.displayName}</span>
                    </motion.button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Timeline Canvas */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Time Ruler */}
            <div className="h-12 border-b bg-background overflow-x-auto scrollbar-modern">
              <div
                className="h-full relative"
                style={{ width: `${timelineWidth}px`, minWidth: "100%" }}
              >
                {Array.from({ length: Math.ceil(totalDuration / 1000) + 1 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/50"
                    style={{ left: `${i * 1000 * zoomMultiplier}px` }}
                  >
                    <span className="absolute top-2 left-2 text-[10px] text-muted-foreground font-mono">
                      {formatTime(i * 1000)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline Bars */}
            <ScrollArea className="flex-1">
              <div
                className="relative p-2"
                style={{ width: `${timelineWidth}px`, minWidth: "100%", height: `${filteredEvents.length * 48 + 16}px` }}
              >
                {filteredEvents.map((event, index) => {
                  const Icon = event.icon;
                  const isSelected = selectedEvent === event.id;
                  const barWidth = Math.max(event.duration * zoomMultiplier, 20);
                  const barLeft = event.startTime * zoomMultiplier;

                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="absolute"
                      style={{
                        top: `${index * 48}px`,
                        left: `${barLeft}px`,
                        width: `${barWidth}px`,
                        height: "40px",
                      }}
                    >
                      <motion.div
                        className={cn(
                          "h-full rounded-lg border-2 cursor-pointer flex items-center gap-2 px-3 transition-all",
                          event.color,
                          isSelected
                            ? "border-primary ring-2 ring-primary/50 scale-105"
                            : "border-transparent hover:border-primary/50"
                        )}
                        onClick={() => setSelectedEvent(isSelected ? null : event.id)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Icon className="h-4 w-4 text-white shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">
                            {event.displayName}
                          </p>
                          <p className="text-[10px] text-white/70">
                            {formatTime(event.duration)}
                          </p>
                        </div>
                      </motion.div>
                    </motion.div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Event Details Panel */}
        <AnimatePresence>
          {selectedEvent && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t bg-muted/30 overflow-hidden"
            >
              {(() => {
                const event = filteredEvents.find(e => e.id === selectedEvent);
                if (!event) return null;
                const Icon = event.icon;

                return (
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={cn("p-2 rounded-lg", event.color)}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold">{event.displayName}</h4>
                          <Badge variant="outline">{event.type}</Badge>
                          {event.status && (
                            <Badge variant="secondary">{event.status}</Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                          <div>
                            <span className="text-muted-foreground">Start:</span>
                            <span className="ml-2 font-mono">{formatTime(event.startTime)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">End:</span>
                            <span className="ml-2 font-mono">{formatTime(event.endTime)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Duration:</span>
                            <span className="ml-2 font-mono">{formatTime(event.duration)}</span>
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground">{event.details}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedEvent(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State */}
        {timelineEvents.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-muted flex items-center justify-center">
                <Clock className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No events to display</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Timeline will appear when A2A events are captured
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
