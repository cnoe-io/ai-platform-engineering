# Sandbox UI Mockup - Design Writeup

> **Status:** Mockup (throwaway branch `throwaway/ui-mockups`)
> **Date:** April 2026
> **Purpose:** Document the UI copy and design decisions for sandbox integration in Custom Agents

---

## Overview

This document captures the UI text and design patterns for integrating sandboxes into the Custom Agents feature. Sandboxes provide isolated execution environments where agents can safely run code, access files, and execute shell commands.

---

## 1. Agent Configuration (Step 5: Sandboxes)

### Step Header
- **Label:** Sandboxes
- **Hint:** Configure isolated execution environments

### Introduction Text
> Sandboxes provide isolated execution environments where your agent can safely run code, access files, and execute shell commands. Choose how sandboxes are assigned for this agent.

### Sandbox Mode Options

| Mode | Label | Description | Hint |
|------|-------|-------------|------|
| `none` | **No Sandbox** | Agent runs without an isolated environment | Best for simple agents that don't need file system or shell access |
| `static` | **Shared Sandbox** | Use a single sandbox for all users and chats | Ideal for read-only environments or shared team workspaces |
| `user_choice` | **User Chooses** | Let users pick which sandbox to use when starting a chat | Flexible - users can choose an existing sandbox or create a new one |
| `per_chat` | **Fresh Per Chat** | Automatically create a new sandbox for each conversation | Maximum isolation - each chat gets a clean environment |

### Static Sandbox Selection
When "Shared Sandbox" mode is selected:

**Section Label:** Select a Sandbox

**Description:**
> Choose an existing sandbox to use for all conversations, or create a new one.

**Empty State (no sandboxes):**
> You don't have any sandboxes yet.

**Button:** Create Your First Sandbox

**Warning (no sandbox selected):**
> Please select a sandbox to continue

### User Choice Mode Info Box
> **How it works:** When users start a new chat with this agent, they'll be prompted to select an existing sandbox or create a new one. They can also choose to proceed without a sandbox if the agent doesn't need one for their task.

### Fresh Per Chat Mode Info Box
> **How it works:** A fresh sandbox will be automatically created when each new conversation starts. The sandbox will be cleaned up after the chat ends (configurable retention period). This ensures complete isolation between sessions.

---

## 2. New Chat - Sandbox Selection

When starting a new chat with an agent that has "User Chooses" sandbox mode:

### Expanded Picker

**Header:** Choose a Sandbox *(optional)*

**Description:**
> This agent can use a sandbox for file and shell access. Select one or proceed without.

**Options:**
- "No sandbox" (default)
- List of user's available sandboxes

**Checkbox:**
> Remember my choice for new chats with this agent

**Collapse Button:**
> Hide sandbox options

### Collapsed State
Shows a pill button with current selection:
- "Sandbox: [Sandbox Name]" if selected
- "No sandbox selected" if none

---

## 3. Context Panel - Attached Sandbox

### Section Header
**Label:** Attached Sandbox

### Sandbox Card
Displays:
- Sandbox name
- Status indicator (Active / Hibernating)
- Detach button (Unplug icon)

### No Sandbox State

**Section Header:** Sandbox

**Empty State:**
> No sandbox attached

---

## 4. Sandboxes Tab (Custom Agents Page)

### Page Header
**Title:** Sandboxes

**Description:**
> Manage isolated execution environments for agents.

### Empty State
**Title:** No Sandboxes Yet

**Description:**
> Create your first sandbox to get started.

**Button:** Add Sandbox

### Table Columns
| Column | Description |
|--------|-------------|
| Name | Sandbox name and description |
| Visibility | private / team / global |
| Type | openshell (currently only type) |
| Status | Active / Hibernating (clickable to toggle) |
| Actions | Delete button |

---

## 5. Visual Design Notes

### Color Scheme
- **Sandbox theme:** Purple to Indigo gradient (`from-purple-500 to-indigo-600`)
- **Active status:** Green (`text-green-500`)
- **Hibernating status:** Yellow/Amber (`text-yellow-500`)
- **Detach action:** Destructive/Red on hover

### Icons Used
| Icon | Usage |
|------|-------|
| `Box` | Generic sandbox, no sandbox state |
| `Terminal` | Active sandbox with shell access |
| `Link` | Shared/static sandbox mode |
| `UserPlus` | User choice mode |
| `Sparkles` | Fresh per chat mode |
| `Play` | Active status |
| `Pause` | Hibernating status |
| `Unplug` | Detach action |
| `Plus` | Create new sandbox |

### Component Sizes
- **Context panel sandbox card:** Compact (h-7 w-7 icon, text-xs)
- **Agent editor sandbox options:** Full-width cards with icons and descriptions
- **Welcome screen picker:** Medium (max-w-md, p-2 items)

---

## 6. Future Considerations

### Not Yet Implemented
- Sandbox creation flow/dialog
- Sandbox type selection (currently hardcoded to "openshell")
- Per-datasource reload intervals for confluence
- Sandbox retention period configuration for "Fresh Per Chat" mode
- Team-level sandbox sharing

### API Requirements
- `GET /api/sandboxes` - List user's sandboxes
- `POST /api/sandboxes` - Create sandbox
- `DELETE /api/sandboxes/:id` - Delete sandbox
- `POST /api/sandboxes/:id/attach` - Attach to conversation
- `POST /api/sandboxes/:id/detach` - Detach from conversation
- `POST /api/sandboxes/:id/hibernate` - Hibernate sandbox
- `POST /api/sandboxes/:id/wake` - Wake hibernating sandbox

### Agent Config Schema Addition
```typescript
interface SandboxConfig {
  mode: "none" | "static" | "user_choice" | "per_chat";
  static_sandbox_id?: string; // Required when mode is "static"
  retention_hours?: number;   // For "per_chat" mode
}
```

---

## 7. Files Modified (Mockup)

| File | Changes |
|------|---------|
| `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx` | Added Step 5: Sandboxes with mode selection |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | Added Attached Sandbox section |
| `ui/src/components/dynamic-agents/SandboxesTab.tsx` | New tab for sandbox management |
| `ui/src/components/chat/DynamicAgentChatPanel.tsx` | Added sandbox picker to welcome screen |
| `ui/src/app/(app)/dynamic-agents/page.tsx` | Added Sandboxes tab to page |

---

## 8. Mock Data Used

```typescript
// Mock sandboxes
const MOCK_USER_SANDBOXES = [
  { _id: "sandbox-0", name: "Shubham Personal Sandbox", status: "active" },
  { _id: "sandbox-1", name: "Development Environment", status: "active" },
  { _id: "sandbox-2", name: "Team Shared Sandbox", status: "active" },
  { _id: "sandbox-3", name: "Testing Environment", status: "hibernating" },
];

// Mock attached sandbox (for context panel)
const MOCK_ATTACHED_SANDBOX = {
  _id: "sandbox-0",
  name: "Shubham Personal Sandbox",
  status: "active",
};

// Mock agent sandbox mode
const MOCK_AGENT_SANDBOX_MODE = "user_choice";
```
