/** Projected cursors keep standard AG-UI frames replayable from one provider event journal. */
export interface HarnessRunCursor { sequence: number; part: number; count: number }
export function parseHarnessRunCursor(value: string): HarnessRunCursor | null {
  const match = /^e:(\d+):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const [sequence, part, count] = match.slice(1).map(Number);
  return [sequence, part, count].every(Number.isSafeInteger) && sequence > 0 && part > 0 && part <= count && count <= 16
    ? { sequence, part, count } : null;
}
export function harnessRunCursor(cursor: HarnessRunCursor): string {
  return `e:${cursor.sequence}:${cursor.part}:${cursor.count}`;
}
export function harnessEventCursor(id: string | undefined, runId: string): HarnessRunCursor | null {
  return id?.startsWith(`${runId}:`) ? parseHarnessRunCursor(id.slice(runId.length + 1)) : null;
}
