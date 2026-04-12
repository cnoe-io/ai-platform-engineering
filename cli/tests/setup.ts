// Global test setup for caipe-cli test suite.
// Bun's built-in test runner picks this up via bunfig.toml preload.

import { mock } from "bun:test";

// Stub keytar so tests don't touch the real OS keychain.
// keytar is a CommonJS module imported with `import keytar from "keytar"`,
// so the mock must expose a `default` export matching the API.
// The stub is stateful so storeTokens / loadTokens round-trips work.
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

mock.module("keytar", () => ({
  default: keytarStub,
  ...keytarStub,
}));

// Expose store reset for tests that need a clean keychain state
export function resetKeychain(): void {
  keychainStore.clear();
}
