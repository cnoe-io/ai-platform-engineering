/**
 * Chat session history serializer.
 *
 * Sessions are persisted to ~/.config/caipe/sessions/<sessionId>.json on exit.
 * Rolling 100k token window: oldest messages are dropped when exceeded.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { sessionsDir } from "../platform/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  agentName: string;
  tokenCount: number | null;
}

export interface ChatSession {
  sessionId: string;
  agentName: string;
  agentEndpoint: string;
  protocol: "a2a" | "agui";
  headless: boolean;
  outputFormat: "text" | "json" | "ndjson";
  workingDir: string;
  repoRoot: string | null;
  startedAt: string;
  messages: Message[];
  memoryContext: string;
}

export interface SessionSummary {
  sessionId: string;
  agentName: string;
  protocol: "a2a" | "agui";
  startedAt: string;
  messageCount: number;
}

// Rolling window limit (~100k tokens @ 4 chars/token)
const MAX_CONTEXT_CHARS = 400_000;

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

export function createSession(overrides: Partial<ChatSession> & Pick<ChatSession, "agentName" | "workingDir">): ChatSession {
  return {
    sessionId: randomUUID(),
    agentEndpoint: "",
    protocol: "a2a",
    headless: false,
    outputFormat: "text",
    repoRoot: null,
    startedAt: new Date().toISOString(),
    messages: [],
    memoryContext: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function ensureSessionsDir(): string {
  const dir = sessionsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Persist a ChatSession to disk.
 * Applies rolling window before saving.
 */
export function saveSession(session: ChatSession): void {
  const dir = ensureSessionsDir();
  const path = join(dir, `${session.sessionId}.json`);
  const trimmed = applyRollingWindow(session);
  writeFileSync(path, JSON.stringify(trimmed, null, 2) + "\n", "utf8");
}

/**
 * Load a session by ID. Returns null if not found.
 */
export function loadSession(id: string): ChatSession | null {
  const path = join(sessionsDir(), `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ChatSession;
  } catch {
    return null;
  }
}

/**
 * List all saved sessions (most recent first).
 */
export function listSessions(): SessionSummary[] {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf8");
      const s = JSON.parse(raw) as ChatSession;
      summaries.push({
        sessionId: s.sessionId,
        agentName: s.agentName,
        protocol: s.protocol,
        startedAt: s.startedAt,
        messageCount: s.messages.length,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return summaries.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Rolling window
// ---------------------------------------------------------------------------

/**
 * Trim oldest messages until total content fits within MAX_CONTEXT_CHARS.
 * Returns a new session with trimmed messages (originals untouched).
 */
function applyRollingWindow(session: ChatSession): ChatSession {
  const messages = [...session.messages];
  let total = messages.reduce((sum, m) => sum + m.content.length, 0);

  while (total > MAX_CONTEXT_CHARS && messages.length > 1) {
    const dropped = messages.shift();
    if (dropped) total -= dropped.content.length;
  }

  return { ...session, messages };
}
