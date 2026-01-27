---
sidebar_position: 4
---

# Developer Guide

This guide is for developers who want to contribute to the CAIPE UI, extend its functionality, or integrate it into their own projects.

## Prerequisites

### Required Tools

- **Node.js**: v18.17.0 or higher (v20.x recommended)
- **npm**: v9.0.0 or higher
- **Git**: v2.30.0 or higher
- **Docker**: v24.0.0 or higher (for containerized development)

### Optional Tools

- **VS Code**: Recommended IDE with extensions:
  - ESLint
  - Prettier
  - Tailwind CSS IntelliSense
  - TypeScript and JavaScript Language Features
- **Docker Compose**: For full-stack development
- **MongoDB**: For testing MongoDB storage backend

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/cnoe-io/ai-platform-engineering.git
cd ai-platform-engineering
```

### 2. Install Dependencies

Using Make (Recommended):
```bash
# From repository root
make caipe-ui-install
```

Or manually:
```bash
cd ui
npm install

# Or use clean install for CI/reproducible builds
npm ci
```

### 3. Configure Environment

Create a `.env.local` file in the `ui/` directory from the repository root:

```bash
# ui/.env.local

# CAIPE supervisor endpoint
CAIPE_URL=http://localhost:8000
NEXT_PUBLIC_CAIPE_URL=http://localhost:8000

# NextAuth configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=development-secret-change-in-production

# Skip authentication for local development
SKIP_AUTH=true

# Use file-based storage for development
USECASE_STORAGE_TYPE=file
USECASE_STORAGE_PATH=./data/usecases.json

# Enable debug logging
LOG_LEVEL=debug
DEBUG=a2a:*,chat:*
```

### 4. Start Development Server

Using Make (Recommended):
```bash
# From repository root - runs UI dev server only
make caipe-ui-dev
```

Or manually:
```bash
cd ui
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 5. Start CAIPE Supervisor

In a separate terminal, start the CAIPE supervisor:

Using Make:
```bash
make caipe-supervisor
```

Or using Docker Compose:
```bash
docker compose -f docker-compose.dev.yaml up caipe-supervisor
```

Or start everything including agents:

```bash
# Using environment variable
COMPOSE_PROFILES=all-agents docker compose -f docker-compose.dev.yaml up

# Or using --profile flag
docker compose -f docker-compose.dev.yaml --profile all-agents up
```

### Alternative: Run Everything Together

```bash
# Run UI + Supervisor using Make
make caipe-ui-docker-compose

# This is equivalent to:
docker compose -f docker-compose.dev.yaml --profile caipe-ui up --build
```

## Project Structure

```
ui/
├── public/                      # Static assets
│   ├── *.svg                    # Agent/tool icons
│   └── favicon.ico              # Application icon
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── api/                 # API routes
│   │   │   ├── auth/            # NextAuth endpoints
│   │   │   ├── chat/            # Chat API
│   │   │   └── usecases/        # Use cases CRUD
│   │   ├── login/               # Login page
│   │   ├── logout/              # Logout handler
│   │   ├── unauthorized/        # 403 page
│   │   ├── globals.css          # Global styles
│   │   ├── layout.tsx           # Root layout
│   │   └── page.tsx             # Home page (3-panel)
│   ├── components/
│   │   ├── a2a/                 # A2A protocol components
│   │   │   ├── A2AStreamPanel.tsx
│   │   │   ├── A2UIRenderer.tsx
│   │   │   ├── ContextPanel.tsx
│   │   │   └── widgets/         # A2UI widget library
│   │   │       ├── Button.tsx
│   │   │       ├── Card.tsx
│   │   │       ├── Form.tsx
│   │   │       ├── List.tsx
│   │   │       ├── Progress.tsx
│   │   │       ├── Select.tsx
│   │   │       ├── Table.tsx
│   │   │       └── index.tsx
│   │   ├── auth/                # Authentication
│   │   │   ├── auth-guard.tsx
│   │   │   └── auth-provider.tsx
│   │   ├── chat/                # Chat interface
│   │   │   ├── AgentStreamBox.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── MessageList.tsx
│   │   │   └── MessageRenderer.tsx
│   │   ├── gallery/             # Use cases gallery
│   │   │   ├── IntegrationOrbit.tsx
│   │   │   ├── UseCaseCard.tsx
│   │   │   └── UseCasesGallery.tsx
│   │   ├── layout/              # Layout components
│   │   │   └── Sidebar.tsx
│   │   ├── rag/                 # RAG/ontology components
│   │   │   └── graph/           # Knowledge graph
│   │   ├── shared/              # Shared utilities
│   │   ├── ui/                  # UI primitives (shadcn/ui)
│   │   ├── loading-screen.tsx
│   │   ├── settings-panel.tsx
│   │   ├── tech-stack.tsx
│   │   ├── theme-provider.tsx
│   │   ├── theme-toggle.tsx
│   │   └── user-menu.tsx
│   ├── hooks/                   # Custom React hooks
│   │   ├── use-a2a-streaming.ts # A2A SSE streaming
│   │   ├── use-chat.ts          # Chat state management
│   │   └── use-toast.ts         # Toast notifications
│   ├── lib/                     # Utilities & clients
│   │   ├── a2a-client.ts        # A2A protocol client
│   │   ├── a2a-sdk-client.ts    # SDK-based client
│   │   ├── storage/             # Storage backends
│   │   │   ├── file.ts          # File storage
│   │   │   ├── mongodb.ts       # MongoDB storage
│   │   │   └── index.ts         # Storage factory
│   │   └── utils.ts             # Helper functions
│   ├── store/                   # State management
│   │   └── chat-store.ts        # Zustand chat store
│   └── types/                   # TypeScript types
│       ├── a2a.ts               # A2A protocol types
│       ├── chat.ts              # Chat types
│       └── usecase.ts           # Use case types
├── .eslintrc.json               # ESLint configuration
├── .gitignore                   # Git ignore rules
├── Dockerfile                   # Production container
├── next.config.js               # Next.js configuration
├── package.json                 # Dependencies
├── postcss.config.js            # PostCSS config
├── tailwind.config.ts           # Tailwind CSS config
├── tsconfig.json                # TypeScript config
└── README.md                    # Project README
```

## Architecture

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 15 | React framework with App Router & RSC |
| **UI Library** | React 19 | Component-based UI |
| **Styling** | Tailwind CSS | Utility-first CSS framework |
| **Components** | Radix UI | Accessible, unstyled primitives |
| **State** | Zustand | Lightweight state management |
| **Animations** | Framer Motion | Smooth animations & transitions |
| **Markdown** | react-markdown | Markdown rendering with remark-gfm |
| **Syntax Highlighting** | react-syntax-highlighter | Code block syntax highlighting |
| **Graph Viz** | Sigma.js (@react-sigma/core) | Knowledge graph visualization |
| **Auth** | NextAuth.js | OAuth 2.0 authentication |
| **A2A Protocol** | @a2a-js/sdk (v0.3.9+) | Standards-compliant agent-to-agent communication |
| **TypeScript** | TypeScript 5.x | Type safety & developer experience |
| **Linting** | ESLint | Code quality enforcement |
| **Formatting** | Prettier (optional) | Code formatting consistency |

### Protocol Implementations

| Protocol/Spec | Implementation | Purpose |
|---------------|----------------|---------|
| **A2A Protocol** | @a2a-js/sdk via A2ASDKClient | Agent communication, streaming |
| **A2UI Spec** | Custom widgets | Declarative UI components |
| **AG-UI Patterns** | Aligned (not using library) | Real-time AI interaction patterns |
| **MCP** | Via CAIPE supervisor | Tool integration |

**Important**: 
- **@a2a-js/sdk**: ACTIVELY USED via `A2ASDKClient` wrapper (`ui/src/lib/a2a-sdk-client.ts`) for standards-compliant A2A protocol communication
- **CopilotKit**: Installed for reference; UI uses custom widget implementations following A2UI and AG-UI specifications
- See `ui/src/components/chat/ChatPanel.tsx` for SDK usage example

### Key Design Patterns

#### 1. Component Composition

```typescript
// Example: Building the chat panel from smaller components
<ChatPanel>
  <ChatHeader />
  <MessageList>
    <MessageRenderer />
  </MessageList>
  <ChatInput />
</ChatPanel>
```

#### 2. Custom Hooks

Encapsulate complex logic in reusable hooks:

```typescript
// hooks/use-a2a-streaming.ts
export function useA2AStreaming(endpoint: string) {
  const [messages, setMessages] = useState<A2AMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(endpoint);
    
    eventSource.onmessage = (event) => {
      const message = JSON.parse(event.data);
      setMessages(prev => [...prev, message]);
    };

    return () => eventSource.close();
  }, [endpoint]);

  return { messages, isConnected };
}
```

#### 3. State Management with Zustand

```typescript
// store/chat-store.ts
import { create } from 'zustand';

interface ChatStore {
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: [] }),
}));
```

#### 4. Server Components vs Client Components

```typescript
// Server Component (default in App Router)
// app/page.tsx
export default async function HomePage() {
  const agents = await fetchAgents(); // Server-side
  return <ChatInterface agents={agents} />;
}

// Client Component (interactive)
// components/chat/ChatInput.tsx
'use client';
import { useState } from 'react';

export function ChatInput() {
  const [input, setInput] = useState('');
  // ... interactive logic
}
```

## Development Workflow

### 1. Creating a New Feature

```bash
# Create a new feature branch
git checkout -b feat/my-new-feature

# Make changes
# ...

# Run linting and type checking
npm run lint
npx tsc --noEmit

# Test locally
npm run dev

# Commit with conventional commits
git commit -s -m "feat(chat): add message reactions

Added emoji reactions to chat messages for better user engagement.

Signed-off-by: Your Name <your.email@example.com>"
```

### 2. Adding a New Component

**Example: Adding a new A2UI widget**

1. Create the component file:

```typescript
// src/components/a2a/widgets/Badge.tsx
'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeWidget {
  type: 'badge';
  text: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export function Badge({ text, variant = 'default' }: BadgeWidget) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        {
          'bg-gray-100 text-gray-800': variant === 'default',
          'bg-green-100 text-green-800': variant === 'success',
          'bg-yellow-100 text-yellow-800': variant === 'warning',
          'bg-red-100 text-red-800': variant === 'error',
        }
      )}
    >
      {text}
    </span>
  );
}
```

2. Register in the widget catalog:

```typescript
// src/components/a2a/widgets/index.tsx
export { Badge } from './Badge';
export { Button } from './Button';
export { Card } from './Card';
// ... other widgets
```

3. Add to the A2UI renderer:

```typescript
// src/components/a2a/A2UIRenderer.tsx
import { Badge, Button, Card } from './widgets';

export function A2UIRenderer({ widget }: { widget: any }) {
  switch (widget.type) {
    case 'badge':
      return <Badge {...widget} />;
    case 'button':
      return <Button {...widget} />;
    case 'card':
      return <Card {...widget} />;
    // ... other cases
  }
}
```

### 3. Adding a New API Route

```typescript
// src/app/api/agents/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const caipeUrl = process.env.CAIPE_URL || 'http://localhost:8000';
    const response = await fetch(`${caipeUrl}/.well-known/agent-card.json`);
    const data = await response.json();
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  // Handle POST request
  return NextResponse.json({ success: true });
}
```

### 4. Styling Components

**Using Tailwind CSS:**

```tsx
<div className="flex items-center gap-2 rounded-lg bg-gray-100 p-4 dark:bg-gray-800">
  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
    Status: Active
  </span>
</div>
```

**Using CSS Modules (if needed):**

```tsx
// component.module.css
.container {
  @apply flex items-center gap-2;
}

.title {
  @apply text-lg font-bold;
}

// component.tsx
import styles from './component.module.css';

export function MyComponent() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Title</h1>
    </div>
  );
}
```

## Testing

### Unit Testing (Coming Soon)

We're planning to add comprehensive unit testing with Jest and React Testing Library.

**Example test structure:**

```typescript
// __tests__/components/chat/ChatInput.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';

describe('ChatInput', () => {
  it('should render input field', () => {
    render(<ChatInput onSend={() => {}} />);
    expect(screen.getByPlaceholderText(/type a message/i)).toBeInTheDocument();
  });

  it('should call onSend when submitted', () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.submit(input);
    
    expect(onSend).toHaveBeenCalledWith('Hello');
  });
});
```

### Manual Testing

#### Test Checklist

- [ ] **Authentication Flow**
  - Login works with OAuth
  - Session persists across page reloads
  - Logout clears session
  - Unauthorized access redirects to login

- [ ] **Chat Interface**
  - Messages send successfully
  - Responses stream in real-time
  - Markdown renders correctly
  - Code blocks have syntax highlighting
  - Copy to clipboard works

- [ ] **Use Cases Gallery**
  - Use cases load and display
  - Clicking a use case populates chat input
  - Custom use cases can be created
  - Use cases persist (file or MongoDB)

- [ ] **A2A Streaming**
  - Events appear in context panel
  - Event filtering works
  - Message inspection shows details
  - Streaming handles rapid updates

- [ ] **Responsive Design**
  - Works on desktop (1920x1080)
  - Works on tablet (768x1024)
  - Works on mobile (375x667)
  - Sidebar collapses on small screens

- [ ] **Dark Mode**
  - Toggle switches themes
  - Theme persists across sessions
  - All components look good in both themes

### Browser Testing

Test in all supported browsers:

```bash
# Chrome/Edge (Chromium)
npm run dev

# Firefox
npm run dev

# Safari (macOS only)
npm run dev
```

## Debugging

### Development Tools

#### 1. React Developer Tools

Install the [React DevTools](https://react.dev/learn/react-developer-tools) browser extension to inspect component hierarchy and props.

#### 2. Next.js Debug Mode

```bash
# Enable debug logging
NODE_OPTIONS='--inspect' npm run dev

# Then open chrome://inspect in Chrome
```

#### 3. Network Inspection

Monitor A2A protocol messages:

1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter by "EventStream" or "SSE"
4. Watch real-time A2A events

#### 4. Console Logging

Add debug logging to components:

```typescript
'use client';
import { useEffect } from 'react';

export function MyComponent() {
  useEffect(() => {
    console.log('[MyComponent] Mounted');
    return () => console.log('[MyComponent] Unmounted');
  }, []);

  return <div>Content</div>;
}
```

### Common Issues

#### Issue: "CAIPE_URL is not defined"

**Solution:**
```bash
# Ensure .env.local exists and contains:
CAIPE_URL=http://localhost:8000
NEXT_PUBLIC_CAIPE_URL=http://localhost:8000

# Restart dev server
npm run dev
```

#### Issue: "Authentication fails in development"

**Solution:**
```bash
# Skip auth for local development
echo "SKIP_AUTH=true" >> .env.local
npm run dev
```

#### Issue: "Streaming not working"

**Solution:**
1. Check CAIPE supervisor is running:
   ```bash
   curl http://localhost:8000/.well-known/agent-card.json
   ```

2. Verify SSE endpoint:
   ```bash
   curl -N http://localhost:8000/v1/chat/stream
   ```

3. Check browser console for errors

## Code Quality

### Linting

```bash
# Run ESLint
npm run lint

# Auto-fix issues
npm run lint -- --fix
```

**ESLint Configuration** (`.eslintrc.json`):

```json
{
  "extends": "next/core-web-vitals",
  "rules": {
    "react/no-unescaped-entities": "off",
    "@next/next/no-img-element": "off"
  }
}
```

### Type Checking

```bash
# Run TypeScript compiler
npx tsc --noEmit

# Watch mode
npx tsc --noEmit --watch
```

### Code Formatting

We use Prettier for consistent code formatting:

```bash
# Format all files
npx prettier --write .

# Check formatting
npx prettier --check .
```

**Prettier Configuration** (`.prettierrc`):

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

## Performance Optimization

### 1. Code Splitting

Use dynamic imports for large components:

```typescript
import dynamic from 'next/dynamic';

// Lazy load heavy components
const OntologyGraph = dynamic(() => import('@/components/rag/graph/OntologyGraph'), {
  ssr: false,
  loading: () => <LoadingSpinner />,
});
```

### 2. Image Optimization

Use Next.js Image component:

```typescript
import Image from 'next/image';

<Image
  src="/agent-icon.svg"
  alt="Agent"
  width={32}
  height={32}
  priority // For above-the-fold images
/>
```

### 3. Memoization

Prevent unnecessary re-renders:

```typescript
import { memo, useMemo, useCallback } from 'react';

// Memoize expensive computations
const MessageList = memo(({ messages }) => {
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.timestamp - b.timestamp),
    [messages]
  );

  const handleDelete = useCallback((id: string) => {
    // ... delete logic
  }, []);

  return <div>{/* render messages */}</div>;
});
```

### 4. Virtual Scrolling

For large lists, use virtual scrolling:

```bash
npm install react-virtual
```

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export function MessageList({ messages }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 100,
  });

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div key={virtualItem.key} style={{ height: virtualItem.size }}>
            <Message message={messages[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Building for Production

### 1. Production Build

```bash
# Build optimized production bundle
npm run build

# Analyze bundle size
npm run build -- --analyze
```

### 2. Bundle Analysis

```bash
# Install bundle analyzer
npm install --save-dev @next/bundle-analyzer

# Configure in next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

module.exports = withBundleAnalyzer({
  // ... other config
});

# Run analysis
ANALYZE=true npm run build
```

### 3. Production Server

```bash
# Start production server
npm start

# Or with PM2 for production
npm install -g pm2
pm2 start npm --name "caipe-ui" -- start
```

### 4. Docker Build

```bash
# Build Docker image
docker build -t caipe-ui:latest .

# Run container
docker run -d \
  -p 3000:3000 \
  -e CAIPE_URL=http://caipe-supervisor:8000 \
  -e NEXTAUTH_SECRET=your-secret \
  caipe-ui:latest
```

## Contributing Guidelines

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]

Signed-off-by: Your Name <your.email@example.com>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(chat): add message reactions

Added emoji reaction support to chat messages.
Users can now react to messages with 👍 👎 ❤️

Signed-off-by: John Doe <john@example.com>
```

```bash
fix(a2a): handle null artifacts gracefully

Fixed crash when artifacts contain null values.

Closes #123

Signed-off-by: Jane Smith <jane@example.com>
```

### Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Test** thoroughly
5. **Lint** and format code
6. **Commit** with DCO sign-off (`git commit -s`)
7. **Push** to your fork
8. **Create** a pull request
9. **Address** review feedback

### Code Review Checklist

- [ ] Code follows project style guidelines
- [ ] All tests pass
- [ ] No linting errors
- [ ] TypeScript types are correct
- [ ] Documentation updated
- [ ] Commit messages follow conventions
- [ ] DCO sign-off present

## VS Code Setup

### Recommended Settings

Create `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "tailwindCSS.experimental.classRegex": [
    ["cn\\(([^)]*)\\)", "'([^']*)'"]
  ]
}
```

### Recommended Extensions

Create `.vscode/extensions.json`:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense"
  ]
}
```

## Troubleshooting

### Clear Cache and Rebuild

```bash
# Clear Next.js cache
rm -rf .next

# Clear node modules
rm -rf node_modules package-lock.json

# Reinstall
npm install

# Rebuild
npm run build
```

### Reset Development Environment

```bash
# Stop all processes
pkill -f "next-server"

# Clear caches
rm -rf .next node_modules

# Reinstall and restart
npm install
npm run dev
```

## Resources

### Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Radix UI Documentation](https://www.radix-ui.com/docs)
- [Zustand Documentation](https://github.com/pmndrs/zustand)

### Community

- [CAIPE GitHub Repository](https://github.com/cnoe-io/ai-platform-engineering)
- [CNOE Community](https://cnoe.io)
- [Discussions](https://github.com/cnoe-io/ai-platform-engineering/discussions)

## Next Steps

- [Features Guide](features.md) - Explore all UI features
- [Configuration Guide](configuration.md) - Production configuration
- [API Reference](api-reference.md) - API documentation
- [Troubleshooting](troubleshooting.md) - Common issues

---

**Questions?** Open an issue or join our community discussions!
