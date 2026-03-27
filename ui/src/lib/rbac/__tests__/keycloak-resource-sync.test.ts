/**
 * @jest-environment node
 */

import type { Mock } from 'jest-mock';

const mockGetKeycloakAdminToken = jest.fn();

jest.mock('@/lib/rbac/keycloak-admin', () => ({
  getKeycloakAdminToken: () => mockGetKeycloakAdminToken(),
}));

describe('keycloak-resource-sync', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockGetKeycloakAdminToken.mockReset();
    process.env = { ...originalEnv };
    (global.fetch as unknown as Mock) = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('syncTaskResource resolves when KEYCLOAK_URL is unset', async () => {
    delete process.env.KEYCLOAK_URL;
    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await expect(
      syncTaskResource('create', 'task-1', 'My Task', 'team')
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('syncTaskResource POSTs resource on create when Keycloak responds OK', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    process.env.KEYCLOAK_REALM = 'caipe';
    process.env.KEYCLOAK_RESOURCE_SERVER_ID = 'caipe-platform';
    mockGetKeycloakAdminToken.mockResolvedValue('admin-token');

    const clientUuid = 'client-uuid-1';
    (global.fetch as unknown as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: clientUuid }],
      })
      .mockResolvedValueOnce({ ok: true, status: 201, text: async () => '' });

    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await syncTaskResource('create', 'tid', 'Task Name', 'global');

    expect(mockGetKeycloakAdminToken).toHaveBeenCalled();
    const posts = (global.fetch as unknown as Mock).mock.calls.filter(
      (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === 'POST'
    );
    expect(posts.length).toBe(1);
    const [, init] = posts[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer admin-token');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('task:tid');
    expect(body.type).toBe('caipe:task');
    expect(body.attributes.task_id).toEqual(['tid']);
  });

  it('syncSkillResource treats 409 as success', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    mockGetKeycloakAdminToken.mockResolvedValue('t');
    (global.fetch as unknown as Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'cu' }],
      })
      .mockResolvedValueOnce({ ok: false, status: 409, text: async () => '' });

    const { syncSkillResource } = await import('../keycloak-resource-sync');
    await expect(
      syncSkillResource('create', 's1', 'Skill', 'team')
    ).resolves.toBeUndefined();
  });
});
