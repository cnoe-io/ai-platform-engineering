# Plan: AI-Assisted Suggestions for Custom Agent Builder

## Overview

Add AI-powered generation to the Custom Agent Builder UI. Users can auto-generate agent **description**, **system prompt**, and **theme** via a generic LLM suggestion endpoint.

The system prompt field also gets full markdown preview support.

## Architecture

```
DynamicAgentEditor.tsx (client)
       |
       | POST /api/dynamic-agents/assistant/suggest
       | { field, context, model_id, model_provider, instruction? }
       v
UI API route (Next.js)  <-- prompt templates live here
       |
       | POST /api/v1/assistant/suggest
       | { system_prompt, user_message, model_id, model_provider }
       v
dynamic-agents backend  <-- generic thin LLM proxy, no field awareness
       |
       | LLMFactory(provider).get_llm(model)
       | await llm.ainvoke([SystemMessage, HumanMessage])
       v
LLM response -> { content: string }
```

**Key decisions:**
- Backend is a **generic LLM proxy** — no knowledge of fields, agents, or templates
- **Prompt templates** are constructed in the **Next.js API route** (server-side, not exposed to browser)
- Backend validates model exists in `get_available_models()` and caps input at **4000 chars** per field (`system_prompt`, `user_message`) and output at **2000 tokens** to prevent abuse
- Auth: `require_authenticated` (any authenticated user, not admin-only)

## Files to Create

| File | Purpose |
|---|---|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/routes/assistant.py` | `POST /api/v1/assistant/suggest` — generic LLM proxy |
| `ui/src/app/api/dynamic-agents/assistant/suggest/route.ts` | UI proxy + prompt template construction per field |

## Files to Edit

| File | Change |
|---|---|
| `ai_platform_engineering/dynamic_agents/src/dynamic_agents/main.py` | Register assistant router under `/api/v1/assistant` |
| `ui/src/components/dynamic-agents/DynamicAgentEditor.tsx` | AI suggest buttons + markdown preview for system prompt |

## 1. Backend: `POST /api/v1/assistant/suggest`

New file: `routes/assistant.py`

### Request

```python
class SuggestRequest(BaseModel):
    system_prompt: str        # max 4000 chars
    user_message: str         # max 4000 chars
    model_id: str
    model_provider: str
```

### Response

```python
class SuggestResponse(BaseModel):
    content: str
```

### Logic

1. Validate `len(system_prompt) <= 4000` and `len(user_message) <= 4000` — return 400 if exceeded
2. Validate `model_id` exists in `get_available_models()` — return 400 if unknown
3. Instantiate LLM: `LLMFactory(provider=model_provider).get_llm(model=model_id)`
4. Call: `result = await llm.ainvoke([SystemMessage(system_prompt), HumanMessage(user_message)])`
5. Return: `{ "content": result.content }`
6. Wrap in try/except — log full error server-side with `exc_info`, return generic 500 to client

### Registration in `main.py`

```python
from dynamic_agents.routes.assistant import router as assistant_router
app.include_router(assistant_router, prefix="/api/v1/assistant")
```

## 2. UI Proxy: `POST /api/dynamic-agents/assistant/suggest`

New file: `ui/src/app/api/dynamic-agents/assistant/suggest/route.ts`

### Request from editor

```typescript
interface SuggestFieldRequest {
  field: "description" | "system_prompt" | "theme";
  context: {
    name: string;
    description?: string;
    system_prompt?: string;
    allowed_tools?: Record<string, string[]>;
    builtin_tools?: Record<string, any>;
    subagents?: Array<{ agent_id: string; name: string; description?: string }>;
  };
  model_id: string;
  model_provider: string;
  instruction?: string;  // optional user hint (for system_prompt field)
}
```

### Prompt templates

This route constructs `system_prompt` + `user_message` based on the `field`, then forwards to the backend.

#### Field: `description`

- **System prompt**: "You are an AI assistant that writes concise, informative agent descriptions. Output ONLY the description text — no quotes, no preamble, no explanation."
- **User message**: "Write a 1-2 sentence description for an AI agent named '{name}'.{tools context}{subagents context} The description should explain what the agent does and its key capabilities."

#### Field: `system_prompt`

- **System prompt**: "You are an expert AI agent designer. You create comprehensive system prompts that define an agent's role, personality, capabilities, behavioral guidelines, and output format. Write the system prompt in markdown. Output ONLY the system prompt content — no wrapping, no preamble."
- **User message**: "Create a system prompt for an AI agent named '{name}' described as '{description}'.{tools context}{subagents context}{user instruction} The system prompt should be comprehensive and well-structured in markdown."

#### Field: `theme`

- **System prompt**: "You are a UI design assistant. You pick visual themes that match an agent's purpose and personality. Output ONLY the theme ID — nothing else, no explanation."
- **User message**: "Pick the most fitting visual theme for an agent named '{name}' described as '{description}'. Available themes:\n{theme list with id: label pairs}\nOutput ONLY the theme ID."

The theme list is imported from `@/lib/gradient-themes.ts` (the 12 predefined themes with IDs and labels).

### Forwards to backend

```typescript
const backendPayload = {
  system_prompt: constructedSystemPrompt,
  user_message: constructedUserMessage,
  model_id: body.model_id,
  model_provider: body.model_provider,
};
// POST to DYNAMIC_AGENTS_URL/api/v1/assistant/suggest
```

Returns `{ field, content }` to the editor.

## 3. System Prompt Markdown Preview

Edit: `DynamicAgentEditor.tsx` — Step 2 ("Instructions")

Replace the plain `<Textarea>` with a tabbed layout:

- **Tab bar**: "Edit" (default) | "Preview"
- **Edit tab**: Same monospace `<Textarea>` as today — no CodeMirror, keep it simple
- **Preview tab**: `<ReactMarkdown remarkPlugins={[remarkGfm]} components={getMarkdownComponents()}>` inside a styled scrollable container

Uses the existing `getMarkdownComponents()` from `@/lib/markdown-components.tsx` (same renderer as Skills UI).

New state: `promptTab: "edit" | "preview"` (default: `"edit"`)

## 4. AI Suggest Buttons in Editor

### New state

```typescript
const [generatingField, setGeneratingField] = useState<string | null>(null);
```

### Helper function

```typescript
async function handleSuggest(field: "description" | "system_prompt" | "theme") {
  setGeneratingField(field);
  try {
    const res = await fetch("/api/dynamic-agents/assistant/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field,
        context: { name, description, system_prompt: systemPrompt, allowed_tools: allowedTools, builtin_tools: builtinTools, subagents },
        model_id: modelId,
        model_provider: modelProvider,
      }),
    });
    if (!res.ok) throw new Error("Failed to generate suggestion");
    const data = await res.json();
    // Apply the suggestion to the appropriate field
    if (field === "description") setDescription(data.content);
    else if (field === "system_prompt") setSystemPrompt(data.content);
    else if (field === "theme") setGradientTheme(data.content);
  } catch (err) {
    // Show error toast
  } finally {
    setGeneratingField(null);
  }
}
```

### Step 1 (Basic Info) buttons

| Field | Icon | Placement | Prerequisites |
|---|---|---|---|
| Description | `Sparkles` icon button next to "Description" label | Inline with label | `name` non-empty + `modelId` selected |
| Theme | `Wand2` "Suggest Theme" button above theme grid | Above grid | `name` non-empty + `modelId` selected |

Both show `Loader2 animate-spin` when `generatingField` matches and are disabled during any generation.

### Step 2 (Instructions) button

| Field | Icon | Placement | Prerequisites |
|---|---|---|---|
| System Prompt | `Sparkles` button next to "System Prompt" label | Inline with label | `name` non-empty + `modelId` selected |

If existing system prompt content is present when the user clicks generate, show a confirmation dialog before replacing. During generation, the button shows a spinner.

## Execution Order

1. Backend route (`assistant.py` + register in `main.py`)
2. UI proxy route with prompt templates (`assistant/suggest/route.ts`)
3. System prompt markdown preview (edit/preview tabs)
4. AI suggest buttons (description, theme, system prompt)
5. Build + verify
