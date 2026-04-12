# Data Model: caipe-cli v1 Core

**Branch**: `100-caipe-v1-core` | **Date**: 2026-04-12

All state is stored locally on disk. There is no server-side database for v1.

---

## Entities

### User

Represents the authenticated operator of the CLI.

| Field | Type | Notes |
|-------|------|-------|
| `identity` | string | Subject claim from OIDC token (e.g., user@example.com) |
| `displayName` | string | From OIDC profile; shown in session header |
| `accessToken` | string | Short-lived OAuth access token; stored in OS keychain |
| `refreshToken` | string | Long-lived; stored in OS keychain |
| `accessTokenExpiry` | ISO 8601 datetime | Triggers silent refresh when past |
| `selectedAgent` | string \| null | Last-used agent name; persisted in config |

**Storage**: OS keychain (tokens) + `~/.config/caipe/config.json` (preferences)

**State transitions**:
```
unauthenticated → (browser PKCE flow) → authenticated → (token expiry) → refreshing → authenticated
                                                                        → (refresh fails) → unauthenticated
unauthenticated → (--device: RFC 8628 polling) → device_pending → (user approves) → authenticated
                                                                 → (expired/denied) → unauthenticated
unauthenticated → (--manual: URL print + code paste) → authenticated (no local browser)
unauthenticated → (headless: JWT/API Key/Client Credentials/OIDC passthrough) → authenticated (no browser)
```

---

### ServerConfig

The user-configured CAIPE server connection settings. Stored in `~/.config/caipe/settings.json`.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `serverUrl` | HTTPS URL | Yes | Base URL for all CAIPE server endpoints; no hardcoded default |
| `authApiKey` | string \| null | No | Static API key for headless mode; stored in `auth.apiKey` in settings.json |
| `clientId` | string \| null | No | OAuth2 client ID for Client Credentials flow; typically from `CAIPE_CLIENT_ID` env var |
| `clientSecret` | string \| null | No | OAuth2 client secret; NEVER stored in settings.json; only read from `CAIPE_CLIENT_SECRET` env var |

**Storage**: `~/.config/caipe/settings.json` — note `clientSecret` is env-only; `authApiKey` may be stored here but user should treat it as sensitive

**Derived endpoints** (all relative to `serverUrl`):
- OAuth / OIDC discovery: `<serverUrl>/oauth`
- Device Authorization (RFC 8628): `<serverUrl>/oauth/device/code`
- Token endpoint (PKCE + Device Auth + Client Credentials): `<serverUrl>/oauth/token`
- Agents registry: `<serverUrl>/api/v1/agents`
- A2A task submission: `<serverUrl>/tasks/send`
- AG-UI stream: `<serverUrl>/api/agui/stream`
- AgentCard: `<serverUrl>/.well-known/agent.json`

**State transitions**:
```
unconfigured → (setup wizard: user enters URL) → configured
configured → (--url <url> flag) → session-override (persisted config unchanged)
```

---

### Skill

A Markdown document with YAML frontmatter describing an AI automation routine.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Kebab-case identifier; unique within a catalog source |
| `version` | semver string | Yes | e.g., `1.2.0` |
| `description` | string | Yes | One-line summary shown in `caipe skills list` |
| `author` | string | No | GitHub handle or org name |
| `tags` | string[] | No | Used for filtering in catalog browser |
| `body` | string | Yes | Full Markdown content after frontmatter |

**Storage**: Filesystem — `.claude/<name>.md` (project, preferred) or `skills/<name>.md` (project, fallback) or `~/.config/caipe/skills/<name>.md` (global)

**Identity**: `name` is the unique key within an installation scope. Two skills from different catalog sources with the same `name` are treated as the same skill (last-write-wins during install).

**State transitions**:
```
not-installed → (caipe skills install) → installed → (caipe skills update, diff confirmed) → updated
                                                   → (manual edit) → locally-modified
```

---

### CatalogEntry

An entry in the skills catalog manifest. Read-only from the CLI's perspective.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Matches installed Skill `name` |
| `version` | semver string | Latest published version |
| `description` | string | One-line summary |
| `author` | string | Catalog contributor |
| `tags` | string[] | Browse/filter tags |
| `url` | HTTPS URL | Raw Markdown URL of the SKILL.md |
| `checksum` | `sha256:<hex>` string | Content integrity verification |

**Storage**: In-memory during session + cached to `~/.config/caipe/catalog-cache.json` with a TTL of 1 hour

---

### Catalog

The full catalog manifest fetched from GitHub Releases.

| Field | Type | Notes |
|-------|------|-------|
| `version` | string | Manifest schema version |
| `generated` | ISO 8601 datetime | When the manifest was published |
| `skills` | CatalogEntry[] | All available skills |

**Source**: `https://github.com/cnoe-io/ai-platform-engineering/releases/latest/download/catalog.json`

**Caching**: Cached locally for 1 hour; stale cache used when source is unreachable

---

### ChatSession

A conversation thread between the user and a grid agent.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | UUID | Unique per session; used for local history key |
| `agentName` | string | CAIPE server agent backing this session (e.g., `argocd`, `default`) |
| `agentEndpoint` | URL | CAIPE server endpoint for the selected agent |
| `protocol` | `"a2a"` \| `"agui"` | Active streaming protocol; `"a2a"` is default |
| `headless` | boolean | `true` when no TTY detected or `--headless` flag passed; suppresses all interactive prompts |
| `outputFormat` | `"text"` \| `"json"` \| `"ndjson"` | Headless output format; `"text"` default; ignored in interactive mode |
| `workingDir` | absolute path | `cwd` at session start; used for context gathering |
| `repoRoot` | absolute path \| null | Nearest `.git` parent; null if outside a repo |
| `startedAt` | ISO 8601 datetime | Session creation time |
| `messages` | Message[] | In-memory; serialized to history file on exit |
| `memoryContext` | string | Concatenated content of all loaded memory files |

**Storage**: `~/.config/caipe/sessions/<sessionId>.json` (persisted on exit)

---

### Message

A single turn in a ChatSession.

| Field | Type | Notes |
|-------|------|-------|
| `role` | `"user"` \| `"assistant"` | |
| `content` | string | Full text; assistant messages may contain markdown |
| `timestamp` | ISO 8601 datetime | |
| `agentName` | string | Which agent produced this message |
| `tokenCount` | number \| null | Estimated tokens; used for context budget tracking |

---

### Agent

A CAIPE server agent available for chat routing.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Kebab-case identifier (e.g., `argocd`, `github`, `default`) |
| `displayName` | string | Human-readable (e.g., "ArgoCD Agent") |
| `description` | string | Capability summary shown in `caipe agents list` |
| `endpoint` | URL | CAIPE server agent base URL |
| `protocols` | `("a2a" \| "agui")[]` | Protocols this agent supports; returned by registry; used for pre-connect validation |
| `available` | boolean | Health check result; cached for session lifetime |
| `domain` | string | Capability domain (e.g., `gitops`, `security`, `general`) |

**Source**: CAIPE server API — `GET /api/v1/agents` (requires auth)

**Storage**: In-memory + cached to `~/.config/caipe/agents-cache.json` with 5-minute TTL

---

### MemoryFile

A Markdown file contributing context to chat sessions.

| Field | Type | Notes |
|-------|------|-------|
| `path` | absolute path | Location of the file |
| `scope` | `"global"` \| `"project"` \| `"managed"` | Source classification |
| `content` | string | Raw Markdown content |
| `tokenEstimate` | number | Rough token count; used to enforce budget cap |

**Scope hierarchy** (loaded in this order, later scopes override earlier ones):
1. Global: `~/.config/caipe/CLAUDE.md`
2. Project: `.claude/CLAUDE.md` (nearest ancestor)
3. Managed: `.claude/memory/*.md` (agent-written, sorted alphabetically)

---

## Local Storage Layout

```
~/.config/caipe/
├── settings.json          # ServerConfig: server.url, auth.apiKey
├── config.json            # User preferences (selected agent, theme, etc.)
├── CLAUDE.md              # Global memory file (user-edited)
├── catalog-cache.json     # Cached skills catalog manifest
├── agents-cache.json      # Cached CAIPE server agents list
├── skills/                # Globally installed skills
│   └── <name>.md
└── sessions/              # Chat session history
    └── <sessionId>.json

<project-root>/
├── .claude/
│   ├── CLAUDE.md          # Project memory file (user-edited)
│   ├── memory/            # Agent-written memories
│   │   └── *.md
│   └── <skill-name>.md    # Project-installed skills (preferred location)
└── skills/                # Project-installed skills (fallback location)
    └── <skill-name>.md
```

---

## Key Validation Rules

- `Skill.name` must match `^[a-z][a-z0-9-]*$` (kebab-case, starts with letter)
- `Skill.version` must be valid semver
- `CatalogEntry.checksum` must be verified before writing any skill file to disk
- `ChatSession.messages` are capped at a rolling 100k token window; oldest messages are summarized (compacted) when the budget is exceeded
- `MemoryFile` total size across all scopes is capped at 50k tokens; files exceeding the cap are truncated with a warning
- `User.accessToken` is never written to disk in plaintext; only stored via `keytar`
- `ServerConfig.serverUrl` must be a valid HTTPS URL; HTTP URLs are rejected at parse time
- `ServerConfig.clientSecret` is never stored in `settings.json`; it is read exclusively from `CAIPE_CLIENT_SECRET` env var
- In headless mode, `ChatSession.headless` is `true` and all interactive Ink prompts are suppressed; missing credential causes exit code 1 before session is created
