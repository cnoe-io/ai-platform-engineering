/**
 * Workflow Engine — Server-side workflow orchestration.
 *
 * Fire-and-forget execution model:
 * - startWorkflowRun() creates a run doc and returns immediately
 * - executeSteps() runs in the background (no await)
 * - UI polls /api/workflow-runs for status updates
 *
 * Uses server-agui-consumer.ts to invoke DA agents via AG-UI SSE and
 * workflow-templating.ts to render Jinja2 prompt templates.
 */

import { getCollection } from "@/lib/mongodb";
import { consumeAgentStream, type ConsumeResult } from "@/lib/streaming/clients/server-agui-consumer";
import { readEvents } from "@/lib/server/event-store";
import { isToolStartData } from "@/lib/streaming/types";
import { renderPrompt, buildTemplateContext, type StepContext } from "./workflow-templating";
import type { WorkflowConfig, WorkflowStep } from "@/types/workflow-config";
import { flattenStepEntries } from "@/types/workflow-config";

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const DA_SERVER_BASE_URL = process.env.DA_SERVER_BASE_URL || "http://localhost:8100";
const MAX_RUN_DURATION_SECONDS = parseInt(
  process.env.MAX_WORKFLOW_RUN_DURATION_SECONDS || "86400",
  10,
);
const CHECKPOINT_COLLECTION = process.env.WORKFLOW_CHECKPOINT_COLLECTION || "workflow_checkpoints";
const CHECKPOINT_TTL = parseInt(process.env.WORKFLOW_CHECKPOINT_TTL || "86400", 10);

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting_for_input"
  | "completed"
  | "failed";

export interface WorkflowStepRun {
  type: "step";
  index: number;
  display_text: string;
  agent_id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_for_input";
  prompt_sent: string | null;
  response: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  attempts: number;
  error: string | null;
  interrupt: ConsumeResult["interrupt"] | null;
}

export interface WorkflowRunTriggerInfo {
  triggered_by: "agent" | "webui" | string;
  context?: Record<string, unknown>;
}

export interface WorkflowRunDocument {
  _id: string;
  workflow_config_id: string;
  status: WorkflowRunStatus;
  steps: WorkflowStepRun[];
  current_step_index: number;
  user_context: string | null;
  trigger_info?: WorkflowRunTriggerInfo | null;
  started_at: Date;
  completed_at: Date | null;
}

const RUNS_COLLECTION = "workflow_runs";

// ═══════════════════════════════════════════════════════════════
// In-memory abort controllers (for cancellation)
// ═══════════════════════════════════════════════════════════════

const activeAbortControllers = new Map<string, AbortController>();

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Start a workflow run (fire-and-forget).
 * Creates the run document and kicks off execution in the background.
 *
 * @returns The run_id
 */
export async function startWorkflowRun(
  config: WorkflowConfig,
  userContext: string | null,
  authHeaders: Record<string, string>,
  triggerInfo?: WorkflowRunTriggerInfo | null,
): Promise<string> {
  const runId = generateRunId();
  const flatSteps = flattenStepEntries(config.steps);

  const stepRuns: WorkflowStepRun[] = flatSteps.map(({ index, step }) => ({
    type: "step",
    index,
    display_text: step.display_text,
    agent_id: step.agent_id,
    status: "pending",
    prompt_sent: null,
    response: null,
    started_at: null,
    completed_at: null,
    attempts: 0,
    error: null,
    interrupt: null,
  }));

  const runDoc: WorkflowRunDocument = {
    _id: runId,
    workflow_config_id: config._id,
    status: "running",
    steps: stepRuns,
    current_step_index: 0,
    user_context: userContext,
    trigger_info: triggerInfo || null,
    started_at: new Date(),
    completed_at: null,
  };

  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  await col.insertOne(runDoc as unknown as Parameters<typeof col.insertOne>[0]);

  // Fire-and-forget
  const flatWorkflowSteps = flatSteps.map(({ step }) => step);
  executeSteps(runId, config._id, config.name, config.description, flatWorkflowSteps, userContext, authHeaders, 0).catch((err) => {
    console.error(`[WorkflowEngine] Unhandled error in run ${runId}:`, err);
  });

  return runId;
}

/**
 * Resume a workflow run that's waiting for input.
 */
export async function resumeWorkflowRun(
  runId: string,
  stepIndex: number,
  resumeData: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  const run = await col.findOne({ _id: runId });
  if (!run) throw new Error(`Run ${runId} not found`);
  if (run.status !== "waiting_for_input") {
    throw new Error(`Run ${runId} is not waiting for input (status: ${run.status})`);
  }

  const step = run.steps[stepIndex];
  if (!step || step.status !== "waiting_for_input") {
    throw new Error(`Step ${stepIndex} is not waiting for input`);
  }

  // Load config to get step definitions
  const configCol = await getCollection<WorkflowConfig>("workflow_configs");
  const config = await configCol.findOne({ _id: run.workflow_config_id });
  if (!config) throw new Error(`Config ${run.workflow_config_id} not found`);

  const flatSteps = flattenStepEntries(config.steps).map(({ step: s }) => s);

  // Fire-and-forget: resume current step then continue
  resumeAndContinue(runId, run.workflow_config_id, config.name, config.description, stepIndex, resumeData, flatSteps, run.user_context, authHeaders).catch(
    (err) => {
      console.error(`[WorkflowEngine] Resume error in run ${runId}:`, err);
    },
  );
}

/**
 * Cancel a running workflow.
 */
export async function cancelWorkflowRun(runId: string): Promise<void> {
  // Abort any active stream
  const ac = activeAbortControllers.get(runId);
  if (ac) {
    ac.abort();
    activeAbortControllers.delete(runId);
  }

  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  await col.updateOne(
    { _id: runId },
    { $set: { status: "failed", completed_at: new Date() } },
  );
}

/**
 * Check if a run has exceeded its max duration and mark it failed.
 * Called during polling (GET).
 */
export async function detectStaleRun(run: WorkflowRunDocument): Promise<boolean> {
  if (run.status !== "running" && run.status !== "waiting_for_input") return false;

  const elapsed = (Date.now() - new Date(run.started_at).getTime()) / 1000;
  if (elapsed <= MAX_RUN_DURATION_SECONDS) return false;

  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  await col.updateOne(
    { _id: run._id },
    {
      $set: {
        status: "failed",
        completed_at: new Date(),
        [`steps.${run.current_step_index}.status`]: "failed",
        [`steps.${run.current_step_index}.error`]: "Run exceeded maximum duration",
      },
    },
  );
  return true;
}

// ═══════════════════════════════════════════════════════════════
// Internal Execution
// ═══════════════════════════════════════════════════════════════

async function executeSteps(
  runId: string,
  workflowConfigId: string,
  workflowName: string,
  workflowDescription: string | undefined,
  steps: WorkflowStep[],
  userContext: string | null,
  authHeaders: Record<string, string>,
  startFrom: number,
): Promise<void> {
  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  const completedSteps: StepContext[] = [];

  // Reconstruct completed step contexts if resuming
  if (startFrom > 0) {
    const run = await col.findOne({ _id: runId });
    if (run) {
      for (let i = 0; i < startFrom; i++) {
        const s = run.steps[i];
        completedSteps.push({
          output: s.response,
          display_text: s.display_text,
          agent_id: s.agent_id,
          status: s.status,
          index: i,
          error: s.error,
        });
      }
    }
  }

  for (let i = startFrom; i < steps.length; i++) {
    const step = steps[i];
    const sourceId = `${runId}-step-${i}`;

    // Mark step running
    await col.updateOne(
      { _id: runId },
      {
        $set: {
          current_step_index: i,
          [`steps.${i}.status`]: "running",
          [`steps.${i}.started_at`]: new Date(),
        },
      },
    );

    // Render prompt
    const templateCtx = buildTemplateContext(completedSteps, userContext);
    let renderedPrompt: string;
    try {
      renderedPrompt = renderPrompt(step.prompt, templateCtx);
    } catch (err) {
      await markStepFailed(col, runId, i, `Template error: ${(err as Error).message}`);
      if (step.on_error === "abort") {
        await markRunFailed(col, runId);
        return;
      }
      completedSteps.push({
        output: null,
        display_text: step.display_text,
        agent_id: step.agent_id,
        status: "failed",
        index: i,
        error: (err as Error).message,
      });
      continue;
    }

    // Update prompt_sent
    await col.updateOne(
      { _id: runId },
      { $set: { [`steps.${i}.prompt_sent`]: renderedPrompt } },
    );

    // Build the full enriched prompt with workflow context wrapping the step instruction
    const enrichedPrompt = buildWorkflowContextPrefix(
      workflowName, workflowDescription, completedSteps, i, steps.length, renderedPrompt,
    );

    // Execute with retry support
    const maxAttempts = step.on_error === "retry" ? (step.retry?.max_attempts ?? 3) : 1;
    let result: ConsumeResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await col.updateOne(
        { _id: runId },
        { $set: { [`steps.${i}.attempts`]: attempt } },
      );

      const abortController = new AbortController();
      activeAbortControllers.set(runId, abortController);

      // Build conversation_id for checkpoint isolation
      const conversationId = `workflow-${runId}-step-${i}`;

      result = await consumeAgentStream({
        url: `${DA_SERVER_BASE_URL}/api/v1/chat/stream/start`,
        body: {
          message: enrichedPrompt,
          conversation_id: conversationId,
          agent_id: step.agent_id,
          protocol: "agui",
          config_override: {
            backend: {
              config: {
                fs_namespace: [workflowConfigId, runId, "filesystem"],
                checkpoint_collection: CHECKPOINT_COLLECTION,
                checkpoint_ttl: CHECKPOINT_TTL,
              },
            },
            ...(step.config_override || {}),
          },
        },
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        sourceType: "workflow_step",
        sourceId: sourceId,
        signal: abortController.signal,
      });

      activeAbortControllers.delete(runId);

      // If no error or interrupted, break retry loop
      if (!result.error || result.interrupted) break;

      // If last attempt, don't retry
      if (attempt === maxAttempts) break;
    }

    if (!result) {
      await markStepFailed(col, runId, i, "No result from stream consumer");
      await markRunFailed(col, runId);
      return;
    }

    // Handle result
    if (result.interrupted) {
      // Write artifacts collected so far (partial step)
      const fsNamespace = [workflowConfigId, runId, "filesystem"];
      const { toolCalls, fullOutput } = await extractStepArtifacts(sourceId);
      await writeStepArtifactsToFs(fsNamespace, i, step.agent_id, renderedPrompt, toolCalls, fullOutput, authHeaders);

      await col.updateOne(
        { _id: runId },
        {
          $set: {
            status: "waiting_for_input",
            [`steps.${i}.status`]: "waiting_for_input",
            [`steps.${i}.interrupt`]: result.interrupt,
            [`steps.${i}.response`]: result.text || null,
          },
        },
      );
      return; // Execution pauses until resume
    }

    if (result.error) {
      await markStepFailed(col, runId, i, result.error);
      // Always write artifacts (even on abort/failure)
      const fsNamespace = [workflowConfigId, runId, "filesystem"];
      const { toolCalls, filesWritten, fullOutput } = await extractStepArtifacts(sourceId);
      await writeStepArtifactsToFs(fsNamespace, i, step.agent_id, renderedPrompt, toolCalls, fullOutput, authHeaders);

      if (step.on_error === "abort") {
        await markRunFailed(col, runId);
        return;
      }

      // skip: continue to next step
      completedSteps.push({
        output: null,
        display_text: step.display_text,
        agent_id: step.agent_id,
        status: "failed",
        index: i,
        error: result.error,
        filesWritten,
      });
      await col.updateOne(
        { _id: runId },
        { $set: { [`steps.${i}.status`]: "skipped" } },
      );
      continue;
    }

    // Stream completed without infrastructure error — extract artifacts
    const fsNamespace = [workflowConfigId, runId, "filesystem"];
    const { toolCalls, filesWritten, fullOutput } = await extractStepArtifacts(sourceId);
    await writeStepArtifactsToFs(fsNamespace, i, step.agent_id, renderedPrompt, toolCalls, fullOutput, authHeaders);

    // Check if agent self-reported failure via error.txt
    const agentError = await checkAgentErrorFile(fsNamespace, i, step.agent_id, authHeaders);
    if (agentError) {
      await markStepFailed(col, runId, i, agentError);
      if (step.on_error === "abort") {
        await markRunFailed(col, runId);
        return;
      }
      completedSteps.push({
        output: result.text,
        display_text: step.display_text,
        agent_id: step.agent_id,
        status: "failed",
        index: i,
        error: agentError,
        filesWritten,
      });
      continue;
    }

    // Success
    await col.updateOne(
      { _id: runId },
      {
        $set: {
          [`steps.${i}.status`]: "completed",
          [`steps.${i}.response`]: result.text,
          [`steps.${i}.completed_at`]: new Date(),
        },
      },
    );

    completedSteps.push({
      output: result.text,
      display_text: step.display_text,
      agent_id: step.agent_id,
      status: "completed",
      index: i,
      error: null,
      filesWritten,
    });
  }

  // All steps completed
  await col.updateOne(
    { _id: runId },
    { $set: { status: "completed", completed_at: new Date() } },
  );
}

async function resumeAndContinue(
  runId: string,
  workflowConfigId: string,
  workflowName: string,
  workflowDescription: string | undefined,
  stepIndex: number,
  resumeData: string,
  steps: WorkflowStep[],
  userContext: string | null,
  authHeaders: Record<string, string>,
): Promise<void> {
  const col = await getCollection<WorkflowRunDocument>(RUNS_COLLECTION);
  const step = steps[stepIndex];
  const sourceId = `${runId}-step-${stepIndex}`;
  const conversationId = `workflow-${runId}-step-${stepIndex}`;

  // Mark running again
  await col.updateOne(
    { _id: runId },
    {
      $set: {
        status: "running",
        [`steps.${stepIndex}.status`]: "running",
        [`steps.${stepIndex}.interrupt`]: null,
      },
    },
  );

  const abortController = new AbortController();
  activeAbortControllers.set(runId, abortController);

  const result = await consumeAgentStream({
    url: `${DA_SERVER_BASE_URL}/api/v1/chat/stream/resume`,
    body: {
      conversation_id: conversationId,
      agent_id: step.agent_id,
      resume_data: resumeData,
      protocol: "agui",
      config_override: {
        backend: {
          config: {
            fs_namespace: [workflowConfigId, runId, "filesystem"],
            checkpoint_collection: CHECKPOINT_COLLECTION,
            checkpoint_ttl: CHECKPOINT_TTL,
          },
        },
        ...(step.config_override || {}),
      },
    },
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    sourceType: "workflow_step",
    sourceId: sourceId,
    signal: abortController.signal,
  });

  activeAbortControllers.delete(runId);

  if (result.interrupted) {
    await col.updateOne(
      { _id: runId },
      {
        $set: {
          status: "waiting_for_input",
          [`steps.${stepIndex}.status`]: "waiting_for_input",
          [`steps.${stepIndex}.interrupt`]: result.interrupt,
          [`steps.${stepIndex}.response`]: result.text || null,
        },
      },
    );
    return;
  }

  if (result.error) {
    await markStepFailed(col, runId, stepIndex, result.error);
    // Re-write artifacts with full output (pre-interrupt + post-resume)
    const fsNamespace = [workflowConfigId, runId, "filesystem"];
    const { toolCalls, filesWritten, fullOutput } = await extractStepArtifacts(sourceId);
    const promptSent = (await col.findOne({ _id: runId }))?.steps[stepIndex]?.prompt_sent || "";
    await writeStepArtifactsToFs(fsNamespace, stepIndex, step.agent_id, promptSent, toolCalls, fullOutput, authHeaders);

    if (step.on_error === "abort") {
      await markRunFailed(col, runId);
      return;
    }
  } else {
    // Re-write artifacts with full output (pre-interrupt + post-resume)
    const fsNamespace = [workflowConfigId, runId, "filesystem"];
    const { toolCalls, filesWritten, fullOutput } = await extractStepArtifacts(sourceId);
    const promptSent = (await col.findOne({ _id: runId }))?.steps[stepIndex]?.prompt_sent || "";
    await writeStepArtifactsToFs(fsNamespace, stepIndex, step.agent_id, promptSent, toolCalls, fullOutput, authHeaders);

    // Check if agent self-reported failure via error.txt
    const agentError = await checkAgentErrorFile(fsNamespace, stepIndex, step.agent_id, authHeaders);
    if (agentError) {
      await markStepFailed(col, runId, stepIndex, agentError);
      if (step.on_error === "abort") {
        await markRunFailed(col, runId);
        return;
      }
    } else {
      await col.updateOne(
        { _id: runId },
        {
          $set: {
            [`steps.${stepIndex}.status`]: "completed",
            [`steps.${stepIndex}.response`]: result.text,
            [`steps.${stepIndex}.completed_at`]: new Date(),
          },
        },
      );
    }
  }

  // Continue with remaining steps
  await executeSteps(runId, workflowConfigId, workflowName, workflowDescription, steps, userContext, authHeaders, stepIndex + 1);
}

// ═══════════════════════════════════════════════════════════════
// Step Artifacts & Context Helpers
// ═══════════════════════════════════════════════════════════════

const MAX_CONTEXT_STEPS = 10;

/**
 * Extract tool call summaries and files written from persisted stream events.
 * Also reconstructs the full agent output from all content events.
 */
async function extractStepArtifacts(sourceId: string): Promise<{
  toolCalls: string[];
  filesWritten: string[];
  fullOutput: string;
}> {
  const events = await readEvents("workflow_step", sourceId);
  const toolStarts = new Map<string, { name: string; args: Record<string, unknown> }>();
  const toolCalls: string[] = [];
  const filesWritten: string[] = [];
  let fullOutput = "";

  for (const ev of events) {
    if (ev.type === "content" && ev.content) {
      fullOutput += ev.content;
    }
    if (ev.type === "tool_start" && ev.toolData && isToolStartData(ev.toolData)) {
      toolStarts.set(ev.toolData.tool_call_id, {
        name: ev.toolData.tool_name,
        args: ev.toolData.args || {},
      });
    }
    if (ev.type === "tool_end" && ev.toolData && !isToolStartData(ev.toolData)) {
      const start = toolStarts.get(ev.toolData.tool_call_id);
      if (start) {
        const argsStr = Object.entries(start.args)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        const status = ev.toolData.error ? "failed" : "success";
        toolCalls.push(`[call] ${start.name}(${argsStr}) → ${status}`);
        if (start.name === "write_file" && start.args.path) {
          filesWritten.push(String(start.args.path));
        }
      }
    }
  }
  return { toolCalls, filesWritten, fullOutput };
}

/**
 * Write step artifacts (prompt, tool calls, output) to the workflow filesystem namespace.
 */
async function writeStepArtifactsToFs(
  fsNamespace: string[],
  stepIndex: number,
  agentId: string,
  promptSent: string,
  toolCalls: string[],
  agentOutput: string,
  authHeaders: Record<string, string>,
): Promise<void> {
  const dir = `workflow-state/step-${stepIndex + 1}--${agentId}`;
  const files = [
    { path: `${dir}/user_prompt.txt`, content: promptSent },
    { path: `${dir}/tool_calls.txt`, content: toolCalls.join("\n") || "(no tool calls)" },
    { path: `${dir}/agent_output.txt`, content: agentOutput || "(no output)" },
  ];
  for (const f of files) {
    try {
      await fetch(`${DA_SERVER_BASE_URL}/api/v1/files/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ fs_namespace: fsNamespace, path: f.path, content: f.content }),
      });
    } catch (err) {
      console.error(`[WorkflowEngine] Failed to write artifact ${f.path}:`, err);
    }
  }
}

/**
 * Build a workflow context prefix to prepend to the step's user prompt.
 * Provides the agent with workflow awareness, previous step context, and critical instructions.
 */
function buildWorkflowContextPrefix(
  workflowName: string,
  workflowDescription: string | undefined,
  completedSteps: StepContext[],
  stepIndex: number,
  totalSteps: number,
  stepPrompt: string,
): string {
  let ctx = "";

  // --- Overview ---
  ctx += "This interaction is part of a larger workflow.\n\n";
  ctx += "## Workflow Execution\n";
  ctx += "A workflow is an automated multi-step pipeline where each step is handled by an agent. ";
  ctx += "You are one agent executing one step in this pipeline.\n\n";

  // --- Investigating previous steps ---
  ctx += "## Investigating Previous Steps\n";
  ctx += "Artifacts from previous steps are stored in the filesystem under `workflow-state/step-{N}--{agent-id}/`.\n";
  ctx += "You may use `ls` and `read_file` to inspect: user_prompt.txt, tool_calls.txt, agent_output.txt\n\n";

  // --- Critical: User interaction ---
  ctx += "## Critical: User Interaction\n";
  ctx += "The user does NOT have access to this chat. All interaction with the user must happen through the `require_user_input` tool.\n";
  ctx += "If that tool is not available and you cannot proceed without user input, state the reason and stop.\n\n";

  // --- Critical: Reporting failure ---
  ctx += "## Critical: Reporting Failure\n";
  ctx += `If you determine this step has failed or you cannot complete the task, write a brief explanation to \`workflow-state/step-${stepIndex + 1}--{your-agent-id}/error.txt\` using \`write_file\`.\n`;
  ctx += "The workflow engine will detect this file and mark the step as failed.\n\n";

  // --- Workflow identity ---
  ctx += "---\n\n";
  ctx += "## The workflow you are executing\n";
  ctx += `**Workflow name:** ${workflowName}\n`;
  if (workflowDescription) ctx += `**Workflow description:** ${workflowDescription}\n`;
  ctx += "\n";

  // --- Previous steps summary ---
  if (completedSteps.length > 0) {
    const visible =
      completedSteps.length > MAX_CONTEXT_STEPS
        ? completedSteps.slice(-MAX_CONTEXT_STEPS)
        : completedSteps;

    ctx += "## Summary of Previous Steps\n";
    if (completedSteps.length > MAX_CONTEXT_STEPS) {
      ctx += `(showing latest ${MAX_CONTEXT_STEPS} of ${completedSteps.length} steps)\n`;
    }
    for (const s of visible) {
      ctx += `- Step ${s.index + 1}: "${s.display_text}" (agent: ${s.agent_id}) — ${s.status}`;
      if (s.filesWritten?.length) ctx += `\n  Files written: ${s.filesWritten.join(", ")}`;
      ctx += "\n";
    }
    ctx += "\n";
  }

  // --- Current step ---
  ctx += "---\n\n";
  ctx += `You are executing **step ${stepIndex + 1} of ${totalSteps}**.\n\n`;
  ctx += "Interpret and act on this step in the context of the overall workflow — not in isolation. ";
  ctx += "Consider what previous steps have accomplished and what subsequent steps may need from you.\n\n";
  ctx += "With that in mind, the instruction for this step is:\n\n";
  ctx += "```\n";
  ctx += stepPrompt;
  ctx += "\n```\n";

  return ctx;
}

/**
 * Check if the agent wrote an error.txt file to signal step failure.
 * Returns the error content if found, null otherwise.
 */
async function checkAgentErrorFile(
  fsNamespace: string[],
  stepIndex: number,
  agentId: string,
  authHeaders: Record<string, string>,
): Promise<string | null> {
  const path = `workflow-state/step-${stepIndex + 1}--${agentId}/error.txt`;
  try {
    const res = await fetch(
      `${DA_SERVER_BASE_URL}/api/v1/files/content?fs_namespace=${encodeURIComponent(JSON.stringify(fsNamespace))}&path=${encodeURIComponent(path)}`,
      { headers: authHeaders },
    );
    if (res.ok) {
      const body = await res.json();
      return body?.content || "Agent reported failure (no details)";
    }
  } catch {
    // File not found or network error — not an agent error
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(16).slice(2, 10);
  return `wfrun-${ts}-${rand}`;
}

async function markStepFailed(
  col: Awaited<ReturnType<typeof getCollection<WorkflowRunDocument>>>,
  runId: string,
  stepIndex: number,
  error: string,
): Promise<void> {
  console.error(`[WorkflowEngine] Step ${stepIndex} failed in run ${runId}: ${error}`);
  await col.updateOne(
    { _id: runId },
    {
      $set: {
        [`steps.${stepIndex}.status`]: "failed",
        [`steps.${stepIndex}.error`]: error,
        [`steps.${stepIndex}.completed_at`]: new Date(),
      },
    },
  );
}

async function markRunFailed(
  col: Awaited<ReturnType<typeof getCollection<WorkflowRunDocument>>>,
  runId: string,
): Promise<void> {
  await col.updateOne(
    { _id: runId },
    { $set: { status: "failed", completed_at: new Date() } },
  );
}
