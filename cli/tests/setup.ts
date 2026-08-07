// Global test setup for caipe-cli test suite.
// Loaded via vitest.config.ts setupFiles before each test file.

import { vi } from "vitest";

// Stub keytar so tests using the "keychain" backend don't touch the real OS keychain.
const keychainStore = new Map<string, string>();

const keytarStub = {
  getPassword: async (service: string, account: string) =>
    keychainStore.get(`${service}:${account}`) ?? null,
  setPassword: async (service: string, account: string, password: string) => {
    keychainStore.set(`${service}:${account}`, password);
  },
  deletePassword: async (service: string, account: string) => {
    return keychainStore.delete(`${service}:${account}`);
  },
  findCredentials: async () => [] as Array<{ account: string; password: string }>,
};

vi.mock("keytar", () => ({
  default: keytarStub,
  ...keytarStub,
}));

// Expose store reset for tests that need a clean credential state
export function resetKeychain(): void {
  keychainStore.clear();
}
