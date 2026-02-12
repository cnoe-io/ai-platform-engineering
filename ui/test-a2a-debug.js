#!/usr/bin/env node

/**
 * A2A Debug Test Script
 *
 * Tests A2A event streaming from the backend to verify event structure
 * and identify missing events in the UI.
 *
 * Usage:
 *   node test-a2a-debug.js
 *   node test-a2a-debug.js "your custom message"
 */

const { JsonRpcTransport } = require('@a2a-js/sdk/client');
const { v4: uuidv4 } = require('uuid');

const A2A_ENDPOINT = process.env.NEXT_PUBLIC_A2A_BASE_URL || 'http://localhost:8000';
const TEST_MESSAGE = process.argv[2] || 'show argocd version';

console.log(`\n${'='.repeat(70)}`);
console.log(`A2A Debug Test Script`);
console.log(`${'='.repeat(70)}`);
console.log(`Endpoint: ${A2A_ENDPOINT}`);
console.log(`Message:  "${TEST_MESSAGE}"`);
console.log(`${'='.repeat(70)}\n`);

async function testA2AStream() {
  const transport = new JsonRpcTransport({
    endpoint: A2A_ENDPOINT,
  });

  const contextId = uuidv4();
  const messageId = uuidv4();
  let eventCount = 0;

  const eventsByKind = {
    'message': [],
    'task': [],
    'status-update': [],
    'artifact-update': [],
    'error': [],
  };

  try {
    console.log(`📤 Sending message with contextId: ${contextId}\n`);

    // Match the UI's sendMessageStream parameters exactly
    const params = {
      contextId,
      message: {
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: TEST_MESSAGE }],
      },
    };

    const stream = transport.sendMessageStream(params);

    for await (const event of stream) {
      eventCount++;
      const kind = event.kind || 'unknown';

      // Track events by kind
      if (eventsByKind[kind]) {
        eventsByKind[kind].push(event);
      } else {
        eventsByKind[kind] = [event];
      }

      // Log basic event info
      console.log(`\n${'─'.repeat(70)}`);
      console.log(`Event #${eventCount}: ${kind.toUpperCase()}`);
      console.log(`${'─'.repeat(70)}`);

      if (kind === 'message') {
        const role = event.role || 'unknown';
        const text = event.parts?.[0]?.text || '';
        console.log(`Role: ${role}`);
        console.log(`Text: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      } else if (kind === 'task') {
        console.log(`Task ID: ${event.id}`);
        console.log(`Status: ${event.status?.state || 'unknown'}`);
        console.log(`Artifacts: ${event.artifacts?.length || 0}`);
        if (event.artifacts?.length > 0) {
          event.artifacts.forEach((art, idx) => {
            console.log(`  [${idx}] ${art.name}: ${art.description || '(no description)'}`);
          });
        }
      } else if (kind === 'status-update') {
        console.log(`Task ID: ${event.taskId}`);
        console.log(`State: ${event.status?.state || 'unknown'}`);
        console.log(`Final: ${event.final || false}`);
        console.log(`Message: ${event.status?.message || '(none)'}`);
      } else if (kind === 'artifact-update') {
        const artifactName = event.artifact?.name || 'unknown';
        const artifactText = event.artifact?.text || '';
        console.log(`Task ID: ${event.taskId}`);
        console.log(`Artifact: ${artifactName}`);
        console.log(`Append: ${event.append || false}`);
        console.log(`Text: ${artifactText.substring(0, 100)}${artifactText.length > 100 ? '...' : ''}`);
      } else if (kind === 'error') {
        console.log(`Code: ${event.code}`);
        console.log(`Message: ${event.message}`);
      } else {
        console.log(`Unknown event kind: ${kind}`);
        console.log(JSON.stringify(event, null, 2));
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Stream Complete - Total Events: ${eventCount}`);
    console.log(`${'='.repeat(70)}\n`);

    // Summary by event kind
    console.log(`Event Summary:`);
    Object.entries(eventsByKind).forEach(([kind, events]) => {
      if (events.length > 0) {
        console.log(`  ${kind}: ${events.length} event(s)`);
      }
    });

    // Detailed status-update analysis
    if (eventsByKind['status-update'].length > 0) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`Status Update Details:`);
      console.log(`${'='.repeat(70)}`);
      eventsByKind['status-update'].forEach((event, idx) => {
        console.log(`\n[${idx + 1}] Task: ${event.taskId}`);
        console.log(`    State: ${event.status?.state}`);
        console.log(`    Final: ${event.final}`);
        console.log(`    Message: ${event.status?.message || '(none)'}`);
      });
    } else {
      console.log(`\n⚠️  WARNING: No status-update events received!`);
    }

  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    console.error(error);
    throw error;
  }
}

testA2AStream().catch(console.error);
