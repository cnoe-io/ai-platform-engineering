const mockFindOne = jest.fn();
const mockUpdateMany = jest.fn();
const mockInsertOne = jest.fn();

jest.mock('@/lib/mongodb', () => ({
  getCollection: jest.fn(async () => ({
    findOne: mockFindOne,
    updateMany: mockUpdateMany,
    insertOne: mockInsertOne,
  })),
}));

import {
  getActiveSkillsApiKey,
  isSkillsApiKeyActive,
  registerSkillsApiKey,
} from '../skills-api-keys';

beforeEach(() => {
  mockFindOne.mockReset();
  mockUpdateMany.mockReset();
  mockInsertOne.mockReset();
});

describe('isSkillsApiKeyActive', () => {
  it('returns true when no registry entry exists (pre-registry token)', async () => {
    mockFindOne.mockResolvedValue(null);
    expect(await isSkillsApiKeyActive('some-jti')).toBe(true);
  });

  it('returns true for an active entry', async () => {
    mockFindOne.mockResolvedValue({ status: 'active' });
    expect(await isSkillsApiKeyActive('some-jti')).toBe(true);
  });

  it('returns false for a revoked entry', async () => {
    mockFindOne.mockResolvedValue({ status: 'revoked' });
    expect(await isSkillsApiKeyActive('some-jti')).toBe(false);
  });
});

describe('getActiveSkillsApiKey', () => {
  it('returns null when the user has no active key', async () => {
    mockFindOne.mockResolvedValue(null);
    expect(await getActiveSkillsApiKey('user@test.com')).toBeNull();
  });

  it('returns metadata for the active key without the jti', async () => {
    const createdAt = new Date('2026-01-01');
    const expiresAt = new Date('2026-04-01');
    mockFindOne.mockResolvedValue({ created_at: createdAt, expires_at: expiresAt, jti: 'secret-jti' });

    const result = await getActiveSkillsApiKey('user@test.com');
    expect(result).toEqual({ created_at: createdAt, expires_at: expiresAt, label: undefined });
  });
});

describe('registerSkillsApiKey', () => {
  it('revokes existing active keys before inserting the new one', async () => {
    const createdAt = new Date('2026-01-01');
    const expiresAt = new Date('2026-04-01');

    await registerSkillsApiKey({
      userEmail: 'user@test.com',
      jti: 'new-jti',
      createdAt,
      expiresAt,
    });

    expect(mockUpdateMany).toHaveBeenCalledWith(
      { user_email: 'user@test.com', status: 'active' },
      { $set: { status: 'revoked', revoked_at: createdAt } },
    );
    expect(mockInsertOne).toHaveBeenCalledWith({
      user_email: 'user@test.com',
      jti: 'new-jti',
      label: undefined,
      created_at: createdAt,
      expires_at: expiresAt,
      status: 'active',
    });
    // Revoke-then-insert ordering matters — regenerating must not leave two active keys.
    expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockInsertOne.mock.invocationCallOrder[0],
    );
  });
});
