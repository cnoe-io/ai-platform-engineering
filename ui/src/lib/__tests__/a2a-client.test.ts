/**
 * Tests for A2AClient
 * Covers constructor, sendMessage, abort, cancelTask, getTaskStatus, getA2AClient
 * @jest-environment node
 */

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// Mock generateId for predictable IDs
jest.mock('../utils', () => ({
  generateId: jest.fn(() => 'mock-id-123'),
}));

import { A2AClient, getA2AClient } from '../a2a-client';

function createMockStream(events: string[]) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(e));
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

describe('A2AClient constructor', () => {
  it('sets endpoint and accessToken', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['']),
      headers: new Headers(),
    });

    const client = new A2AClient({
      endpoint: 'https://a2a.example.com',
      accessToken: 'token-abc',
    });
    await client.sendMessage('test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://a2a.example.com',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      })
    );
  });
});

describe('setAccessToken', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('updates internal token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    client.setAccessToken('new-token');
    await client.cancelTask('task-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer new-token');
  });
});

describe('sendMessage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends POST with JSON-RPC 2.0 format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['data: {"jsonrpc":"2.0","id":"1","result":{"kind":"task"}}\n\n']),
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost:8000' });
    const reader = await client.sendMessage('hello');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          parts: [{ text: 'hello' }],
        },
      },
    });

    reader.cancel();
  });

  it('includes message with role=user and text parts', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['']),
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    await client.sendMessage('What is 2+2?');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.message.role).toBe('user');
    expect(body.params.message.parts).toEqual([{ text: 'What is 2+2?' }]);
  });

  it('includes contextId inside message when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['']),
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    await client.sendMessage('hi', 'ctx-456');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.message.contextId).toBe('ctx-456');
  });

  it('adds Authorization header when token set', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['']),
      headers: new Headers(),
    });

    const client = new A2AClient({
      endpoint: 'http://localhost',
      accessToken: 'jwt-token-xyz',
    });
    await client.sendMessage('hi');

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-token-xyz');
  });

  it('no Authorization header when no token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: createMockStream(['']),
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    await client.sendMessage('hi');

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('handles 401 with session expired error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });

    await expect(client.sendMessage('hi')).rejects.toThrow(
      'Session expired: Your authentication token has expired'
    );
  });

  it('handles other HTTP errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });

    await expect(client.sendMessage('hi')).rejects.toThrow('A2A request failed: Internal Server Error');
  });

  it('throws on missing response body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: null,
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });

    await expect(client.sendMessage('hi')).rejects.toThrow('No response body');
  });

  it('aborts previous request before new one', async () => {
    const abortController = { abort: jest.fn(), signal: {} };
    const createController = jest.spyOn(global, 'AbortController').mockImplementation(
      () => abortController as unknown as AbortController
    );

    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        body: createMockStream(['data: {}']),
        headers: new Headers(),
      })
    );

    const client = new A2AClient({ endpoint: 'http://localhost' });
    const reader1 = await client.sendMessage('first');
    const reader2 = await client.sendMessage('second');

    expect(abortController.abort).toHaveBeenCalled();
    reader1.cancel();
    reader2.cancel();
    createController.mockRestore();
  });
});

describe('abort', () => {
  it('aborts the controller', async () => {
    const abortFn = jest.fn();
    const mockController = { abort: abortFn, signal: {} };
    jest.spyOn(global, 'AbortController').mockImplementation(
      () => mockController as unknown as AbortController
    );

    mockFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        pull() {
          return new Promise(() => {}); // Never resolves - simulates hanging stream
        },
      }),
      headers: new Headers(),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    const reader = await client.sendMessage('hi');
    client.abort();

    expect(abortFn).toHaveBeenCalled();
    reader.cancel();
    jest.restoreAllMocks();
  });

  it('sets controller to null', () => {
    const client = new A2AClient({ endpoint: 'http://localhost' });
    client.abort();
    expect(() => client.abort()).not.toThrow();
  });
});

describe('cancelTask', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends tasks/cancel RPC request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: '1', result: {} }),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    const result = await client.cancelTask('task-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('tasks/cancel');
    expect(body.params.taskId).toBe('task-123');
    expect(result).toBe(true);
  });

  it('returns true on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', result: {} }),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    expect(await client.cancelTask('task-1')).toBe(true);
  });

  it('returns false on error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    expect(await client.cancelTask('bad-task')).toBe(false);
  });

  it('returns false when result has error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', error: { message: 'Task not found' } }),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    expect(await client.cancelTask('bad-task')).toBe(false);
  });

  it('includes auth header when token set', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const client = new A2AClient({
      endpoint: 'http://localhost',
      accessToken: 'auth-token',
    });
    await client.cancelTask('task-1');

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer auth-token');
  });
});

describe('getTaskStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends tasks/get RPC request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: '1',
        result: { taskId: 'task-1', status: { state: 'working' } },
      }),
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    await client.getTaskStatus('task-1');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.method).toBe('tasks/get');
    expect(body.params.taskId).toBe('task-1');
  });

  it('returns parsed response', async () => {
    const taskResult = {
      jsonrpc: '2.0',
      result: { taskId: 'task-1', status: { state: 'completed' } },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => taskResult,
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });
    const result = await client.getTaskStatus('task-1');

    expect(result).toEqual(taskResult);
  });

  it('throws on error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const client = new A2AClient({ endpoint: 'http://localhost' });

    await expect(client.getTaskStatus('bad-task')).rejects.toThrow(
      'Failed to get task: Not Found'
    );
  });
});

describe('getA2AClient', () => {
  beforeEach(() => {
    jest.resetModules();
    delete (process.env as Record<string, string | undefined>).A2A_ENDPOINT;
  });

  it('creates new client with endpoint', () => {
    const { getA2AClient: getClient } = require('../a2a-client');
    const client = getClient('http://custom-endpoint.com');
    expect(client).toBeDefined();
    expect(typeof client.sendMessage).toBe('function');
  });

  it('returns singleton on subsequent calls', () => {
    const { getA2AClient: getClient } = require('../a2a-client');
    const client1 = getClient('http://localhost:8001');
    const client2 = getClient();
    expect(client2).toBe(client1);
  });

  it('creates new client if different endpoint', () => {
    const { getA2AClient: getClient } = require('../a2a-client');
    const client1 = getClient('http://localhost:9001');
    const client2 = getClient('http://localhost:9002');
    expect(client2).not.toBe(client1);
  });
});
