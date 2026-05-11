"use client";

/**
 * useSkillAiAssist — encapsulates the streaming AI generate/enhance flow
 * the Skills Builder uses (POST `/api/skills/generate` SSE stream).
 *
 * Behaviour mirrors the legacy inline implementation in
 * `SkillsBuilderEditor`. The Workspace's `SkillAiAssistPanel` and any
 * other consumer should drive the flow exclusively through this hook so
 * we have one place that owns:
 *
 *   - AbortController lifecycle (cancel/cleanup)
 *   - Snapshot/rollback on cancel
 *   - SSE parsing
 *   - Debug log
 *   - Status state machine
 *   - Apply-on-success (calls back into the form via `setSkillContent`)
 *
 * The hook is intentionally side-effect-light: it does NOT toast on its
 * own — consumers receive `error: Error | null` and `cancelled: boolean`
 * and decide how to surface them. This keeps the hook usable from many
 * surfaces (Workspace toolbar, dialog, etc.).
 */

import { useCallback, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { getConfig } from "@/lib/config";
import { parseSkillMd } from "@/lib/skill-md-parser";

export const ENHANCE_PRESETS: { label: string; instruction: string }[] = [
  {
    label: "Rewrite",
    instruction:
      "Rewrite this SKILL.md from scratch while preserving the same purpose and intent. Improve structure, clarity, and completeness.",
  },
  {
    label: "Make Concise",
    instruction:
      "Make this SKILL.md more concise. Remove redundancy, tighten language, and keep only essential details while preserving all key information.",
  },
  {
    label: "Add Examples",
    instruction:
      "Add more practical, real-world examples to this SKILL.md. Include diverse use cases and edge cases.",
  },
  {
    label: "Clarify",
    instruction:
      "Improve the clarity of this SKILL.md. Simplify complex instructions, fix ambiguous wording, and ensure each step is easy to follow.",
  },
  {
    label: "Add Detail",
    instruction:
      "Add more detail to the instructions, guidelines, and output format sections. Make each phase more comprehensive.",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AiStatus = "idle" | "generating" | "enhancing";

export interface UseSkillAiAssistOptions {
  /**
   * Read-only snapshot of the current SKILL.md content. Used as the
   * `current_content` field for enhance requests and as the rollback
   * target on cancel.
   */
  getCurrentContent: () => string;

  /**
   * Optional name/description hints sent with each request so the model
   * has more context. Both are trimmed, and empty values are omitted.
   */
  getNameHint?: () => string | undefined;
  getDescriptionHint?: () => string | undefined;

  /**
   * Called when a generate/enhance succeeds. Receives the cleaned-up
   * SKILL.md and the parsed frontmatter (best-effort; null on parse
   * failure). The consumer is expected to write the content into the
   * form (typically via `setSkillContentAndSyncTools`) and optionally
   * patch the `name`/`description`.
   */
  onApply: (
    nextContent: string,
    parsed:
      | { name?: string; title?: string; description?: string }
      | null,
  ) => void;
}

export interface UseSkillAiAssistResult {
  status: AiStatus;
  isBusy: boolean;
  /** Last error from a non-aborted request, or null. */
  error: Error | null;
  /** True when the previous run was cancelled by the user. */
  cancelled: boolean;
  /** SSE debug log entries (timestamped). */
  debugLog: string[];
  /** Last prompt sent to the API (useful for the debug panel). */
  promptSent: string;

  /** Run a "generate from description" request. */
  generate: (description: string) => Promise<void>;
  /**
   * Run an "enhance current content" request. Pass either a free-form
   * `instruction` or a list of `presetLabels` (resolved against
   * `ENHANCE_PRESETS`) and an optional `customInstruction` appended at
   * the end.
   */
  enhance: (params: {
    instruction?: string;
    presetLabels?: string[];
    customInstruction?: string;
  }) => Promise<void>;
  /** Abort the in-flight request and roll back to the pre-run snapshot. */
  cancel: () => void;
  /** Wipe the debug log and prompt state. */
  resetDebug: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip everything before the first `---` frontmatter block, if present. */
function extractSkillMdFromResponse(response: string): string {
  const fmMatch = response.match(/(---\s*\n[\s\S]*?\n---[\s\S]*)/);
  if (fmMatch) return fmMatch[1].trim();
  return response.trim();
}

function buildEnhanceInstruction(
  presetLabels: string[] | undefined,
  custom: string | undefined,
): string {
  const parts: string[] = [];
  if (presetLabels?.length) {
    for (const label of presetLabels) {
      const preset = ENHANCE_PRESETS.find((p) => p.label === label);
      if (preset) parts.push(preset.instruction);
    }
  }
  if (custom?.trim()) parts.push(custom.trim());
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSkillAiAssist({
  getCurrentContent,
  getNameHint,
  getDescriptionHint,
  onApply,
}: UseSkillAiAssistOptions): UseSkillAiAssistResult {
  const { data: session } = useSession();
  const ssoEnabled = getConfig("ssoEnabled");
  const accessToken = ssoEnabled ? session?.accessToken : undefined;

  const [status, setStatus] = useState<AiStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [promptSent, setPromptSent] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<string>("");

  const appendDebug = useCallback((line: string) => {
    setDebugLog((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${line}`,
    ]);
  }, []);

  const resetDebug = useCallback(() => {
    setDebugLog([]);
    setPromptSent("");
  }, []);

  /** Low-level streaming POST. Returns the accumulated `content` text. */
  const sendRequest = useCallback(
    async (
      type: "generate" | "enhance",
      params: {
        description?: string;
        instruction?: string;
        current_content?: string;
      },
    ): Promise<string> => {
      appendDebug("Connecting to AI stream...");
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/skills/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            type,
            ...params,
            name: getNameHint?.()?.trim() || undefined,
            skill_description: getDescriptionHint?.()?.trim() || undefined,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            data.error || `Request failed: ${response.statusText}`,
          );
        }
        if (!response.body) throw new Error("No response body");

        appendDebug("Stream opened, waiting for events...");

        let accum = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event: { type?: string; text?: string; message?: string };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            const preview =
              (event.text || event.message || "")
                .slice(0, 120)
                .replace(/\n/g, "\\n") || "(no content)";
            appendDebug(`← ${event.type}: ${preview}`);
            if (event.type === "content" && event.text) {
              accum += event.text;
            } else if (event.type === "error") {
              throw new Error(event.message || "AI stream error");
            }
          }
        }
        appendDebug("Stream complete.");
        return accum;
      } finally {
        abortRef.current = null;
      }
    },
    [accessToken, appendDebug, getNameHint, getDescriptionHint],
  );

  /** Apply a successful response back into the form. */
  const applyResult = useCallback(
    (raw: string) => {
      const extracted = extractSkillMdFromResponse(raw);
      let parsed:
        | { name?: string; title?: string; description?: string }
        | null = null;
      try {
        parsed = parseSkillMd(extracted);
      } catch {
        parsed = null;
      }
      onApply(extracted, parsed);
    },
    [onApply],
  );

  // -------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------

  const generate = useCallback(
    async (description: string) => {
      const desc = description.trim();
      if (!desc) return;

      snapshotRef.current = getCurrentContent();
      setStatus("generating");
      setError(null);
      setCancelled(false);
      resetDebug();
      setPromptSent(`[generate] ${desc}`);

      try {
        const result = await sendRequest("generate", { description: desc });
        if (!result) throw new Error("Empty response from AI");
        applyResult(result);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          setCancelled(true);
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        setStatus("idle");
      }
    },
    [getCurrentContent, resetDebug, sendRequest, applyResult],
  );

  const enhance = useCallback(
    async ({
      instruction,
      presetLabels,
      customInstruction,
    }: {
      instruction?: string;
      presetLabels?: string[];
      customInstruction?: string;
    }) => {
      const current = getCurrentContent();
      if (!current.trim()) {
        setError(new Error("Add SKILL.md content before running enhancements."));
        return;
      }
      const built =
        instruction?.trim() ||
        buildEnhanceInstruction(presetLabels, customInstruction);
      if (!built.trim()) {
        setError(
          new Error(
            "Select at least one enhancement or add custom instructions.",
          ),
        );
        return;
      }

      snapshotRef.current = current;
      setStatus("enhancing");
      setError(null);
      setCancelled(false);
      resetDebug();
      setPromptSent(`[enhance] ${built}`);

      try {
        const result = await sendRequest("enhance", {
          instruction: built,
          current_content: current,
        });
        if (!result) throw new Error("Empty response from AI");
        applyResult(result);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          setCancelled(true);
        } else {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        setStatus("idle");
      }
    },
    [getCurrentContent, resetDebug, sendRequest, applyResult],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Roll back to the pre-run snapshot so the user can keep editing.
    onApply(snapshotRef.current, null);
    setStatus("idle");
    setCancelled(true);
  }, [onApply]);

  return {
    status,
    isBusy: status !== "idle",
    error,
    cancelled,
    debugLog,
    promptSent,
    generate,
    enhance,
    cancel,
    resetDebug,
  };
}
