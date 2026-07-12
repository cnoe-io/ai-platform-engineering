/**
 * @jest-environment node
 */

import type { Mock } from 'jest-mock';

const mockGetKeycloakAdminToken = jest.fn();
const mockListRebacEnforcementStatuses = jest.fn();

jest.mock('@/lib/rbac/keycloak-admin', () => ({
  getKeycloakAdminToken: () => mockGetKeycloakAdminToken(),
}));

jest.mock('@/lib/rbac/enforcement-status', () => ({
  listRebacEnforcementStatuses: () => mockListRebacEnforcementStatuses(),
}));

describe('keycloak-resource-sync', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockGetKeycloakAdminToken.mockReset();
    mockListRebacEnforcementStatuses.mockResolvedValue([]);
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

  it('syncTaskResource skips Keycloak resource creation once task is ReBAC-enforced', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    mockListRebacEnforcementStatuses.mockResolvedValue([
      { resource_type: 'task', enforcement_status: 'rebac_enforced' },
    ]);

    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await expect(syncTaskResource('create', 'tid', 'Task Name', 'global')).resolves.toBeUndefined();

    expect(mockGetKeycloakAdminToken).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('logs loudly (not as a benign not-found) when the client lookup call itself fails', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    mockGetKeycloakAdminToken.mockResolvedValue('admin-token');
    (global.fetch as unknown as Mock).mockResolvedValueOnce({ ok: false, status: 403 });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await expect(
      syncTaskResource('create', 'tid', 'Task Name', 'global')
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('403'));
    errorSpy.mockRestore();
  });

  it('logs loudly when the delete-lookup call itself fails, instead of silently skipping', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    mockGetKeycloakAdminToken.mockResolvedValue('admin-token');
    (global.fetch as unknown as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'client-uuid-1' }] })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await expect(syncTaskResource('delete', 'tid', 'Task Name')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
    errorSpy.mockRestore();
  });

  it('logs create failures as errors (not warnings) so real failures are distinguishable from 409', async () => {
    process.env.KEYCLOAK_URL = 'http://keycloak';
    mockGetKeycloakAdminToken.mockResolvedValue('admin-token');
    (global.fetch as unknown as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'client-uuid-1' }] })
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid_token' });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { syncTaskResource } = await import('../keycloak-resource-sync');
    await expect(
      syncTaskResource('create', 'tid', 'Task Name', 'global')
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('401'));
    errorSpy.mockRestore();
  });
});
