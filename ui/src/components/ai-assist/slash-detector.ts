/**
 * slash-detector — utility for spotting an `/ai <instruction>` slash
 * command typed inside any `<input>` / `<textarea>`. Used by surfaces that
 * want a keyboard-first AI Assist trigger in addition to the sparkles
 * button.
 *
 * Convention: the magic phrase is `/ai ` at the *start* of the field's
 * value (whitespace allowed before it). Submitting it (Enter or blur,
 * depending on the host) routes the rest of the value as the popover
 * instruction and reverts the field to whatever it was before the slash.
 */

export interface SlashCommandMatch {
  /** Text after `/ai ` — the instruction to send. */
  instruction: string;
  /** Optional task hint, e.g. `/ai:code rewrite this` → `code`. */
  taskHint?: string;
}

const SLASH_RE = /^\s*\/ai(?::([a-z0-9_-]+))?\s+(.+)$/i;

export function detectSlashCommand(value: string): SlashCommandMatch | null {
  if (!value) return null;
  const match = value.match(SLASH_RE);
  if (!match) return null;
  return {
    instruction: match[2].trim(),
    taskHint: match[1]?.trim().toLowerCase() || undefined,
  };
}
