import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/da-proxy";
import { getCollection } from "@/lib/mongodb";
import { getHarnessEngineConfig, proxyHarnessEngine } from "@/lib/harness-engine-proxy";
import { requireAgentUsePermission } from "@/lib/rbac/openfga-agent-authz";
import { authorizeConversationReadAccess, authorizeConversationWriteAccess, resolveConversationRuntimeId } from "@/app/api/v1/chat/_conversation-authz";
import type { Conversation } from "@/types/mongodb";
import type { HarnessRun } from "@/types/harness-engine";

/** Engine ownership is necessary but does not replace current CAIPE resource grants. */
export async function authorizeEngineRun(request: NextRequest, runId: string, write = false) {
  const auth = await authenticateRequest(request);
  if (auth instanceof NextResponse) return auth;
  const config = getHarnessEngineConfig();
  if (config instanceof NextResponse) return config;
  const response = await proxyHarnessEngine(config, auth, `/api/v1/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) return response;
  let envelope: { success: boolean; data?: HarnessRun };
  try {
    envelope = await response.clone().json();
  } catch {
    return NextResponse.json({ error: "Invalid run metadata" }, { status: 502 });
  }
  const run = envelope.data;
  if (!envelope.success || !run || run.run_id !== runId) return NextResponse.json({ error: "Invalid run metadata" }, { status: 502 });
  const conversations = await getCollection<Conversation>("conversations");
  let conversation = await conversations.findOne({ $or: [{ _id: run.conversation_id }, { execution_context_id: run.conversation_id }] });
  if (!conversation) {
    const contexts = await getCollection(process.env.AUTONOMOUS_RUNS_COLLECTION || "autonomous_runs");
    const context = await contexts.findOne({ execution_context_id: run.conversation_id }, { projection: { task_id: 1 } });
    if (context?.task_id) conversation = await conversations.findOne({ source: "autonomous", task_id: context.task_id });
  }
  if (!conversation || await resolveConversationRuntimeId(conversation) !== run.conversation_id) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!write) {
    const denial = await requireAgentUsePermission({ ...auth, agentId: run.agent_id });
    if (denial) return denial;
  }
  const authorized = write
    ? await authorizeConversationWriteAccess(auth, conversation._id)
    : await authorizeConversationReadAccess(auth, conversation._id, run.agent_id);
  if (authorized.denial) return authorized.denial;
  return { auth, config, run, response };
}
