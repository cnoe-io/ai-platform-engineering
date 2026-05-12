/**
 * Workflow Templating — Nunjucks-based prompt rendering for workflow steps.
 *
 * Provides Jinja2-compatible template rendering (via nunjucks) with a sandboxed
 * environment (no filesystem access, no async).
 *
 * Template context includes previous step outputs, enabling chained prompts:
 *   "Based on: {{ steps[0].output }}, now write a summary"
 *   "Using {{ previous_output }}, generate the final report"
 */

import nunjucks from "nunjucks";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface StepContext {
  /** Final text output from the step */
  output: string | null;
  /** Display text from workflow config */
  display_text: string;
  /** Agent ID that ran the step */
  agent_id: string;
  /** Step status */
  status: string;
  /** Step index (0-based) */
  index: number;
  /** Error message if step failed */
  error: string | null;
}

export interface TemplateContext {
  /** All completed steps (for indexed access: steps[0].output) */
  steps: StepContext[];
  /** Output of the most recently completed step (convenience shorthand) */
  previous_output: string | null;
  /** User-provided context for the workflow run */
  user_context: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Nunjucks Environment (sandboxed, no filesystem)
// ═══════════════════════════════════════════════════════════════

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Render a prompt template with the given context.
 *
 * @param template - Jinja2/Nunjucks template string
 * @param context - Template context (steps, previous_output, user_context)
 * @returns Rendered prompt string
 * @throws If template rendering fails (syntax error, etc.)
 */
export function renderPrompt(template: string, context: TemplateContext): string {
  return env.renderString(template, context);
}

/**
 * Build template context from completed step data.
 *
 * @param completedSteps - Array of step results (in order)
 * @param userContext - User-provided context for the run
 */
export function buildTemplateContext(
  completedSteps: StepContext[],
  userContext?: string | null,
): TemplateContext {
  const lastStep = completedSteps[completedSteps.length - 1];
  return {
    steps: completedSteps,
    previous_output: lastStep?.output ?? null,
    user_context: userContext ?? null,
  };
}
