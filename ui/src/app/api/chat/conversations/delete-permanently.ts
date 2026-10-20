import { ApiError } from '@/lib/api-middleware';
import { getHarnessEngineConfig, proxyHarnessEngine } from '@/lib/harness-engine-proxy';
import { NextResponse } from 'next/server';
import { getCollection } from '@/lib/mongodb';
import type { Conversation } from '@/types/mongodb';
import { resolveConversationRuntimeId } from '@/app/api/v1/chat/_conversation-authz';

/**
 * Hard-delete one or more conversations and all associated data
 * (messages + Dynamic Agent checkpoint records).
 */
export async function deleteConversationsPermanently(
  items: Array<Pick<Conversation, '_id' | 'participants'> & Partial<Pick<Conversation,
    'source' | 'execution_context_id' | 'task_id' | 'metadata'
  >>>
): Promise<void> {
  if (items.length === 0) return;

  const ids = items.map((c) => c._id);

  const runtimeIds = new Set(ids);
  for (const item of items) {
    // Resolve only the execution explicitly behind each authorized resource.
    // A task reference does not authorize purging every other task run.
    runtimeIds.add(await resolveConversationRuntimeId(item));
  }

  // A minimal deletion ledger closes the race with a request authorized
  // before this purge. Admission and replay reject these native session IDs.
  const deletedSessions = await getCollection<{ _id: string; deleted_at: Date }>('native_acp_deleted_sessions');
  const deletedAt = new Date();
  for (const sessionId of runtimeIds) {
    await deletedSessions.updateOne(
      { _id: sessionId },
      { $setOnInsert: { deleted_at: deletedAt } },
      { upsert: true },
    );
  }

  // Provider deletion must complete before visible history disappears. The
  // canonical tombstone already prevents any previously authorized late start.
  const engineSessions = await getCollection<{
    agent_id: string; conversation_id: string; owner_subject: string;
  }>('harness_sessions');
  const bindings = await engineSessions.find(
    { conversation_id: { $in: [...runtimeIds] } },
    { projection: { _id: 0, agent_id: 1, conversation_id: 1, owner_subject: 1 } },
  ).toArray();
  if (bindings.length > 0) {
    const config = getHarnessEngineConfig();
    if (config instanceof NextResponse) throw new ApiError('Harness Engine is unavailable; retry deletion after it recovers.', 503);
    const visited = new Set<string>();
    for (const binding of bindings) {
      if (!binding.owner_subject || !binding.agent_id || !runtimeIds.has(binding.conversation_id)) {
        throw new ApiError('Provider session identity is invalid; deletion was stopped.', 503);
      }
      const key = JSON.stringify([binding.owner_subject, binding.agent_id, binding.conversation_id]);
      if (visited.has(key)) continue;
      visited.add(key);
      // These identities come only from provider-owned stored bindings after
      // the caller's conversation-delete grant was checked by the owning route.
      const response = await proxyHarnessEngine(config, { subject: binding.owner_subject }, '/api/v1/sessions/delete', {
        method: 'POST', body: JSON.stringify({ agent_id: binding.agent_id, conversation_id: binding.conversation_id }),
      });
      if (!response.ok) throw new ApiError('Provider execution has not finished stopping; retry permanent deletion.', response.status === 409 ? 409 : 503);
    }
  }
  const routing = await getCollection('harness_gateway_bindings');
  await routing.deleteMany({ session_id: { $in: [...runtimeIds] } });

  const conversations = await getCollection<Conversation>('conversations');
  await conversations.deleteMany({ _id: { $in: ids } });

  const messages = await getCollection('messages');
  await messages.deleteMany({ conversation_id: { $in: ids } });
  // Journal metadata disappears first: readers stop immediately, and workers
  // cannot append further output to a deleted execution. Erase its event log
  // afterwards so replay cannot retain a second copy of a removed transcript.
  const executionRuns = await getCollection<{ run_id: string }>('native_acp_execution_runs');
  const runScope = { session_id: { $in: [...runtimeIds] } };
  const runs = await executionRuns.find(runScope, { projection: { run_id: 1 } }).toArray();
  await executionRuns.deleteMany(runScope);
  const executionEvents = await getCollection('native_acp_execution_events');
  await executionEvents.deleteMany({
    $or: [
      { session_id: { $in: [...runtimeIds] } },
      // Older journals predate the internal session index on event records.
      ...(runs.length > 0 ? [{ run_id: { $in: runs.map((run) => run.run_id) } }] : []),
    ],
  });

  const agentIds = items
    .filter((c) => c.participants?.some((p: { type: string }) => p.type === 'agent'))
    .map((c) => c._id);

  if (agentIds.length > 0) {
    const checkpoints = await getCollection('checkpoints_conversation');
    const checkpointWrites = await getCollection('checkpoint_writes_conversation');
    await checkpoints.deleteMany({ thread_id: { $in: [...runtimeIds] } });
    await checkpointWrites.deleteMany({ thread_id: { $in: [...runtimeIds] } });
  }
}
