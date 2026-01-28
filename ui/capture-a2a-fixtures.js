#!/usr/bin/env node

/**
 * Capture A2A Streaming Fixtures
 *
 * Captures real A2A streaming responses from the backend and saves them
 * as JSON fixtures for UI testing.
 *
 * Usage:
 *   node capture-a2a-fixtures.js
 */

const { JsonRpcTransport } = require('@a2a-js/sdk/client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const A2A_ENDPOINT = process.env.NEXT_PUBLIC_A2A_BASE_URL || 'http://localhost:8000';

const TEST_QUERIES = [
  {
    name: 'argocd-version',
    query: 'show argocd version',
    description: 'ArgoCD version query - tests tool call and simple response',
  },
  {
    name: 'github-profile',
    query: 'show my github profile for sriaradhyula',
    description: 'GitHub profile query - tests external API integration',
  },
  {
    name: 'caipe-capabilities',
    query: 'what can caipe do?',
    description: 'CAIPE capabilities query - tests agent self-description',
  },
];

async function captureFixture(testQuery) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Capturing: ${testQuery.name}`);
  console.log(`Query: "${testQuery.query}"`);
  console.log(`${'='.repeat(70)}\n`);

  const transport = new JsonRpcTransport({
    endpoint: A2A_ENDPOINT,
  });

  const contextId = uuidv4();
  const messageId = uuidv4();
  const events = [];
  let eventCount = 0;

  try {
    const params = {
      message: {
        messageId,
        role: 'user',
        parts: [{ kind: 'text', text: testQuery.query }],
        contextId,
      },
    };

    const stream = transport.sendMessageStream(params);

    console.log('📥 Streaming events...\n');

    for await (const event of stream) {
      eventCount++;
      const kind = event.kind || 'unknown';

      // Store full event
      events.push({
        eventNumber: eventCount,
        timestamp: new Date().toISOString(),
        kind,
        event,
      });

      // Log progress
      if (kind === 'artifact-update') {
        const artifactName = event.artifact?.name || 'unknown';
        console.log(`  #${eventCount}: ${kind} - ${artifactName}`);
      } else if (kind === 'status-update') {
        const state = event.status?.state || 'unknown';
        console.log(`  #${eventCount}: ${kind} - ${state} (final: ${event.final})`);
      } else {
        console.log(`  #${eventCount}: ${kind}`);
      }

      // Stop at completion
      if (kind === 'status-update' && event.final === true) {
        console.log('\n✅ Stream complete (final status received)');
        break;
      }
    }

    // Save to fixtures directory
    const fixturesDir = path.join(__dirname, 'src', '__fixtures__', 'a2a-streams');
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    const fixture = {
      metadata: {
        name: testQuery.name,
        description: testQuery.description,
        query: testQuery.query,
        capturedAt: new Date().toISOString(),
        endpoint: A2A_ENDPOINT,
        contextId,
        messageId,
        totalEvents: eventCount,
      },
      events,
      summary: {
        eventsByKind: events.reduce((acc, { event }) => {
          const kind = event.kind || 'unknown';
          acc[kind] = (acc[kind] || 0) + 1;
          return acc;
        }, {}),
        artifactTypes: events
          .filter(({ event }) => event.kind === 'artifact-update')
          .map(({ event }) => event.artifact?.name)
          .filter((name, idx, arr) => arr.indexOf(name) === idx),
        finalStatus: events
          .filter(({ event }) => event.kind === 'status-update' && event.final)
          .map(({ event }) => event.status?.state)[0] || 'unknown',
      },
    };

    const fixturePath = path.join(fixturesDir, `${testQuery.name}.json`);
    fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

    console.log(`\n✅ Saved fixture: ${fixturePath}`);
    console.log(`   Events: ${eventCount}`);
    console.log(`   Artifacts: ${fixture.summary.artifactTypes.join(', ')}`);
    console.log(`   Final Status: ${fixture.summary.finalStatus}`);

    return fixture;
  } catch (error) {
    console.error(`\n❌ Error capturing ${testQuery.name}:`, error.message);
    return null;
  }
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`A2A Fixture Capture Script`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Endpoint: ${A2A_ENDPOINT}`);
  console.log(`Queries: ${TEST_QUERIES.length}`);
  console.log(`${'='.repeat(70)}`);

  const results = [];

  for (const query of TEST_QUERIES) {
    const result = await captureFixture(query);
    if (result) {
      results.push(result);
    }

    // Wait a bit between queries
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Capture Complete`);
  console.log(`${'='.repeat(70)}`);
  console.log(`Captured: ${results.length}/${TEST_QUERIES.length} fixtures`);
  console.log(`Location: src/__fixtures__/a2a-streams/`);
  console.log(`${'='.repeat(70)}\n`);

  if (results.length < TEST_QUERIES.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
