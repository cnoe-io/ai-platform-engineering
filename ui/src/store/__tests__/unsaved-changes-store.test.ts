/**
 * Unit tests for unsaved-changes-store.ts
 *
 * Tests:
 * - Initial state: hasUnsavedChanges is false, pendingNavigationHref is null
 * - setUnsaved(true) sets hasUnsavedChanges to true
 * - setUnsaved(false) sets hasUnsavedChanges to false
 * - requestNavigation sets pendingNavigationHref
 * - cancelNavigation clears pendingNavigationHref
 * - confirmNavigation returns href and clears both states
 */

import { act } from "@testing-library/react";
import { useUnsavedChangesStore } from "../unsaved-changes-store";

// ============================================================================
// Helpers
// ============================================================================

function resetStore() {
  useUnsavedChangesStore.setState({
    hasUnsavedChanges: false,
    pendingNavigationHref: null,
    pendingDeferredAction: null,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("unsaved-changes-store", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("initial state", () => {
    it("hasUnsavedChanges is false", () => {
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
    });

    it("pendingNavigationHref is null", () => {
      expect(useUnsavedChangesStore.getState().pendingNavigationHref).toBeNull();
    });
  });

  describe("setUnsaved", () => {
    it("setUnsaved(true) sets hasUnsavedChanges to true", () => {
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
      });
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);
    });

    it("setUnsaved(false) sets hasUnsavedChanges to false", () => {
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
      });
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(false);
      });
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
    });
  });

  describe("requestNavigation", () => {
    it("sets pendingNavigationHref", () => {
      act(() => {
        useUnsavedChangesStore.getState().requestNavigation("/task-builder");
      });
      expect(useUnsavedChangesStore.getState().pendingNavigationHref).toBe(
        "/task-builder"
      );
    });
  });

  describe("cancelNavigation", () => {
    it("clears pendingNavigationHref", () => {
      act(() => {
        useUnsavedChangesStore.getState().requestNavigation("/some-path");
      });
      act(() => {
        useUnsavedChangesStore.getState().cancelNavigation();
      });
      expect(useUnsavedChangesStore.getState().pendingNavigationHref).toBeNull();
    });
  });

  describe("confirmNavigation", () => {
    it("returns href and clears both states", () => {
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
      });
      act(() => {
        useUnsavedChangesStore.getState().requestNavigation("/target");
      });

      let href: string | null = null;
      act(() => {
        href = useUnsavedChangesStore.getState().confirmNavigation();
      });

      expect(href).toBe("/target");
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
      expect(useUnsavedChangesStore.getState().pendingNavigationHref).toBeNull();
    });

    it("returns null when no pending navigation", () => {
      let href: string | null = "unset";
      act(() => {
        href = useUnsavedChangesStore.getState().confirmNavigation();
      });
      expect(href).toBeNull();
    });
  });

  describe("requestDeferredAction", () => {
    it("runs immediately when there are no unsaved changes", () => {
      const action = jest.fn();
      act(() => {
        useUnsavedChangesStore.getState().requestDeferredAction(action);
      });
      expect(action).toHaveBeenCalledTimes(1);
      expect(useUnsavedChangesStore.getState().pendingDeferredAction).toBeNull();
    });

    it("queues the action when there are unsaved changes", () => {
      const action = jest.fn();
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
        useUnsavedChangesStore.getState().requestDeferredAction(action);
      });
      expect(action).not.toHaveBeenCalled();
      expect(useUnsavedChangesStore.getState().pendingDeferredAction).toBe(action);
    });
  });

  describe("confirmDeferredAction", () => {
    it("runs the queued action and clears dirty state", () => {
      const action = jest.fn();
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
        useUnsavedChangesStore.getState().requestDeferredAction(action);
      });
      act(() => {
        useUnsavedChangesStore.getState().confirmDeferredAction();
      });
      expect(action).toHaveBeenCalledTimes(1);
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
      expect(useUnsavedChangesStore.getState().pendingDeferredAction).toBeNull();
    });
  });

  describe("cancelNavigation", () => {
    it("clears pendingDeferredAction", () => {
      const action = jest.fn();
      act(() => {
        useUnsavedChangesStore.getState().setUnsaved(true);
        useUnsavedChangesStore.getState().requestDeferredAction(action);
        useUnsavedChangesStore.getState().cancelNavigation();
      });
      expect(useUnsavedChangesStore.getState().pendingDeferredAction).toBeNull();
      expect(action).not.toHaveBeenCalled();
    });
  });
});
