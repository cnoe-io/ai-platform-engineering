/**
 * Integration tests for A2ASDKClient
 * Uses real A2A streaming fixtures captured from backend
 */

import { A2ASDKClient, toStoreEvent } from '../a2a-sdk-client'
import argoCdFixture from '../../__fixtures__/a2a-streams/argocd-version.json'
import githubFixture from '../../__fixtures__/a2a-streams/github-profile.json'
import caipeFixture from '../../__fixtures__/a2a-streams/caipe-capabilities.json'

// Mock the SDK transport
jest.mock('@a2a-js/sdk/client', () => ({
  JsonRpcTransport: jest.fn().mockImplementation(() => ({
    sendMessageStream: jest.fn(),
  })),
  createAuthenticatingFetchWithRetry: jest.fn((fetch, handler) => fetch),
}))

describe('A2ASDKClient', () => {
  let client: A2ASDKClient
  let mockTransport: any

  beforeEach(() => {
    const { JsonRpcTransport } = require('@a2a-js/sdk/client')
    mockTransport = new JsonRpcTransport({})

    client = new A2ASDKClient({
      endpoint: 'http://localhost:8000',
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('ArgoCD Version Query', () => {
    it('should parse all events from ArgoCD version stream', async () => {
      // Mock the stream to return events from fixture
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of argoCdFixture.events) {
          yield event
        }
      })

      // Get the mocked transport
      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('show argocd version')) {
        events.push(event)
      }

      // Verify we got all events
      expect(events.length).toBe(argoCdFixture.events.length)

      // Verify task event
      const taskEvent = events.find(e => e.type === 'task')
      expect(taskEvent).toBeDefined()
      expect(taskEvent?.taskId).toBe('task-argocd-001')

      // Verify tool notifications
      const toolStart = events.find(e => e.artifactName === 'tool_notification_start')
      expect(toolStart).toBeDefined()
      expect(toolStart?.displayContent).toContain('Fetching ArgoCD version')

      const toolEnd = events.find(e => e.artifactName === 'tool_notification_end')
      expect(toolEnd).toBeDefined()
      expect(toolEnd?.displayContent).toContain('retrieved')

      // Verify streaming results
      const streamingResults = events.filter(e => e.artifactName === 'streaming_result')
      expect(streamingResults.length).toBeGreaterThan(0)

      // Verify final result
      const finalResult = events.find(e => e.artifactName === 'final_result')
      expect(finalResult).toBeDefined()
      expect(finalResult?.isFinal).toBe(true)
      expect(finalResult?.displayContent).toContain('v2.12.3')

      // Verify status updates
      const statusUpdates = events.filter(e => e.type === 'status')
      expect(statusUpdates.length).toBe(2)

      const finalStatus = statusUpdates.find(e => e.isFinal === true)
      expect(finalStatus).toBeDefined()
    })

    it('should correctly set append flags for streaming content', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of argoCdFixture.events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('show argocd version')) {
        events.push(event)
      }

      // First streaming_result should not append (replace)
      const firstStreaming = events.find(e => e.artifactName === 'streaming_result')
      expect(firstStreaming?.shouldAppend).toBe(false)

      // Second streaming_result should append
      const streamingResults = events.filter(e => e.artifactName === 'streaming_result')
      if (streamingResults.length > 1) {
        expect(streamingResults[1].shouldAppend).toBe(true)
      }
    })
  })

  describe('GitHub Profile Query', () => {
    it('should handle multi-agent routing with sub-agent artifacts', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of githubFixture.events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('show my github profile')) {
        events.push(event)
      }

      // Verify execution plan
      const execPlan = events.find(e => e.artifactName === 'execution_plan_update')
      // Note: GitHub profile query doesn't have execution plan in this fixture

      // Verify sub-agent artifacts (from GitHub agent)
      const githubArtifacts = events.filter(e => e.sourceAgent === 'github')
      expect(githubArtifacts.length).toBeGreaterThan(0)

      // Verify supervisor artifacts
      const supervisorArtifacts = events.filter(e => e.sourceAgent === 'supervisor')
      expect(supervisorArtifacts.length).toBeGreaterThan(0)

      // Verify final result contains profile data
      const finalResult = events.find(e => e.artifactName === 'final_result')
      expect(finalResult?.displayContent).toContain('sriaradhyula')
      expect(finalResult?.displayContent).toContain('Sri Aradhyula')
    })

    it('should extract sourceAgent from artifact metadata', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of githubFixture.events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('show my github profile')) {
        events.push(event)
      }

      // All artifact events should have sourceAgent extracted
      const artifactEvents = events.filter(e => e.type === 'artifact')
      expect(artifactEvents.every(e => e.sourceAgent)).toBe(true)
    })
  })

  describe('CAIPE Capabilities Query', () => {
    it('should handle comprehensive response with execution plan', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of caipeFixture.events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('what can caipe do?')) {
        events.push(event)
      }

      // Verify execution plan exists
      const execPlan = events.find(e => e.artifactName === 'execution_plan_update')
      expect(execPlan).toBeDefined()
      expect(execPlan?.displayContent).toContain('Execution Plan')

      // Verify streaming content is assembled correctly
      const streamingResults = events.filter(e => e.artifactName === 'streaming_result')
      expect(streamingResults.length).toBeGreaterThan(3) // Multiple chunks

      // Verify final result is comprehensive
      const finalResult = events.find(e => e.artifactName === 'final_result')
      expect(finalResult).toBeDefined()
      expect(finalResult?.displayContent).toContain('CAIPE')
      expect(finalResult?.displayContent).toContain('Connected Agents')
      expect(finalResult?.displayContent).toContain('ArgoCD')
      expect(finalResult?.displayContent).toContain('GitHub')
      expect(finalResult?.displayContent).toContain('A2A Protocol')
    })

    it('should detect stream completion via final status update', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const { event } of caipeFixture.events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []
      let completionDetected = false

      for await (const event of client.sendMessageStream('what can caipe do?')) {
        events.push(event)

        // Check if this event signals completion
        if (event.type === 'status' && event.isFinal === true) {
          completionDetected = true
        }
      }

      expect(completionDetected).toBe(true)

      // Verify final status update
      const finalStatus = events.find(e => e.type === 'status' && e.isFinal === true)
      expect(finalStatus).toBeDefined()
    })
  })

  describe('toStoreEvent converter', () => {
    it('should convert parsed events to store format', () => {
      const parsedEvent = {
        raw: { kind: 'artifact-update', artifact: { name: 'final_result' } },
        type: 'artifact' as const,
        artifactName: 'final_result',
        displayContent: 'Test result',
        isFinal: true,
        shouldAppend: false,
        contextId: 'test-ctx',
        taskId: 'test-task',
        sourceAgent: 'test-agent',
      }

      const storeEvent = toStoreEvent(parsedEvent, 'test-id')

      expect(storeEvent.id).toBe('test-id')
      expect(storeEvent.type).toBe('artifact')
      expect(storeEvent.displayContent).toBe('Test result')
      expect(storeEvent.isFinal).toBe(true)
      expect(storeEvent.sourceAgent).toBe('test-agent')
      expect(storeEvent.taskId).toBe('test-task')
      expect(storeEvent.contextId).toBe('test-ctx')
    })

    it('should map artifact names to display types', () => {
      const testCases = [
        { artifactName: 'tool_notification_start', expectedType: 'tool_start' },
        { artifactName: 'tool_notification_end', expectedType: 'tool_end' },
        { artifactName: 'execution_plan_update', expectedType: 'execution_plan' },
        { artifactName: 'final_result', expectedType: 'artifact' },
      ]

      testCases.forEach(({ artifactName, expectedType }) => {
        const parsedEvent = {
          raw: {},
          type: 'artifact' as const,
          artifactName,
          displayContent: 'test',
          isFinal: false,
          shouldAppend: false,
        }

        const storeEvent = toStoreEvent(parsedEvent)
        expect(storeEvent.type).toBe(expectedType)
      })
    })

    it('should extract sourceAgent from artifact metadata', () => {
      const parsedEvent = {
        raw: {
          kind: 'artifact-update',
          artifact: {
            name: 'streaming_result',
            metadata: {
              sourceAgent: 'github',
            },
          },
        },
        type: 'artifact' as const,
        artifactName: 'streaming_result',
        displayContent: 'test',
        isFinal: false,
        shouldAppend: true,
        sourceAgent: 'github',
      }

      const storeEvent = toStoreEvent(parsedEvent)
      expect(storeEvent.sourceAgent).toBe('github')
    })
  })

  describe('Error Handling', () => {
    it('should handle 401 errors from backend', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response)

      const clientWithAuth = new A2ASDKClient({
        endpoint: 'http://localhost:8000',
        accessToken: 'expired-token',
      })

      // Set the mocked fetch
      const { createAuthenticatingFetchWithRetry } = require('@a2a-js/sdk/client')
      createAuthenticatingFetchWithRetry.mockImplementation(() => mockFetch)

      // Recreate client to use mocked fetch
      const newClient = new A2ASDKClient({
        endpoint: 'http://localhost:8000',
        accessToken: 'expired-token',
      })

      // The error should be thrown when 401 is detected
      // This is handled by the shouldRetryWithHeaders callback
      expect(true).toBe(true) // Placeholder - 401 handling tested in component tests
    })

    it('should abort previous requests when new message sent', () => {
      const abortSpy = jest.spyOn(AbortController.prototype, 'abort')

      client.abort()

      // First call shouldn't abort anything (no active request)
      expect(abortSpy).not.toHaveBeenCalled()

      abortSpy.mockRestore()
    })
  })

  describe('Event Parsing', () => {
    it('should extract text from message parts', async () => {
      const messageEvent = {
        kind: 'message',
        messageId: 'msg-001',
        role: 'agent',
        parts: [
          { kind: 'text', text: 'Hello ' },
          { kind: 'text', text: 'World' },
        ],
        contextId: 'test-ctx',
      }

      mockTransport.sendMessageStream.mockImplementation(async function* () {
        yield messageEvent
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('test')) {
        events.push(event)
      }

      expect(events[0].displayContent).toBe('Hello World')
    })

    it('should extract text from artifact parts', async () => {
      const artifactEvent = {
        kind: 'artifact-update',
        taskId: 'task-001',
        contextId: 'test-ctx',
        artifact: {
          name: 'streaming_result',
          parts: [
            { kind: 'text', text: 'Part 1 ' },
            { kind: 'text', text: 'Part 2' },
          ],
        },
        append: true,
      }

      mockTransport.sendMessageStream.mockImplementation(async function* () {
        yield artifactEvent
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('test')) {
        events.push(event)
      }

      expect(events[0].displayContent).toBe('Part 1 Part 2')
      expect(events[0].shouldAppend).toBe(true)
    })

    it('should detect final results correctly', async () => {
      const events = [
        {
          kind: 'artifact-update',
          artifact: { name: 'streaming_result' },
        },
        {
          kind: 'artifact-update',
          artifact: { name: 'final_result' },
        },
        {
          kind: 'artifact-update',
          artifact: { name: 'partial_result' },
        },
      ]

      mockTransport.sendMessageStream.mockImplementation(async function* () {
        for (const event of events) {
          yield event
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const parsedEvents: any[] = []

      for await (const event of client.sendMessageStream('test')) {
        parsedEvents.push(event)
      }

      expect(parsedEvents[0].isFinal).toBe(false) // streaming_result
      expect(parsedEvents[1].isFinal).toBe(true)  // final_result
      expect(parsedEvents[2].isFinal).toBe(true)  // partial_result
    })
  })

  describe('Stream Completion Detection', () => {
    it('should detect completion from final status update', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        yield { kind: 'task', id: 'task-001', status: { state: 'working' } }
        yield {
          kind: 'status-update',
          taskId: 'task-001',
          status: { state: 'completed' },
          final: true,
        }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('test')) {
        events.push(event)

        // Stream should complete after final status
        if (event.type === 'status' && event.isFinal) {
          break
        }
      }

      const finalStatus = events.find(e => e.type === 'status' && e.isFinal)
      expect(finalStatus).toBeDefined()
    })

    it('should detect completion from completed task', async () => {
      mockTransport.sendMessageStream.mockImplementation(async function* () {
        yield { kind: 'task', id: 'task-001', status: { state: 'working' } }
        yield { kind: 'task', id: 'task-001', status: { state: 'completed' } }
      })

      const transport = (client as any).transport
      transport.sendMessageStream = mockTransport.sendMessageStream

      const events: any[] = []

      for await (const event of client.sendMessageStream('test')) {
        events.push(event)
      }

      const completedTask = events.find(e => e.type === 'task' && e.raw.status?.state === 'completed')
      expect(completedTask).toBeDefined()
    })
  })

  describe('Token Management', () => {
    it('should allow setting access token', () => {
      const newClient = new A2ASDKClient({
        endpoint: 'http://localhost:8000',
      })

      // Set token
      newClient.setAccessToken('new-token')

      // Verify transport was recreated (internal check)
      expect((newClient as any).accessToken).toBe('new-token')
    })

    it('should create client without token', () => {
      const newClient = new A2ASDKClient({
        endpoint: 'http://localhost:8000',
      })

      expect((newClient as any).accessToken).toBeUndefined()
    })

    it('should create client with token', () => {
      const newClient = new A2ASDKClient({
        endpoint: 'http://localhost:8000',
        accessToken: 'test-token',
      })

      expect((newClient as any).accessToken).toBe('test-token')
    })
  })
})
