/**
 * `caipe sessions list|resume`
 */

import { listSessions } from "../chat/history.js";
import { runChat } from "../chat/runner.js";

export async function runSessionsList(opts: { json?: boolean }): Promise<void> {
  const sessions = listSessions();
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
    return;
  }
  if (sessions.length === 0) {
    process.stdout.write("No saved sessions. Exit a chat with /exit to persist history.\n");
    return;
  }
  for (const s of sessions) {
    process.stdout.write(
      `${s.sessionId}  agent=${s.agentName}  messages=${s.messageCount}  started=${s.startedAt}\n`,
    );
  }
}

export async function runSessionsResume(
  sessionId: string,
  globalOpts: Record<string, unknown>,
): Promise<void> {
  await runChat({ resume: sessionId }, globalOpts as { url?: string; agent?: string });
}
