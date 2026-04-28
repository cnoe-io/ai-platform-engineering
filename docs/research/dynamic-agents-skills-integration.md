# Feasibility Study: Skills Integration for Dynamic Agents

**Date**: March 19, 2026  
**Status**: Shelved (ready for implementation when prioritized)  
**Estimated Effort**: 26-36 hours

## Executive Summary

Adding skills integration to dynamic agents is **highly feasible** with moderate effort. The codebase already has two distinct skills systems that can be unified, and the deepagents library provides a robust `SkillsMiddleware` that follows the Agent Skills specification (agentskills.io).

## Requirements

1. Integrate with existing skills feature (how we store skills in MongoDB and filesystem)
2. Dynamic agent config should have a list of skills the agent is allowed to acquire
3. Use the `SkillsMiddleware` that the langgraph deepagents library supports
4. Skills should be loaded at agent runtime when agent is created

## Current State Analysis

### Existing Skills Systems

| System | Location | Purpose | Storage |
|--------|----------|---------|---------|
| **UI Skills (AgentConfig)** | `ui/src/types/agent-config.ts` | User-created skills with SKILL.md content | MongoDB (`agent_configs` collection) |
| **Built-in Skills** | `charts/ai-platform-engineering/data/skills/` | System skill templates | Filesystem / ConfigMap |
| **Dynamic Agents** | `ai_platform_engineering/dynamic_agents/` | MCP-based agents with tools & subagents | MongoDB (`dynamic_agent_configs` collection) |

### Built-in Skill Templates (Filesystem)

- **Location**: `charts/ai-platform-engineering/data/skills/*/SKILL.md`
- **Deployment**: Mounted as ConfigMap in Kubernetes (`skill-templates`)
- **API**: `GET /api/skill-templates` (read-only, for UI display)
- **Count**: 11 built-in skills:
  - `review-specific-pr`
  - `review-open-pull-requests`
  - `sprint-progress-report`
  - `security-vulnerability-report`
  - `incident-investigation`
  - `oncall-handoff`
  - `documentation-search`
  - `release-readiness-check`
  - `cluster-resource-health`
  - `check-deployment-status`
  - `aws-cost-analysis`

### User-Created Skills (MongoDB)

- **Storage**: MongoDB collection `agent_configs` with `skill_content` field
- **API**: Full CRUD at `/api/agent-configs`
- **Features**: Ownership (`owner_id`), visibility (private/team/global), team sharing
- **Schema**: See `ui/src/types/agent-config.ts` - `AgentConfig` interface

### Current Usage Gap

Currently, **skills are only used in the UI** (Skills Gallery, Skills Builder). They are **NOT** passed to the dynamic agent runtime - the agent has no knowledge of skills.

### Dynamic Agents Current State

Located in `ai_platform_engineering/dynamic_agents/`:

- **Model**: `DynamicAgentConfig` in `models.py`
- **Runtime**: `AgentRuntime` in `services/agent_runtime.py`
- **Features**: MCP tools, subagents, built-in tools, model configuration
- **Missing**: No `skills` or `allowed_skills` field

## Deepagents SkillsMiddleware

From `research-files/deepagents/libs/deepagents/deepagents/middleware/skills.py`:

```python
class SkillsMiddleware(AgentMiddleware[SkillsState, ContextT, ResponseT]):
    """Middleware for loading and exposing agent skills to the system prompt.
    
    Loads skills from backend sources and injects them into the system prompt
    using progressive disclosure (metadata first, full content on demand).
    """
    
    def __init__(self, *, backend: BACKEND_TYPES, sources: list[str]) -> None:
        """
        Args:
            backend: Backend instance for file operations (StateBackend, FilesystemBackend, etc.)
            sources: List of skill source paths (e.g., ['/skills/user/', '/skills/project/'])
        """
```

Key features:
- **Progressive Disclosure**: Only loads skill metadata initially, full content on demand
- **Multiple Sources**: Supports layered skill sources with precedence (last wins)
- **SKILL.md Format**: Requires YAML frontmatter with `name`, `description`, and optional `allowed-tools`
- **Backend Agnostic**: Works with StateBackend (in-memory), FilesystemBackend, or custom backends

Reference docs:
- https://docs.langchain.com/oss/python/deepagents/skills
- https://reference.langchain.com/python/deepagents/middleware/skills/SkillsMiddleware

## Proposed Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Skill Sources for Dynamic Agents                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐         ┌─────────────────────────────────────┐   │
│  │ Built-in Skills │         │        User Skills (MongoDB)        │   │
│  │  (Filesystem)   │         │                                     │   │
│  ├─────────────────┤         ├─────────────────────────────────────┤   │
│  │ review-spec-pr  │         │ agent-config-12345 (my-skill)       │   │
│  │ aws-cost        │         │ agent-config-67890 (team-skill)     │   │
│  │ incident-invest │         │ ...                                 │   │
│  └────────┬────────┘         └──────────────┬──────────────────────┘   │
│           │                                  │                          │
│           │  ┌───────────────────────────────┘                          │
│           │  │                                                          │
│           ▼  ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │              HybridSkillsBackend (new component)             │       │
│  │                                                              │       │
│  │  • Loads built-in skills from SKILLS_DIR                    │       │
│  │  • Loads user skills from MongoDB by skill_id               │       │
│  │  • Implements BackendProtocol for SkillsMiddleware          │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                              │                                          │
│                              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │                    SkillsMiddleware                          │       │
│  │                                                              │       │
│  │  • Injects skills into agent's system prompt                │       │
│  │  • Progressive disclosure (metadata first)                  │       │
│  │  • Called by create_deep_agent(middleware=[...])            │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model Changes

#### 1. New Models in `dynamic_agents/models.py`

```python
class SkillSource(str, Enum):
    """Source type for skills."""
    BUILTIN = "builtin"   # From filesystem (chart data/skills)
    MONGODB = "mongodb"   # From agent_configs collection


class SkillRef(BaseModel):
    """Reference to a skill that the agent can acquire."""
    
    skill_id: str = Field(
        ..., 
        description="Skill identifier: kebab-case name for builtin, ObjectId for mongodb"
    )
    name: str = Field(
        ..., 
        description="Display name (e.g., 'review-specific-pr')"
    )
    description: str = Field(
        ..., 
        description="What the skill does (for progressive disclosure)"
    )
    source: SkillSource = Field(
        SkillSource.MONGODB, 
        description="Where the skill content is stored"
    )
```

#### 2. Update `DynamicAgentConfigBase`

```python
class DynamicAgentConfigBase(BaseModel):
    # ... existing fields (name, description, system_prompt, allowed_tools, etc.) ...
    
    # NEW FIELD
    allowed_skills: list[SkillRef] = Field(
        default_factory=list,
        description="Skills that this agent is allowed to acquire and use. "
                    "Skills are loaded at runtime from builtin templates or MongoDB."
    )
```

### New Component: `HybridSkillsBackend`

Create `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/skills_backend.py`:

```python
from pathlib import Path
from deepagents.backends.protocol import BackendProtocol, DownloadFileResult, FileInfo

class HybridSkillsBackend(BackendProtocol):
    """Backend that loads skills from both filesystem and MongoDB.
    
    Supports two skill sources:
    - Builtin skills: Loaded from SKILLS_DIR (filesystem/ConfigMap)
    - User skills: Loaded from MongoDB agent_configs collection
    
    All paths are virtual, following the structure:
        /skills/<source>/<skill-name>/SKILL.md
    e.g.:
        /skills/builtin/review-specific-pr/SKILL.md
        /skills/mongodb/my-custom-skill/SKILL.md
    """
    
    def __init__(
        self,
        skill_refs: list[SkillRef],
        skills_dir: str | None = None,  # For builtin skills
        mongo_service: MongoDBService | None = None,  # For user skills
    ):
        self._skill_refs = skill_refs
        self._skills_dir = skills_dir or os.getenv("SKILLS_DIR")
        self._mongo_service = mongo_service
        self._cache: dict[str, str] = {}  # path -> content
    
    async def _load_all_skills(self) -> None:
        """Pre-load all skill content into cache."""
        for ref in self._skill_refs:
            content = await self._load_skill_content(ref)
            if content:
                path = f"/skills/{ref.source.value}/{ref.skill_id}/SKILL.md"
                self._cache[path] = content
    
    async def _load_skill_content(self, ref: SkillRef) -> str | None:
        """Load skill content from appropriate source."""
        if ref.source == SkillSource.BUILTIN:
            return self._load_builtin_skill(ref.skill_id)
        elif ref.source == SkillSource.MONGODB:
            return await self._load_mongodb_skill(ref.skill_id)
        return None
    
    def _load_builtin_skill(self, skill_id: str) -> str | None:
        """Load skill from filesystem."""
        if not self._skills_dir:
            return None
        skill_path = Path(self._skills_dir) / skill_id / "SKILL.md"
        if skill_path.exists():
            return skill_path.read_text()
        return None
    
    async def _load_mongodb_skill(self, skill_id: str) -> str | None:
        """Load skill from MongoDB agent_configs."""
        if not self._mongo_service:
            return None
        agent_config = self._mongo_service.get_agent_config(skill_id)
        if agent_config and agent_config.skill_content:
            return agent_config.skill_content
        return None
    
    def ls_info(self, path: str) -> list[FileInfo]:
        """List skills as virtual directories."""
        if path in ("/skills/", "/skills"):
            sources = set(ref.source.value for ref in self._skill_refs)
            return [{"path": f"/skills/{src}/", "is_dir": True} for src in sources]
        
        for source in ("builtin", "mongodb"):
            if path.rstrip("/") == f"/skills/{source}":
                return [
                    {"path": f"/skills/{source}/{ref.skill_id}/", "is_dir": True}
                    for ref in self._skill_refs if ref.source.value == source
                ]
        
        return []
    
    def download_files(self, paths: list[str]) -> list[DownloadFileResult]:
        """Return cached skill content."""
        results = []
        for path in paths:
            content = self._cache.get(path)
            if content:
                results.append(DownloadFileResult(content=content.encode("utf-8"), error=None))
            else:
                results.append(DownloadFileResult(content=None, error="Skill not found"))
        return results
```

### AgentRuntime Integration

Update `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`:

```python
from deepagents.middleware.skills import SkillsMiddleware
from dynamic_agents.services.skills_backend import HybridSkillsBackend

class AgentRuntime:
    async def initialize(self) -> None:
        # ... existing tool loading code ...
        
        # NEW: Build skills middleware if agent has allowed_skills
        middlewares = []
        if self.config.allowed_skills:
            skills_backend = HybridSkillsBackend(
                skill_refs=self.config.allowed_skills,
                skills_dir=self.settings.skills_dir,  # NEW setting
                mongo_service=self._mongo_service,
            )
            await skills_backend._load_all_skills()  # Pre-load content
            
            # Build source paths based on which sources are used
            sources = list(set(f"/skills/{ref.source.value}/" for ref in self.config.allowed_skills))
            
            skills_middleware = SkillsMiddleware(
                backend=skills_backend,
                sources=sources,
            )
            middlewares.append(skills_middleware)
            
            logger.info(
                f"Agent '{self.config.name}': loaded {len(self.config.allowed_skills)} skills"
            )
        
        # Create the agent graph with middleware
        self._graph = create_deep_agent(
            model=llm,
            tools=tools,
            system_prompt=system_prompt,
            context_schema=AgentContext,
            checkpointer=self._checkpointer,
            name=safe_name,
            subagents=subagents if subagents else None,
            interrupt_on={"request_user_input": True},
            middleware=middlewares if middlewares else None,  # NEW
        )
```

## API Changes

### New Endpoint: `GET /api/dynamic-agents/available-skills`

Returns skills available for assignment to dynamic agents:

```json
{
  "builtin": [
    { "skill_id": "review-specific-pr", "name": "Review Specific PR", "description": "...", "source": "builtin" },
    { "skill_id": "aws-cost-analysis", "name": "AWS Cost Analysis", "description": "...", "source": "builtin" }
  ],
  "user": [
    { "skill_id": "agent-config-12345", "name": "My Custom Skill", "description": "...", "source": "mongodb" }
  ]
}
```

### Updated: `PUT /api/dynamic-agents/{id}`

Accept `allowed_skills` in request body:

```json
{
  "allowed_skills": [
    { "skill_id": "review-specific-pr", "name": "Review Specific PR", "description": "...", "source": "builtin" },
    { "skill_id": "agent-config-12345", "name": "My Custom Skill", "description": "...", "source": "mongodb" }
  ]
}
```

## UI Changes

### Skills Selector Component

Add to dynamic agent configuration form:

```tsx
// ui/src/components/dynamic-agents/SkillsSelector.tsx

interface SkillsSelectorProps {
  selectedSkills: SkillRef[];
  onChange: (skills: SkillRef[]) => void;
}

export function SkillsSelector({ selectedSkills, onChange }: SkillsSelectorProps) {
  const { builtinSkills, userSkills, isLoading } = useAvailableSkills();
  
  return (
    <div>
      <h4>Allowed Skills</h4>
      <p className="text-muted">
        Skills the agent can use. Progressive disclosure - agent sees descriptions 
        first, reads full instructions when needed.
      </p>
      
      <section>
        <h5>Built-in Skills</h5>
        <SkillCheckboxList 
          skills={builtinSkills} 
          selected={selectedSkills}
          onToggle={onChange}
        />
      </section>
      
      <section>
        <h5>Your Skills</h5>
        <SkillCheckboxList 
          skills={userSkills} 
          selected={selectedSkills}
          onToggle={onChange}
        />
      </section>
    </div>
  );
}
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Skill sources | MongoDB + Filesystem | Support both user-created and built-in skills |
| Runtime validation | Trust stored config | Simpler, faster; document that skills shouldn't be deleted if referenced |
| Skill versioning | Always use latest | Simplest approach; skills are loaded fresh at agent creation |
| Progressive disclosure | Yes (via SkillsMiddleware) | Reduces prompt size, loads full content on demand |
| Tool enforcement | Advisory only | `allowed-tools` in SKILL.md is not enforced by backend |

## Effort Estimation

| Component | Complexity | Estimated Effort |
|-----------|------------|------------------|
| Model changes (`SkillRef`, `allowed_skills`, `SkillSource`) | Low | 1-2 hours |
| `HybridSkillsBackend` implementation | Medium | 4-6 hours |
| `AgentRuntime.initialize()` integration | Medium | 2-3 hours |
| Settings update (SKILLS_DIR env var) | Low | 1 hour |
| New API: `GET /available-skills` | Low | 2 hours |
| UI: `SkillsSelector` component | Medium | 4-6 hours |
| Update agent config editor to include skills | Medium | 3-4 hours |
| Unit tests (backend, runtime) | Medium | 4-6 hours |
| Integration tests | Medium | 3-4 hours |
| Documentation | Low | 2 hours |
| **Total** | | **26-36 hours** |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Skill not found at runtime (deleted after config) | Trust stored config - document that skills should not be deleted if referenced |
| Large number of skills impacting system prompt size | SkillsMiddleware uses progressive disclosure - only metadata in prompt |
| Skill content too large | Deepagents has 10MB limit per SKILL.md; existing validation applies |
| Circular dependencies | N/A - skills don't reference agents, only tools |

## Open Questions (for future discussion)

1. Should `allowed_skills` be a flat list or grouped by source?
2. Should skills inherit to subagents?
3. Should there be a maximum number of skills per agent?
4. How should skill selection be presented in the UI - inline or modal?
5. Should we support previewing the agent's system prompt with skills?
6. When an agent has skills, should the base `system_prompt` still be used, or replaced?
7. Should there be an option to disable skills temporarily?

## References

- Deepagents Skills Documentation: https://docs.langchain.com/oss/python/deepagents/skills
- SkillsMiddleware Reference: https://reference.langchain.com/python/deepagents/middleware/skills/SkillsMiddleware
- Agent Skills Specification: https://agentskills.io/specification
- Existing skills implementation: `ui/src/lib/skill-md-parser.ts`
- Dynamic agents runtime: `ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/agent_runtime.py`
- Built-in skills: `charts/ai-platform-engineering/data/skills/`
