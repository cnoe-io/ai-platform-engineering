# Feature Specification: caipe — AI Platform Engineer CLI (v1 Core)

**Feature Branch**: `100-caipe-v1-core`  
**Created**: 2026-04-12  
**Status**: Draft  
**Input**: User description: "caipe - Cisco-ETI AI Platform Engineer CLI with interactive chat, skills hub, self-improving agent, grid agent access, and DCO policy enforcement"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authenticated Interactive Chat (Priority: P1)

A platform engineer opens their terminal, authenticates once with their Cisco-ETI grid identity, and immediately starts a context-aware chat session scoped to the repository they are working in. They ask questions, request code assistance, and interact with AI — entirely from the terminal.

**Why this priority**: Authenticated chat is the primary value driver. All other features (skills, self-improvement, agent routing) depend on a working, authenticated session. Delivering this alone gives users immediate productivity.

**Independent Test**: Can be fully tested by running `npx caipe chat` in a repo, completing a one-time browser authentication, sending a message, and receiving a context-aware streamed response — standalone MVP value with no other features required.

**Acceptance Scenarios**:

1. **Given** a user has not yet authenticated, **When** they run `caipe` or `caipe chat`, **Then** they are directed to a browser-based Cisco-ETI grid login flow and a session credential is saved locally after success
2. **Given** an authenticated user is in a git repository, **When** they start a chat session, **Then** the assistant receives the repository's file structure and recent git state as context
3. **Given** an authenticated user sends a message, **When** the assistant responds, **Then** the response streams to the terminal in real-time with markdown rendered for readability
4. **Given** a user's session credential expires mid-session, **When** they send a message, **Then** they are prompted to re-authenticate without losing the current conversation context
5. **Given** an authenticated user runs `caipe signout`, **When** confirmed, **Then** the stored credential is removed and the next session requires fresh authentication

---

### User Story 2 - Skills Hub: Browse, Preview, and Install (Priority: P2)

A platform engineer wants to equip their repository with pre-built AI automation routines (skills). They discover what is available in a catalog, preview each skill before committing to it, then install it directly into their project directory.

**Why this priority**: Skills drive team-shared automation and extend CLI behavior beyond built-ins. Without the hub, users cannot compose or share AI routines across projects.

**Independent Test**: Can be fully tested by running `caipe skills list`, previewing a skill, and installing it — results in a skill file written to the project, delivering standalone value as a package-manager-like experience for AI automation.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they run `caipe skills list`, **Then** they see a browsable, searchable list of available skills with names and one-line descriptions
2. **Given** a user selects a skill to preview, **When** the preview renders, **Then** they see the skill's full description, inputs, and example usage before deciding to install
3. **Given** a user installs a skill, **When** no explicit target is specified, **Then** the skill is placed in `.claude/` if that directory exists, otherwise in `skills/`
4. **Given** a skill is already installed at the target path, **When** the user installs the same skill again, **Then** they are warned and must explicitly confirm the overwrite

---

### User Story 3 - Self-Improving Agent: Skill Updates (Priority: P3)

The CLI detects that one or more installed skills have newer versions in the catalog. It surfaces a diff of what changed and, after confirmation, applies the update — keeping automation current without manual version tracking.

**Why this priority**: Self-improvement closes the skills lifecycle loop. Without it, installed skills become stale. Depends on Stories 1 and 2 being functional.

**Independent Test**: Can be tested by installing a skill at version N, publishing version N+1 to the catalog, then running `caipe skills update` — the CLI reports the update, shows a diff, and replaces the file upon confirmation with the old version backed up.

**Acceptance Scenarios**:

1. **Given** a user has installed skills, **When** they run `caipe skills update`, **Then** the CLI reports which installed skills have newer catalog versions and which are current
2. **Given** updates are available, **When** the user selects one to apply, **Then** a diff between the installed and incoming skill content is shown before any change is made
3. **Given** the user confirms an update, **When** the skill file is replaced, **Then** the previous version is backed up before being overwritten
4. **Given** the skills catalog is unreachable, **When** the user runs `caipe skills update`, **Then** a clear error message is shown and no installed skills are modified

---

### User Story 4 - Grid Agent Routing (Priority: P4)

A platform engineer directs their chat query to a specific AI agent on the grid platform — for example, an ArgoCD agent, a Kubernetes agent, or a security agent. They list available agents and select one as the backend for their session.

**Why this priority**: Specialised agents give more accurate domain answers than a generalist. Depends on core chat (P1) being fully functional.

**Independent Test**: Can be tested by running `caipe agents list`, starting a session with `caipe chat --agent argocd`, and verifying the response reflects that agent's specialisation.

**Acceptance Scenarios**:

1. **Given** an authenticated user, **When** they run `caipe agents list`, **Then** all agents available on the grid are shown with names and capability descriptions
2. **Given** an authenticated user specifies an agent at session start (e.g., `caipe chat --agent argocd`), **When** the session opens, **Then** queries are routed to that agent
3. **Given** no agent is specified, **When** a user starts a chat, **Then** a default generalist agent is used and the active agent name is shown in the session header
4. **Given** a specified agent is unavailable, **When** the user attempts to start a session with it, **Then** they see an error and are offered a list of currently available agents

---

### User Story 5 - DCO-Compliant Commit Assistance (Priority: P5)

When a platform engineer generates code via caipe and commits it, the CLI ensures the commit meets the project's DCO policy: AI attribution is attached automatically and the user is prompted for their own sign-off.

**Why this priority**: Required for open-source compliance. Does not block day-to-day engineering work; implemented after core chat is stable.

**Independent Test**: Can be tested by generating a file change through chat, staging it, and committing via the CLI — the commit must carry `Assisted-by` and the user must have been prompted for `Signed-off-by`.

**Acceptance Scenarios**:

1. **Given** a user stages AI-generated changes and commits via the CLI, **When** the commit message is assembled, **Then** the CLI automatically appends `Assisted-by: Claude:<model-version>` to the message
2. **Given** no `Signed-off-by` is present in the draft, **When** the commit is about to be created, **Then** the user is prompted to provide their own `Signed-off-by` before the commit is finalized
3. **Given** a user declines to add `Signed-off-by`, **When** they explicitly override, **Then** the commit proceeds with a visible warning; the CLI does not block it
4. **Given** a user commits via `git commit` directly (bypassing the CLI), **When** the commit is created, **Then** no CLI action is taken unless a git hook has been explicitly opted into

---

### Edge Cases

- What happens when the internet connection drops mid-chat session?
- How does the system handle credentials stored on a shared or multi-user machine?
- What happens when a skill references a capability not supported by the current platform?
- How does the CLI behave when run outside of any git repository?
- What happens when the skills catalog is unreachable (offline, rate-limited, or under maintenance)?
- How does the CLI handle two concurrent sessions from the same authenticated identity?
- What happens if a skill file in the repository has been manually edited after installation?
- What happens when `npx caipe` is run on a network with a corporate proxy intercepting HTTPS?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to authenticate using their Cisco-ETI grid identity via a browser-initiated flow launched from the terminal
- **FR-002**: Authenticated sessions MUST persist across terminal restarts without requiring re-login until the credential expires or the user explicitly signs out
- **FR-003**: The chat interface MUST stream responses to the terminal in real-time with markdown rendered for readability
- **FR-004**: Chat sessions MUST automatically include context from the current working directory and git repository state at session start
- **FR-005**: The chat session MUST maintain persistent memory (conversation history, user preferences) stored locally, accessible across sessions within the same project
- **FR-006**: Users MUST be able to list, preview, and install skills from the catalog using a `skills` subcommand
- **FR-007**: Installed skills MUST be written as Markdown files with YAML frontmatter into `.claude/` (preferred) or `skills/` (fallback) in the project directory
- **FR-008**: The self-updating capability MUST detect version differences between installed skills and the catalog and surface them to the user on demand via `caipe skills update`
- **FR-009**: Before applying any skill update, the system MUST display a diff of changes and require explicit user confirmation
- **FR-010**: When committing AI-assisted code via the CLI, the system MUST auto-append an `Assisted-by` attribution trailer to the commit message
- **FR-011**: The CLI MUST prompt users for a `Signed-off-by` trailer on every AI-assisted commit and MUST NOT generate this trailer on the user's behalf
- **FR-012**: The CLI MUST be installable via `npx caipe` with no prerequisites beyond Node.js
- **FR-013**: Users MUST be able to list agents available on the grid and target a specific agent for their chat session; [NEEDS CLARIFICATION: agent routing scope — does selecting an agent pin the entire session to that agent (A), or can users switch agents per message mid-conversation (B)?]
- **FR-014**: The skill catalog MUST be browsable using the same Cisco-ETI grid credential used for chat, with no additional login required; [NEEDS CLARIFICATION: catalog distribution model — is the catalog served via grid.outshift.io API (A), a GitHub releases/manifest feed (B), or an npm-published package registry (C)? This determines offline behavior and versioning granularity]

### Key Entities

- **User**: A Cisco-ETI platform engineer with a grid identity; owns a local credential, per-project chat memory, and a set of installed skills
- **Skill**: A Markdown document with YAML frontmatter describing an AI automation routine; has name, version, description, author, and body
- **Catalog**: A versioned, searchable collection of published skills with metadata for discovery and installation
- **Chat Session**: A conversation thread scoped to a working directory; has an active agent, persistent memory, and streams responses
- **Agent**: A specialised AI backend on the grid platform targeting a specific domain (e.g., GitOps, security, observability)
- **Commit**: A git commit that may carry AI-generated content; subject to DCO policy requiring `Assisted-by` and human-supplied `Signed-off-by`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can go from `npx caipe` to their first AI-assisted chat response in under 3 minutes, including one-time browser authentication
- **SC-002**: 95% of chat responses begin streaming within 3 seconds of message submission on a standard broadband connection
- **SC-003**: Users can discover, preview, and install any skill from the catalog in under 2 minutes without consulting external documentation
- **SC-004**: Skill update checks complete within 10 seconds for a project with up to 50 installed skills
- **SC-005**: 100% of AI-assisted commits made through the CLI include a valid `Assisted-by` trailer
- **SC-006**: The CLI installs via `npx caipe` in under 60 seconds with no manual dependency installation step
- **SC-007**: Chat sessions maintain usable context across a repository with up to 100 files without visible truncation or context errors reported by the user
- **SC-008**: Skill installation succeeds for 99% of catalog entries when run in a directory containing only a `.git` folder

## Assumptions

- The grid.outshift.io authentication service supports a browser-initiated device authorization flow compatible with headless/CLI environments
- The skills catalog is accessible to any authenticated grid user without a separate credential
- Skills follow the SKILL.md format convention established in outshift/skills (YAML frontmatter + Markdown body)
- Memory persistence is stored locally in a per-project directory (e.g., `.claude/memory/`) and is not synced to the cloud
- The CLI targets macOS and Linux as primary platforms; Windows (WSL2) is a supported secondary target
- Skill versioning uses semantic versioning; the catalog exposes at least a `version` field per skill entry
- The self-improving agent never auto-applies updates; human confirmation is always required before any skill file is modified
- Multiple concurrent CLI sessions from the same user are permitted and share the same local credential store
