// Global test setup for caipe-cli test suite.
// Bun's built-in test runner picks this up via bunfig.toml preload.

import { mock } from "bun:test";

// Stub keytar so tests don't touch the real OS keychain.
mock.module("keytar", () => ({
  getPassword: async () => null,
  setPassword: async () => {},
  deletePassword: async () => false,
  findCredentials: async () => [],
}));
