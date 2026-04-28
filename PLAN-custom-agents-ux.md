# Custom Agents Builder UX Makeover

## Overview

Transform the Dynamic Agent Builder into a step-by-step wizard with better UX, rename "Dynamic Agents" to "Custom Agents" throughout, and add visibility-based subagent filtering.

## Decisions

| Decision | Choice |
|----------|--------|
| Breaking changes | OK - not GA, will delete existing agent configs |
| Step navigation | Free navigation (steps are guides, not enforced) |
| Save button | Enabled when required fields filled (same as current) |
| Subagent visibility | Filter by current selection in UI + enforce in backend |
| Tool search | Per expanded server (not global) |
| Step indicator | Horizontal stepper |
| Mobile responsive | Not a priority (admin-only feature) |

---

## Phase 1: Rename "Dynamic Agents" → "Custom Agents"

**Files to modify:**

| File | Line | Change |
|------|------|--------|
| `ui/src/app/(app)/dynamic-agents/page.tsx` | ~55 | `<h1>Dynamic Agents</h1>` → `<h1>Custom Agents</h1>` |
| `ui/src/app/(app)/dynamic-agents/page.tsx` | ~41 | Error message: "Dynamic Agents configuration" → "Custom Agents configuration" |
| `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx` | ~132 | `<CardTitle>Dynamic Agents</CardTitle>` → `<CardTitle>Custom Agents</CardTitle>` |
| `ui/src/components/layout/AppHeader.tsx` | ~332 | Nav tab: `Dynamic Agents` → `Custom Agents` |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | ~705 | Label: `Dynamic Agent` → `Custom Agent` |

**Note:** File/folder names remain `dynamic-agents` to avoid large refactors.

---

## Phase 2: Backend - Remove `agents_md` and `extension_prompt`

These fields are being consolidated into a single `system_prompt` field.

### Python Backend

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py`

Remove from:
- `DynamicAgentConfig` - remove `agents_md: str | None` and `extension_prompt: str | None`
- `DynamicAgentConfigCreate` - remove same fields
- `DynamicAgentConfigUpdate` - remove same fields

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mongo.py`

- Remove `agents_md` and `extension_prompt` from `create_agent()` document construction

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`

- Remove from `_build_system_prompt()` method - no longer concatenate these fields

### UI/API

**File:** `ui/src/types/dynamic-agent.ts`

- Remove `agents_md?: string` and `extension_prompt?: string` from all interfaces

**File:** `ui/src/app/api/dynamic-agents/route.ts`

- Remove from POST handler field list
- Remove from PUT handler field list

---

## Phase 3: Backend - Add Subagent Visibility Validation

Add validation in both Next.js API routes (used by UI) and Python backend (for API consumers).

### 3a. Next.js API Route

**File:** `ui/src/app/api/dynamic-agents/route.ts`

Add validation in POST and PUT handlers before saving:

```typescript
// Visibility rules:
// - Private agent → can use private, team, or global subagents
// - Team agent → can use team or global subagents
// - Global agent → can only use global subagents

async function validateSubagentVisibility(
  parentVisibility: string,
  subagents: SubAgentRef[],
  collection: Collection
): Promise<{ valid: boolean; error?: string }> {
  
  for (const subagent of subagents) {
    const subagentConfig = await collection.findOne({ _id: subagent.agent_id });
    if (!subagentConfig) {
      return { valid: false, error: `Subagent ${subagent.agent_id} not found` };
    }
    
    const subVis = subagentConfig.visibility;
    
    // Global parent can only use global subagents
    if (parentVisibility === "global" && subVis !== "global") {
      return { 
        valid: false, 
        error: `Global agents can only use global subagents. "${subagentConfig.name}" is ${subVis}.` 
      };
    }
    
    // Team parent can use team or global subagents
    if (parentVisibility === "team" && subVis === "private") {
      return { 
        valid: false, 
        error: `Team agents can only use team or global subagents. "${subagentConfig.name}" is private.` 
      };
    }
    
    // Private parent can use any visibility (private, team, or global)
    // No restrictions needed
  }
  
  return { valid: true };
}
```

### 3b. Python FastAPI Backend

**File:** `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/agents.py`

Add the same validation logic for POST (`create_agent`) and PATCH (`update_agent`) endpoints:

```python
from dynamic_agents.models import VisibilityType

def validate_subagent_visibility(
    parent_visibility: VisibilityType,
    subagents: list[dict],
    mongo: MongoDBService,
) -> tuple[bool, str | None]:
    """Validate that subagents have compatible visibility with parent.
    
    Rules:
    - Private agent → can use private, team, or global subagents
    - Team agent → can use team or global subagents
    - Global agent → can only use global subagents
    """
    for subagent_ref in subagents:
        subagent = mongo.get_agent(subagent_ref.get("agent_id"))
        if not subagent:
            return False, f"Subagent {subagent_ref.get('agent_id')} not found"
        
        sub_vis = subagent.visibility
        
        # Global parent can only use global subagents
        if parent_visibility == VisibilityType.GLOBAL and sub_vis != VisibilityType.GLOBAL:
            return False, f'Global agents can only use global subagents. "{subagent.name}" is {sub_vis.value}.'
        
        # Team parent can use team or global subagents
        if parent_visibility == VisibilityType.TEAM and sub_vis == VisibilityType.PRIVATE:
            return False, f'Team agents can only use team or global subagents. "{subagent.name}" is private.'
        
        # Private parent can use any visibility - no restrictions
    
    return True, None
```

Usage in `create_agent`:

```python
@router.post("", response_model=ApiResponse)
async def create_agent(
    config: DynamicAgentConfigCreate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    # ... existing validation ...
    
    # Validate subagent visibility
    if config.subagents:
        valid, error = validate_subagent_visibility(
            config.visibility or VisibilityType.PRIVATE,
            [s.model_dump() for s in config.subagents],
            mongo,
        )
        if not valid:
            raise HTTPException(status_code=400, detail=error)
    
    agent = mongo.create_agent(config, owner_id=user.email)
    # ...
```

Usage in `update_agent`:

```python
@router.patch("/{agent_id}", response_model=ApiResponse)
async def update_agent(
    agent_id: str,
    update: DynamicAgentConfigUpdate,
    user: UserContext = Depends(require_admin),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> ApiResponse:
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    # Determine the final visibility (use update value if provided, else existing)
    final_visibility = update.visibility if update.visibility is not None else agent.visibility
    final_subagents = update.subagents if update.subagents is not None else agent.subagents
    
    # Validate subagent visibility
    if final_subagents:
        valid, error = validate_subagent_visibility(
            final_visibility,
            [s.model_dump() if hasattr(s, 'model_dump') else s for s in final_subagents],
            mongo,
        )
        if not valid:
            raise HTTPException(status_code=400, detail=error)
    
    updated = mongo.update_agent(agent_id, update)
    # ...
```

---

## Phase 4: API - Return Visibility Info for Subagents

**File:** `ui/src/app/api/dynamic-agents/available-subagents/route.ts`

Change the response to include visibility information:

```typescript
// Current response shape
{ id, name, description }

// New response shape
{ id, name, description, visibility }
```

Update the `.map()` in the route to include visibility:

```typescript
const available = allAgents
  .filter(/* existing filters */)
  .map((agent) => ({
    id: agent._id,
    name: agent.name,
    description: agent.description,
    visibility: agent.visibility,
  }));
```

**File:** `ui/src/types/dynamic-agent.ts`

Update `AvailableSubagent` interface:

```typescript
export interface AvailableSubagent {
  id: string;
  name: string;
  description?: string;
  visibility: VisibilityType;
}
```

---

## Phase 5: DynamicAgentEditor - Horizontal Step Wizard UI

**File:** `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx`

### New UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Create Custom Agent                                   [✕]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐ │
│   │ 1. Basic │────│ 2. Instr │────│ 3. Tools │────│4.Subagent│ │
│   │    ●     │    │    ○     │    │    ○     │    │    ○     │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Step 1: Basic Info                                            │
│   ─────────────────────────────────────────────                 │
│   Define your agent's identity and access level                 │
│                                                                 │
│   Agent Name *           [________________________]             │
│   Generated ID:          my_agent_name                          │
│                                                                 │
│   Description            [________________________]             │
│                                                                 │
│   Visibility             ○ Private  ○ Team  ● Global            │
│                                                                 │
│   LLM Model              [Claude Sonnet 4 (anthropic) ▼]        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [← Previous]                      [Next →]   [Create Agent]   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Step Definitions

```tsx
const steps = [
  { 
    id: "basic", 
    label: "Basic Info", 
    hint: "Define your agent's identity and access level" 
  },
  { 
    id: "instructions", 
    label: "Instructions", 
    hint: "Configure how your agent behaves" 
  },
  { 
    id: "tools", 
    label: "Tools", 
    hint: "Select which tools your agent can use" 
  },
  { 
    id: "subagents", 
    label: "Subagents", 
    hint: "Delegate tasks to other agents (optional)" 
  },
];
```

### Key Behaviors

1. **Steps are clickable** for free navigation
2. **Previous/Next buttons** for sequential flow
3. **Save button** always visible, enabled when: `name`, `system_prompt`, `modelId` are filled
4. **Current step** visually highlighted (filled circle vs empty circle)
5. **Step hint** shown below step title

### StepIndicator Component

```tsx
function StepIndicator({ 
  steps, 
  currentStep, 
  onStepClick 
}: { 
  steps: Step[]; 
  currentStep: string; 
  onStepClick: (stepId: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          {index > 0 && (
            <div className="w-8 h-0.5 bg-border" />
          )}
          <button
            onClick={() => onStepClick(step.id)}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors",
              currentStep === step.id 
                ? "bg-primary/10 text-primary" 
                : "hover:bg-muted text-muted-foreground"
            )}
          >
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
              currentStep === step.id 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted"
            )}>
              {index + 1}
            </div>
            <span className="text-xs font-medium">{step.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
```

---

## Phase 6: Instructions Step - Single Textarea

### Step 2 Content

Remove the three separate textareas (`system_prompt`, `agents_md`, `extension_prompt`) and replace with a single expanded textarea:

```tsx
{activeStep === "instructions" && (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor="systemPrompt">
        System Prompt <span className="text-destructive">*</span>
      </Label>
      <Textarea
        id="systemPrompt"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        rows={16}
        className="font-mono text-sm"
        placeholder="You are a helpful AI assistant that specializes in..."
        disabled={loading}
      />
      <p className="text-sm text-muted-foreground">
        Define your agent's behavior, personality, and capabilities. 
        You can paste content from an AGENTS.md file here.
      </p>
    </div>
  </div>
)}
```

### State Cleanup

Remove these state variables:
- `agentsMd` / `setAgentsMd`
- `extensionPrompt` / `setExtensionPrompt`

Remove from `handleSubmit`:
- `agents_md: agentsMd || undefined`
- `extension_prompt: extensionPrompt || undefined`

---

## Phase 7: Tools Step - Compact UI with Per-Server Search

**File:** `ui/src/components/dynamic-agents/AllowedToolsPicker.tsx`

### Updated Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Built-in Tools                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [Toggle] fetch_url - Fetch web content   [⚙ Configure] │ │
│ │          Domains: *.cisco.com                           │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ MCP Server Tools                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [☑] ▼ knowledge_base                        3 selected  │ │
│ │     🔍 [Search tools...]                                │ │  ← Per-server search
│ │     ☑ search    ☑ caipe_search    ☐ graph_query        │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ [☐] ▶ github                                 [Probe]    │ │  ← Collapsed, no search
│ ├─────────────────────────────────────────────────────────┤ │
│ │ [☑] ▼ argocd                               12 selected  │ │
│ │     🔍 [Search tools...]                                │ │  ← Per-server search
│ │     ☑ sync_app    ☑ get_status    ☐ delete_app  ...    │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

```tsx
// Per-server search state
const [searchQueries, setSearchQueries] = React.useState<Record<string, string>>({});

// In the expanded server section:
{expandedServers.has(serverId) && probeState?.tools && (
  <div className="space-y-2 pl-6 pt-2">
    {/* Search input - only show if server has > 5 tools */}
    {probeState.tools.length > 5 && (
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          placeholder="Search tools..."
          value={searchQueries[serverId] || ""}
          onChange={(e) => setSearchQueries(prev => ({ 
            ...prev, 
            [serverId]: e.target.value 
          }))}
          className="h-7 text-xs pl-7"
        />
      </div>
    )}
    
    {/* Filtered tool list */}
    <div className="grid grid-cols-2 gap-1">
      {probeState.tools
        .filter(tool => {
          const query = searchQueries[serverId]?.toLowerCase();
          if (!query) return true;
          return tool.name.toLowerCase().includes(query) ||
                 tool.description?.toLowerCase().includes(query);
        })
        .map(tool => (
          <ToolCheckbox key={tool.name} tool={tool} ... />
        ))
      }
    </div>
  </div>
)}
```

### Compact Styling Changes

1. Reduce padding on server rows
2. Smaller font sizes (text-xs for tool names)
3. Grid layout for tools (2 columns)
4. Smaller checkboxes

**File:** `ui/src/components/dynamic-agents/BuiltinToolsPicker.tsx`

### Compact Layout

Convert from card-based to inline row with expandable config:

```tsx
<div className="border rounded-lg">
  <div className="flex items-center justify-between p-3">
    <div className="flex items-center gap-3">
      <Switch checked={enabled} onCheckedChange={handleToggle} />
      <div>
        <span className="font-medium text-sm">fetch_url</span>
        <span className="text-xs text-muted-foreground ml-2">
          Fetch content from URLs
        </span>
      </div>
    </div>
    {enabled && (
      <Button variant="ghost" size="sm" onClick={toggleExpand}>
        <Settings className="h-3 w-3 mr-1" />
        Configure
      </Button>
    )}
  </div>
  
  {enabled && expanded && (
    <div className="border-t p-3 bg-muted/30">
      {/* Domain config */}
    </div>
  )}
</div>
```

---

## Phase 8: Subagents Step - Visibility Filtering

**File:** `ui/src/components/dynamic-agents/SubagentPicker.tsx`

### New Props

```tsx
interface SubagentPickerProps {
  agentId: string | null;
  value: SubAgentRef[];
  onChange: (subagents: SubAgentRef[]) => void;
  disabled?: boolean;
  parentVisibility: VisibilityType;      // NEW
}
```

### Visibility Compatibility Function

```tsx
// Visibility rules:
// - Private agent → can use private, team, or global subagents
// - Team agent → can use team or global subagents
// - Global agent → can only use global subagents

function getSubagentCompatibility(
  parentVisibility: string,
  subagent: AvailableSubagent
): { compatible: boolean; reason?: string } {
  const subVis = subagent.visibility;
  
  // Global parent can only use global subagents
  if (parentVisibility === "global" && subVis !== "global") {
    return { 
      compatible: false, 
      reason: "Global agents can only use global subagents" 
    };
  }
  
  // Team parent can use team or global subagents
  if (parentVisibility === "team" && subVis === "private") {
    return { 
      compatible: false, 
      reason: "Team agents can only use team or global subagents" 
    };
  }
  
  // Private parent can use any visibility
  return { compatible: true };
}
```

### UI Changes

```tsx
// Add hint at top
<div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3 mb-4">
  <Info className="h-4 w-4 inline mr-2" />
  Private agents can use any subagent. Team agents can use team or global subagents.
  Global agents can only use global subagents.
</div>

// In the selectable agents list
{selectableAgents.map((agent) => {
  const { compatible, reason } = getSubagentCompatibility(
    parentVisibility, agent
  );
  
  return (
    <TooltipProvider key={agent.id}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => compatible && addSubagent(agent)}
            disabled={disabled || !compatible}
            className={cn(
              "flex items-center gap-3 p-2 rounded-md text-left transition-colors w-full",
              compatible 
                ? "hover:bg-muted cursor-pointer" 
                : "opacity-50 cursor-not-allowed"
            )}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
            <div className="flex-grow min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{agent.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {agent.visibility}
                </Badge>
              </div>
              {agent.description && (
                <div className="text-xs text-muted-foreground truncate">
                  {agent.description}
                </div>
              )}
            </div>
          </button>
        </TooltipTrigger>
        {!compatible && (
          <TooltipContent>
            <p>{reason}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
})}
```

---

## Implementation Order

1. **Phase 1**: Rename "Dynamic Agents" → "Custom Agents" (~10 min)
2. **Phase 2**: Backend model cleanup - remove agents_md, extension_prompt (~20 min)
3. **Phase 4**: API - add visibility info to available-subagents response (~10 min)
4. **Phase 3**: Backend - subagent visibility validation in Next.js + Python (~30 min)
5. **Phase 5**: DynamicAgentEditor - horizontal step wizard UI (~60 min)
6. **Phase 6**: Instructions step - single textarea (~10 min, part of Phase 5)
7. **Phase 7**: Tools step - compact UI with per-server search (~40 min)
8. **Phase 8**: Subagents step - visibility filtering UI (~30 min)

**Total estimated time:** ~3.5 hours

---

## Files Changed Summary

| File | Type | Changes |
|------|------|---------|
| `ui/src/app/(app)/dynamic-agents/page.tsx` | Edit | Rename text |
| `ui/src/components/dynamic-agents/DynamicAgentsTab.tsx` | Edit | Rename text |
| `ui/src/components/layout/AppHeader.tsx` | Edit | Rename nav tab |
| `ui/src/components/dynamic-agents/DynamicAgentContext.tsx` | Edit | Rename label |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/models.py` | Edit | Remove fields |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/mongo.py` | Edit | Remove fields |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py` | Edit | Remove prompt concat |
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/agents.py` | Edit | Add visibility validation |
| `ui/src/types/dynamic-agent.ts` | Edit | Remove fields, update AvailableSubagent |
| `ui/src/app/api/dynamic-agents/route.ts` | Edit | Remove fields, add validation |
| `ui/src/app/api/dynamic-agents/available-subagents/route.ts` | Edit | Add visibility fields |
| `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx` | Major rewrite | Step wizard UI |
| `ui/src/components/dynamic-agents/AllowedToolsPicker.tsx` | Edit | Compact UI, per-server search |
| `ui/src/components/dynamic-agents/BuiltinToolsPicker.tsx` | Edit | Compact inline layout |
| `ui/src/components/dynamic-agents/SubagentPicker.tsx` | Edit | Visibility filtering |

---

## Testing Checklist

- [ ] "Custom Agents" appears in header, page title, card titles
- [ ] Creating new agent works without agents_md/extension_prompt
- [ ] Step wizard navigation works (click steps, prev/next buttons)
- [ ] Save button enabled only when required fields filled
- [ ] Instructions step has single textarea with hint
- [ ] Tools step has per-server search (only for servers with >5 tools)
- [ ] Tools UI is more compact
- [ ] Subagent picker shows visibility badges
- [ ] Incompatible subagents are disabled with tooltip explanation
- [ ] Backend rejects incompatible subagent configurations
- [ ] Editing existing agent loads data correctly into wizard
