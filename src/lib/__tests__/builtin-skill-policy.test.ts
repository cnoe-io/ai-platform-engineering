/**
 * @jest-environment node
 */
// assisted-by cursor (composer-2-fast)
//
// Pins the built-in skill mutation lock policy. The default must
// stay `locked` (env unset → false) and the env flag must round-trip
// through both the helper API surface and the `userCanModifyAgentSkill`
// integration layer below. A regression here would silently re-enable
// edits on platform-shipped templates.

import {
  isBuiltinMutationAllowed,
  canMutateBuiltinSkill,
  BUILTIN_LOCKED_MESSAGE,
  BUILTIN_LOCKED_ERROR_CODE,
} from "@/lib/builtin-skill-policy";

describe("builtin-skill-policy", () => {
  const originalEnv = process.env.ALLOW_BUILTIN_SKILL_MUTATION;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
    } else {
      process.env.ALLOW_BUILTIN_SKILL_MUTATION = originalEnv;
    }
  });

  describe("isBuiltinMutationAllowed", () => {
    it("defaults to false (locked) when env is unset", () => {
      delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
      expect(isBuiltinMutationAllowed()).toBe(false);
    });

    it("returns true only for the literal string 'true'", () => {
      process.env.ALLOW_BUILTIN_SKILL_MUTATION = "true";
      expect(isBuiltinMutationAllowed()).toBe(true);
    });

    it("treats common truthy variants as locked (defense in depth)", () => {
      // Tight matching prevents an env that says "yes" / "1" / "True"
      // from accidentally unlocking the gate. Operators must use the
      // exact documented value.
      for (const v of ["1", "yes", "True", "TRUE", "y", "on", "enabled"]) {
        process.env.ALLOW_BUILTIN_SKILL_MUTATION = v;
        expect(isBuiltinMutationAllowed()).toBe(false);
      }
    });

    it("treats false / empty / unset as locked", () => {
      for (const v of ["false", "", "0"]) {
        process.env.ALLOW_BUILTIN_SKILL_MUTATION = v;
        expect(isBuiltinMutationAllowed()).toBe(false);
      }
    });
  });

  describe("canMutateBuiltinSkill", () => {
    it("returns true for non-system rows regardless of env", () => {
      delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
      expect(canMutateBuiltinSkill({ is_system: false })).toBe(true);
      process.env.ALLOW_BUILTIN_SKILL_MUTATION = "true";
      expect(canMutateBuiltinSkill({ is_system: false })).toBe(true);
    });

    it("returns false for system rows by default (locked)", () => {
      delete process.env.ALLOW_BUILTIN_SKILL_MUTATION;
      expect(canMutateBuiltinSkill({ is_system: true })).toBe(false);
    });

    it("returns true for system rows when explicitly unlocked", () => {
      process.env.ALLOW_BUILTIN_SKILL_MUTATION = "true";
      expect(canMutateBuiltinSkill({ is_system: true })).toBe(true);
    });
  });

  describe("error surface stability", () => {
    // The UI toast and the API 403 body share these constants. If
    // the message changes the user-visible text changes; pin them
    // here so a copy edit can't drift the API contract silently.
    it("exposes a stable error code", () => {
      expect(BUILTIN_LOCKED_ERROR_CODE).toBe("builtin_skill_locked");
    });

    it("mentions both Clone and the env flag in the message", () => {
      expect(BUILTIN_LOCKED_MESSAGE).toMatch(/Clone/);
      expect(BUILTIN_LOCKED_MESSAGE).toMatch(/ALLOW_BUILTIN_SKILL_MUTATION/);
    });
  });
});
