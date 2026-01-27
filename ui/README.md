# CAIPE UI - A2A Message Visualizer

A modern React-based UI for visualizing A2A (Agent-to-Agent) protocol messages with real-time streaming support. Built with Next.js 15, implementing custom A2A protocol client and A2UI widget specifications.

## Features

- **3-Panel Layout**:
  - **Left Panel**: Chat history and navigation sidebar
  - **Center Panel**: Chat interface with final output rendering
  - **Right Panel**: Real-time A2A message stream visualization

- **Use Cases Gallery**: Browse and execute common platform engineering scenarios
- **A2A Spec Conformant**: Full support for A2A protocol events (task, artifact-update, status-update)
- **A2UI Widget Support**: Declarative UI components (buttons, forms, cards, lists, tables, etc.)
- **Real-time Streaming**: Live visualization of SSE events with filters and inspection
- **Real-time Streaming**: Displays all streamed content as it arrives

## Quick Start

### Using Make (Recommended)

```bash
# From repository root - installs dependencies and runs dev server
make caipe-ui

# Or run with Docker Compose (includes supervisor)
make caipe-ui-docker-compose
```

Visit [http://localhost:3000](http://localhost:3000)

### Development

```bash
# From repository root
make caipe-ui-dev

# Or manually from ui directory
cd ui
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### Docker

```bash
# Using Make
make caipe-ui-docker-compose

# Or using Docker Compose directly
COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up

# Or with --profile flag
docker compose -f docker-compose.dev.yaml --profile caipe-ui up --build
```

Visit [http://localhost:3000](http://localhost:3000)

## Configuration

### Environment Variables

| Variable | Default (Dev) | Default (Docker) | Description |
|----------|---------------|------------------|-------------|
| `CAIPE_URL` | `http://localhost:8000` | `http://caipe-supervisor:8000` | URL of the CAIPE supervisor A2A endpoint |
| `NEXT_PUBLIC_CAIPE_URL` | Same as `CAIPE_URL` | Same as `CAIPE_URL` | Client-side accessible version (auto-set) |

### Configuration Priority

The CAIPE URL is resolved in the following order (highest priority first):

1. `NEXT_PUBLIC_CAIPE_URL` environment variable (client-side accessible)
2. `CAIPE_URL` environment variable (server-side)
3. `A2A_ENDPOINT` environment variable (legacy support)
4. Default based on environment:
   - Development: `http://localhost:8000`
   - Production/Docker: `http://caipe-supervisor:8000`

### Examples

```bash
# Development - uses default localhost:8000
npm run dev

# Development - custom endpoint
CAIPE_URL=http://my-caipe:8000 npm run dev

# Docker - uses default caipe-supervisor:8000
docker compose -f docker-compose.dev.yaml --profile ui up

# Docker - custom endpoint
CAIPE_URL=http://my-caipe:8000 docker compose -f docker-compose.dev.yaml --profile ui up
```

## Architecture

```
ui/
├── src/
│   ├── app/                    # Next.js app router
│   │   ├── globals.css         # Global styles (Tailwind + custom)
│   │   ├── layout.tsx          # Root layout
│   │   └── page.tsx            # Main page with 3-panel layout
│   ├── components/
│   │   ├── a2a/                # A2A visualization components
│   │   │   ├── A2AStreamPanel.tsx   # Real-time event stream
│   │   │   ├── A2UIRenderer.tsx     # A2UI message renderer
│   │   │   └── widgets/             # A2UI widget components
│   │   ├── chat/               # Chat interface components
│   │   │   └── ChatPanel.tsx        # Main chat panel
│   │   ├── gallery/            # Use cases gallery
│   │   │   └── UseCasesGallery.tsx  # Gallery grid
│   │   ├── layout/             # Layout components
│   │   │   └── Sidebar.tsx          # Navigation sidebar
│   │   └── ui/                 # Shared UI components (shadcn/ui style)
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Utilities and clients
│   │   ├── a2a-client.ts       # A2A protocol client
│   │   └── utils.ts            # Helper utilities
│   ├── store/                  # State management (Zustand)
│   │   └── chat-store.ts       # Chat state
│   └── types/                  # TypeScript types
│       └── a2a.ts              # A2A protocol types
├── Dockerfile                  # Production Docker image
├── package.json
└── README.md
```

## A2A Protocol Support

The UI supports the full A2A protocol specification:

### Event Types

| Event Kind | Description | Display |
|------------|-------------|---------|
| `task` | Task lifecycle events | Blue badge with task state |
| `artifact-update` | Streaming content and artifacts | Purple badge, content preview |
| `status-update` | Final status with completion state | Green badge with final indicator |

### Artifact Names

| Artifact Name | Purpose | Icon |
|---------------|---------|------|
| `streaming_result` | Incremental text output | Radio |
| `partial_result` | Complete response chunk | FileText |
| `final_result` | Final completed response | CheckCircle |
| `tool_notification_start` | Tool execution started | Wrench |
| `tool_notification_end` | Tool execution completed | CheckSquare |
| `execution_plan_update` | TODO plan updates | ListTodo |

### A2UI Widget Support

The UI includes a widget catalog for A2UI declarative UI:

- **Button**: Clickable actions
- **Form**: Input forms with validation
- **Card**: Content cards with variants
- **List**: Ordered/unordered lists with status
- **Table**: Data tables
- **Progress**: Progress bars
- **Select**: Dropdown selection
- **Input**: Text input fields

## Use Cases Gallery

Pre-built scenarios for common platform engineering tasks:

- Check Deployment Status (ArgoCD)
- Review Open Pull Requests (GitHub)
- Incident Investigation (PagerDuty + Jira + ArgoCD)
- AWS Cost Analysis
- Sprint Progress Report (Jira)
- On-Call Handoff (Multi-agent)
- Security Vulnerability Report (GitHub)
- Cluster Resource Health (AWS/Kubernetes)
- Release Readiness Check (Multi-agent)
- Documentation Search (RAG)

## Development

### Tech Stack

- **Framework**: Next.js 15 with App Router & React Server Components
- **UI**: React 19, Tailwind CSS, Radix UI primitives
- **State**: Zustand (lightweight state management)
- **Animations**: Framer Motion
- **Markdown**: react-markdown with syntax highlighting (Prism)
- **Graph Visualization**: Sigma.js (@react-sigma/core)
- **A2A Protocol**: Using @a2a-js/sdk via A2ASDKClient wrapper
- **A2UI Widgets**: Custom implementation following A2UI spec

**Note**:
- **A2A SDK**: Uses official `@a2a-js/sdk` (v0.3.9+) via `A2ASDKClient` wrapper for agent communication
- **CopilotKit & AG-UI**: Installed for reference, but UI uses custom widget implementations following A2UI and AG-UI specifications

### Building

```bash
# Build for production
npm run build

# Run production build
npm start
```

### Linting

```bash
npm run lint
```

## Docker Compose Integration

The UI is included in `docker-compose.dev.yaml` with the `caipe-ui` profile:

```bash
# Using Make (recommended)
make caipe-ui-docker-compose

# Or using Docker Compose with COMPOSE_PROFILES
COMPOSE_PROFILES=caipe-ui docker compose -f docker-compose.dev.yaml up

# Or with --profile flag
docker compose -f docker-compose.dev.yaml --profile caipe-ui up

# Start everything (all agents + UI)
COMPOSE_PROFILES="all-agents,caipe-ui" docker compose -f docker-compose.dev.yaml up
```

### Available Make Targets

- `make caipe-ui` - Install dependencies and run dev server (local development)
- `make caipe-ui-install` - Install UI dependencies only
- `make caipe-ui-build` - Build UI for production
- `make caipe-ui-dev` - Run UI in development mode
- `make caipe-ui-docker-compose` - Run UI with Docker Compose (includes supervisor)
- `make build-caipe-ui` - Build Docker image locally
- `make run-caipe-ui-docker` - Run UI container (requires supervisor running)

## Contributing

1. Follow the project's conventional commit format
2. Include DCO sign-off on commits
3. Run linting before submitting PRs
4. Update this README if adding new features

## License

See project LICENSE file.
