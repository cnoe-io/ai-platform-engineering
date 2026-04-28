# Plan: DynamicAgentTimeline Integration

## Goal

Create a vertical timeline component for Dynamic Agents that provides visual consistency with the A2A `AgentTimeline`, showing streaming content, tools, files, tasks, subagents, and warnings/errors in a structured, collapsible format.

## Current State

- **A2A ChatPanel** uses `AgentTimeline` with `TimelineManager` for structured rendering
- **Dynamic Agents ChatPanel** uses `StreamingView` with `parseStreamSegments()` for inline event cards
- **FileTree** and **Todos** are currently in the sidebar (`EventContent` in `DynamicAgentContext.tsx`)
- SSE events include namespace correlation for subagent event attribution

## Design Decisions

| Item | Decision |
|------|----------|
| Content | All content except final answer in collapsible "Content" section |
| Final Answer | Last content segment - always visible, never collapsed |
| Tasks (Todos) | Collapsible section with progress bar (like A2A plan steps) |
| Tools | Collapsible group at same level as Content, Tasks, Files |
| Files | Collapsible group at same level as Tools (FileTree component) |
| Subagents | Collapsible section with nested Content + Tools groups |
| Warnings/Errors | Collapsible section at bottom, only if present |
| Sidebar | Remove Todos and FileTree; keep Agent Info only |
| Files/Todos scope | Shared filesystem and todos - render at parent level only |

## Files & Todos: Data Flow and Rendering Rules

### Data Source

Files and Todos are **not** SSE event segments - they are fetched via API:
- **Todos**: Fetched when `write_todos` tool_end event is received
- **Files**: Fetched when `write_file` or `edit_file` tool_end event is received
- **On chat load**: Check for existing files/todos via API and render in the **last assistant message**

### Rendering Rules

| Scenario | Files Behavior | Todos Behavior |
|----------|---------------|----------------|
| **Streaming (latest message)** | Show FileTree with download enabled | Show TaskList with live updates |
| **Completed (latest message)** | Show FileTree with download enabled | Show TaskList (readonly) |
| **Historical messages** | Show FileTree **readonly** (no download) | Show TaskList **readonly** |
| **On chat load** | Fetch via API, render in last message | Fetch via API, render in last message |

### Why only latest message allows download?

The agent's in-memory filesystem is ephemeral per session. When loading a chat:
- Files shown in historical messages may no longer exist in the filesystem
- Only the current session's files (latest message) are downloadable
- Historical file references are for context only (show what was created)

### Implementation Notes

1. `DynamicAgentTimeline` receives `isLatestMessage: boolean` prop
2. `FileTree` receives `readonly: boolean` prop - hides download/delete buttons when true
3. On chat load, UI calls `/api/dynamic-agents/conversations/{id}/files` and `/api/dynamic-agents/conversations/{id}/todos`
4. Files/todos are passed to the **last assistant message's** `DynamicAgentTimeline` only

## Visual Structure

```
┌─ DynamicAgentTimeline ────────────────────────────────────────────┐
│                                                                   │
│  [Summary Bar - collapsed when !isStreaming]                      │
│  "3 tools, 1 subagent, 2 files • 12s"                             │
│                                                                   │
│  ▼ Content (collapsible, collapsed when complete)                 │
│  │  "Let me analyze this request..."                              │
│  │  "I found some relevant code..."                               │
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
│  ▼ Tasks (collapsible, like A2A plan steps)                       │
│  │  ✓ Research existing codebase                                  │
│  │  ⟳ Implement feature                                           │
│  │  ○ Write tests                                                 │
│  │  Progress: [████████░░] 2/3                                    │
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
│  ▼ Tools (collapsible)                                            │
│  │  ◆ search_code                                         ✓       │
│  │  ◆ read_file                                           ✓       │
│  │  ◆ write_file                                          ✓       │
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
│  ▼ Files (collapsible)                                            │
│  │  📁 src/                                                       │
│  │     📄 utils.ts                                                │
│  │     📄 helper.ts                                               │
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
│  ▼ Subagent: Code Analyzer                                ✓       │
│  │  Purpose: "Analyze API endpoint structure"                     │
│  │                                                                │
│  │  ▼ Content (collapsible)                                       │
│  │  │  "Looking at the endpoint definitions..."                   │
│  │  │  "Based on my analysis..."                                  │
│  │  └─────────────────────────────────────────────────────────────│
│  │                                                                │
│  │  ▼ Tools (collapsible)                                         │
│  │  │  ◆ read_file                                        ✓       │
│  │  │  ◆ search_code                                      ✓       │
│  │  └─────────────────────────────────────────────────────────────│
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
│  ── Final Answer (NOT collapsed, always visible) ──               │
│  "Here's what I found: The API endpoints are..."                  │
│  (streaming cursor if still streaming)                            │
│                                                                   │
│  ▼ Warnings & Errors (collapsible, only if present)               │
│  │  ⚠ Missing tool: some_tool                                     │
│  │  ✖ Error: Connection timeout                                   │
│  └────────────────────────────────────────────────────────────────│
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Content & Tool Handling Strategy

### Content Grouping (Group by Type)

Unlike A2A which preserves temporal order, DA timeline **groups by type** for a cleaner view:

```
Agent streams: "Let me search" → tool:search → "Found it" → tool:write_file → "Done!"

Rendered as:
┌─────────────────────────────────────────────────────────┐
│  ▼ Content (collapsed)                                  │
│  │  "Let me search"                                     │
│  │  "Found it"                                          │
│  └──────────────────────────────────────────────────────│
│                                                         │
│  ▼ Tools                                                │
│  │  ◆ search — "looking for API endpoints"        ✓     │
│  │  ◆ write_file                                  ✓     │
│  └──────────────────────────────────────────────────────│
│                                                         │
│  ── Final Answer ──                                     │
│  "Done!"                                                │
└─────────────────────────────────────────────────────────┘
```

### Final Answer Detection

**Heuristic**: Content received **after the last `tool_end`** becomes the final answer.

```
Timeline:
  content₁ → tool_start₁ → tool_end₁ → content₂ → tool_start₂ → tool_end₂ → content₃

Result:
  Content section: content₁ + content₂ (before/between tools)
  Final Answer: content₃ (after last tool_end)
```

**Edge cases:**
- No tools called → all content is final answer (no "Content" section)
- Content only before/during tools → no final answer section until stream ends
- Streaming in progress → current content shows with cursor, reclassified when stream ends

**Implementation in `DATimelineManager`:**
- Track `lastToolEndIndex` - the index after which content is "final answer"
- On `finalize()`: content after `lastToolEndIndex` becomes final answer
- During streaming: all content after last tool_end shows as "current answer" with cursor

### Tool Thoughts Display

**Keep showing tool thoughts** inline, extracted from args:
- Parse args for: `thought`, `reason`, `thinking`, `rationale`, `explanation`, `description`
- Show truncated preview inline (60 chars max)
- Expandable on click to see full args JSON

```typescript
// In DAToolCard component - same logic as current InlineEventCard
const previewKeys = ["thought", "reason", "thinking", "rationale", "explanation", "description"];

function extractPreviewFromArgs(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  for (const key of previewKeys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      return trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed;
    }
  }
  return null;
}
```

### Subagent Content & Tools

Subagents also group their content and tools, rendered nested under the subagent section.
Files and Todos are NOT nested under subagents (shared at parent level).

## Data Model

### Types (`ui/src/types/dynamic-agent-timeline.ts`)

```typescript
export interface DAToolInfo {
  id: string;                           // tool_call_id
  name: string;                         // tool name
  args?: Record<string, unknown>;       // tool arguments (for thought extraction)
  status: "running" | "completed" | "failed";
}

export interface DASubagentInfo {
  id: string;                           // tool_call_id (namespace correlates to this)
  name: string;                         // agent name (from args.subagent_type)
  agentId?: string;                     // MongoDB agent_id
  purpose?: string;                     // from args.description
  status: "running" | "completed" | "failed";
}

export interface DASubagentData {
  info: DASubagentInfo;
  content: string;                      // Joined content from subagent
  tools: DAToolInfo[];                  // Subagent's tool calls
}

/** Grouped structure for rendering - NOT ordered segments */
export interface DATimelineData {
  // Content grouped by position relative to tools
  content: string;                      // All content before/between tools (joined)
  finalAnswer: string | null;           // Content after last tool_end (null if none yet)
  isStreaming: boolean;                 // Whether final answer is still streaming
  
  // Other groups
  tools: DAToolInfo[];                  // All root-level tool calls
  subagents: DASubagentData[];          // Subagent sections with nested content/tools
  warnings: string[];                   // Warning messages
  errors: string[];                     // Error messages
}
```

Note: `tasks` (TodoItem[]) and `files` (string[]) are managed separately via existing state/API, not as timeline segments.

### DATimelineManager (`ui/src/lib/da-timeline-manager.ts`)

```typescript
interface ContentChunk {
  text: string;
  timestamp: Date;
}

export class DATimelineManager {
  // ─── Grouped Storage ────────────────────────────────────────
  private rootContent: ContentChunk[] = [];
  private rootTools: DAToolInfo[] = [];
  private subagents: Map<string, {
    info: DASubagentInfo;
    content: ContentChunk[];
    tools: DAToolInfo[];
  }> = new Map();
  private warnings: string[] = [];
  private errors: string[] = [];
  
  // ─── Tracking ───────────────────────────────────────────────
  private lastToolEndTimestamp: Date | null = null;
  private isFinalized: boolean = false;
  
  // ─── Event Handlers ─────────────────────────────────────────
  pushContent(text: string, namespace: string[]): void {
    const chunk = { text, timestamp: new Date() };
    if (namespace.length === 0) {
      this.rootContent.push(chunk);
    } else {
      const subagentId = namespace[0];
      this.subagents.get(subagentId)?.content.push(chunk);
    }
  }
  
  pushToolStart(toolData: ToolStartEventData, namespace: string[]): void {
    if (toolData.tool_name === "task") {
      // Create subagent entry
      this.subagents.set(toolData.tool_call_id, {
        info: {
          id: toolData.tool_call_id,
          name: toolData.args?.subagent_type as string || "unknown",
          agentId: toolData.args?.subagent_type as string,
          purpose: toolData.args?.description as string,
          status: "running",
        },
        content: [],
        tools: [],
      });
    } else if (namespace.length === 0) {
      this.rootTools.push({
        id: toolData.tool_call_id,
        name: toolData.tool_name,
        args: toolData.args,
        status: "running",
      });
    } else {
      const subagentId = namespace[0];
      this.subagents.get(subagentId)?.tools.push({
        id: toolData.tool_call_id,
        name: toolData.tool_name,
        args: toolData.args,
        status: "running",
      });
    }
  }
  
  pushToolEnd(toolCallId: string, namespace: string[]): void {
    // Update tool status
    if (namespace.length === 0) {
      const tool = this.rootTools.find(t => t.id === toolCallId);
      if (tool) {
        tool.status = "completed";
        this.lastToolEndTimestamp = new Date();
      }
      // Check if this is a subagent completion
      const subagent = this.subagents.get(toolCallId);
      if (subagent) {
        subagent.info.status = "completed";
        this.lastToolEndTimestamp = new Date();
      }
    } else {
      const subagentId = namespace[0];
      const sub = this.subagents.get(subagentId);
      const tool = sub?.tools.find(t => t.id === toolCallId);
      if (tool) tool.status = "completed";
    }
  }
  
  pushWarning(message: string): void {
    this.warnings.push(message);
  }
  
  pushError(message: string): void {
    this.errors.push(message);
  }
  
  // ─── Finalization ───────────────────────────────────────────
  finalize(): void {
    this.isFinalized = true;
    // Mark all running tools as completed
    for (const tool of this.rootTools) {
      if (tool.status === "running") tool.status = "completed";
    }
    for (const sub of this.subagents.values()) {
      if (sub.info.status === "running") sub.info.status = "completed";
      for (const tool of sub.tools) {
        if (tool.status === "running") tool.status = "completed";
      }
    }
  }
  
  // ─── Output ─────────────────────────────────────────────────
  getGroupedData(): DATimelineData {
    // Split root content into "content" vs "finalAnswer"
    let contentChunks: ContentChunk[] = [];
    let finalAnswerChunks: ContentChunk[] = [];
    
    if (this.lastToolEndTimestamp) {
      for (const chunk of this.rootContent) {
        if (chunk.timestamp <= this.lastToolEndTimestamp) {
          contentChunks.push(chunk);
        } else {
          finalAnswerChunks.push(chunk);
        }
      }
    } else {
      // No tools called - all content is final answer
      finalAnswerChunks = this.rootContent;
    }
    
    return {
      content: contentChunks.map(c => c.text).join(""),
      finalAnswer: finalAnswerChunks.length > 0 
        ? finalAnswerChunks.map(c => c.text).join("")
        : null,
      isStreaming: !this.isFinalized,
      tools: this.rootTools,
      subagents: [...this.subagents.values()].map(s => ({
        info: s.info,
        content: s.content.map(c => c.text).join(""),
        tools: s.tools,
      })),
      warnings: this.warnings,
      errors: this.errors,
    };
  }
  
  getStats(): { toolCount: number; subagentCount: number; fileCount?: number } {
    return {
      toolCount: this.rootTools.length,
      subagentCount: this.subagents.size,
    };
  }
}
```

## Shared Components

Extract reusable components from `AgentTimeline.tsx`:

| Component | Source | Purpose |
|-----------|--------|---------|
| `StreamingMarkdown` | `ThinkingSegment` + `FinalAnswerSegment` | Markdown rendering with streaming cursor |
| `CollapsibleSection` | `ToolGroupDropdown` pattern | Generic expand/collapse with animation |
| `StatusBadge` | `ToolCallSegment` status logic | Status icon (running/completed/failed) |

New shared component:

| Component | Purpose |
|-----------|---------|
| `TaskList` | Todo items with progress bar (A2A plan-step style) |

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `ui/src/components/shared/timeline/StreamingMarkdown.tsx` | Markdown + streaming cursor |
| `ui/src/components/shared/timeline/CollapsibleSection.tsx` | Expand/collapse wrapper |
| `ui/src/components/shared/timeline/StatusBadge.tsx` | Status icon component |
| `ui/src/components/shared/timeline/TaskList.tsx` | Todo items with progress bar |
| `ui/src/components/shared/timeline/index.ts` | Barrel exports |
| `ui/src/types/dynamic-agent-timeline.ts` | DA timeline types |
| `ui/src/lib/da-timeline-manager.ts` | Event → segment manager |
| `ui/src/components/chat/DynamicAgentTimeline.tsx` | Main timeline component |

### Modified Files

| File | Changes |
|------|---------|
| `ui/src/components/chat/AgentTimeline.tsx` | Import shared components, keep A2A-specific logic |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | Replace `StreamingView` with `DynamicAgentTimeline` |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | Remove Todos and FileTree from `EventContent` |
| `ui/src/components/dynamic-agents/FileTree.tsx` | Add `readonly` prop to disable download/delete |

### Deprecated Code (to remove)

| Item | Location | Replaced By |
|------|----------|-------------|
| `parseStreamSegments()` | `DynamicAgentChatPanel.tsx` | `DATimelineManager` |
| `StreamingView` component | `DynamicAgentChatPanel.tsx` | `DynamicAgentTimeline` |
| `InlineEventCard` usage | `DynamicAgentChatPanel.tsx` | Timeline components |
| Todos section | `DynamicAgentContext.tsx` `EventContent` | `TaskList` in timeline |
| FileTree in sidebar | `DynamicAgentContext.tsx` `EventContent` | FileTree in timeline |

## Implementation Steps

### Phase 1: Shared Components

1. Create `ui/src/components/shared/timeline/` directory
2. Extract `StreamingMarkdown` from AgentTimeline
3. Extract `CollapsibleSection` pattern from AgentTimeline  
4. Extract `StatusBadge` from AgentTimeline
5. Create `TaskList` component (based on A2A PlanSegment style)
6. Create barrel export `index.ts`
7. Update `AgentTimeline.tsx` to import from shared

### Phase 2: DA Types & Manager

8. Create `ui/src/types/dynamic-agent-timeline.ts`
9. Create `ui/src/lib/da-timeline-manager.ts`
10. Write unit tests for DATimelineManager (optional)

### Phase 3: DynamicAgentTimeline Component

11. Create `ui/src/components/chat/DynamicAgentTimeline.tsx`

**Props:**
```typescript
interface DynamicAgentTimelineProps {
  segments: DATimelineSegment[];
  isStreaming: boolean;
  durationSec?: number;
  
  // Files & Todos - passed from parent, not from segments
  files: string[];
  todos: TodoItem[];
  
  // Controls readonly mode for historical messages
  isLatestMessage: boolean;
  
  // File operations (only active when isLatestMessage=true)
  onFileDownload?: (path: string) => void;
  onFileDelete?: (path: string) => void;
  isDownloadingFile?: boolean;
  downloadingFilePath?: string;
}
```

**Sub-components:**
    - `DATimelineSummary` - collapsed stats bar
    - `DAContentSection` - collapsible content
    - `DATaskSection` - collapsible tasks with progress bar
    - `DAToolSection` - collapsible tools
    - `DAFileSection` - collapsible file tree (respects isLatestMessage)
    - `DASubagentSection` - collapsible subagent with nested content/tools
    - `DAWarningSection` - collapsible warnings/errors

### Phase 4: Integration

12. Update `DynamicAgentChatPanel.tsx`:
    - Import `DATimelineManager` and `DynamicAgentTimeline`
    - Replace `StreamingView` usage with timeline
    - Wire up event processing through manager
    - Pass files and tasks as props (from existing state)

13. Update `DynamicAgentContext.tsx`:
    - Remove Todos section from `EventContent`
    - Remove FileTree from `EventContent`
    - Keep Agent Info section only

### Phase 5: Cleanup

14. Remove deprecated code:
    - `parseStreamSegments()` function
    - `StreamingView` component
    - `InlineEventCard` imports if unused elsewhere
    - Related type definitions

## Testing Plan

1. **Unit tests**: DATimelineManager event processing
2. **Visual testing**: 
   - Content collapsing behavior
   - Final answer visibility
   - Tool status transitions
   - Subagent nesting
   - File tree rendering
   - Task progress bar
   - Warning/error rendering
3. **Integration testing**:
   - SSE event streaming with timeline updates
   - Namespace correlation for subagents
   - Initial state loading (files, tasks from API)
   - History replay (loading past conversations)
   - **File download only on latest message** (historical = readonly)
   - **Todos/files render in last message on chat load**

## Chat Load Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User loads conversation (navigates to /chat/{conversationId})  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Fetch conversation history (messages + SSE events)          │
│     GET /api/dynamic-agents/conversations/{id}                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Fetch current files (if any exist in agent filesystem)      │
│     GET /api/dynamic-agents/conversations/{id}/files            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Fetch current todos (from LangGraph state)                  │
│     GET /api/dynamic-agents/conversations/{id}/todos            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Render messages                                             │
│     - Historical messages: timeline with readonly files/todos   │
│     - Last assistant message: timeline with files/todos from    │
│       API (download enabled)                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Open Questions

None - all decisions finalized.

## Dependencies

- `framer-motion` - for animations (already used)
- `lucide-react` - for icons (already used)
- `react-markdown` + `remark-gfm` - for markdown (already used)
