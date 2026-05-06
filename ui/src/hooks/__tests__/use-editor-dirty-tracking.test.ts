/**
 * Unit tests for useEditorDirtyTracking
 *
 * Covers:
 * - Inert when enabled=false
 * - Detects dirty when a field changes
 * - Clears dirty when value is reverted to original (FR-001 / SC-002)
 * - Object-shaped fields with undefined/empty equivalence
 * - resetSnapshot clears dirty mid-edit
 * - Unmount always clears the global flag
 */

import { renderHook, act } from "@testing-library/react";
import { useEditorDirtyTracking } from "../use-editor-dirty-tracking";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";

function resetStore() {
  useUnsavedChangesStore.setState({
    hasUnsavedChanges: false,
    pendingNavigationHref: null,
  });
}

interface FormShape {
  name: string;
  description: string;
  tags: string[];
  meta?: Record<string, unknown>;
}

describe("useEditorDirtyTracking", () => {
  beforeEach(() => {
    resetStore();
  });

  it("is inert when enabled=false (store stays clean even after value changes)", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: false,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    expect(result.current.dirty).toBe(false);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);

    values = { ...values, name: "b" };
    rerender({ vals: values });

    expect(result.current.dirty).toBe(false);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("stays clean when values are unchanged", () => {
    const values: FormShape = { name: "a", description: "", tags: [] };

    const { result } = renderHook(() =>
      useEditorDirtyTracking({
        enabled: true,
        currentValues: values,
        snapshotKey: "k1",
      })
    );

    expect(result.current.dirty).toBe(false);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("becomes dirty when a string field changes", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    values = { ...values, name: "b" };
    rerender({ vals: values });

    expect(result.current.dirty).toBe(true);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);
  });

  it("clears dirty when value is reverted to original (revert-to-clean)", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    // dirty
    values = { ...values, name: "b" };
    rerender({ vals: values });
    expect(result.current.dirty).toBe(true);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);

    // revert
    values = { ...values, name: "a" };
    rerender({ vals: values });

    expect(result.current.dirty).toBe(false);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("treats undefined object field as equal to its missing counterpart", () => {
    // Snapshot has meta=undefined; later render passes meta omitted (still undefined).
    // Both should canonicalize the same way and not flip dirty.
    let values: FormShape = {
      name: "a",
      description: "",
      tags: [],
      meta: undefined,
    };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    expect(result.current.dirty).toBe(false);

    values = { name: "a", description: "", tags: [] }; // meta omitted
    rerender({ vals: values });

    expect(result.current.dirty).toBe(false);
  });

  it("treats array field with same contents as equal", () => {
    let values: FormShape = {
      name: "a",
      description: "",
      tags: ["x", "y"],
    };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    expect(result.current.dirty).toBe(false);

    // New array reference, same contents
    values = { ...values, tags: ["x", "y"] };
    rerender({ vals: values });
    expect(result.current.dirty).toBe(false);

    // Different content
    values = { ...values, tags: ["x", "z"] };
    rerender({ vals: values });
    expect(result.current.dirty).toBe(true);
  });

  it("re-snapshots when snapshotKey changes", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { result, rerender } = renderHook(
      ({ vals, key }: { vals: FormShape; key: string }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: key,
        }),
      { initialProps: { vals: values, key: "k1" } }
    );

    values = { ...values, name: "b" };
    rerender({ vals: values, key: "k1" });
    expect(result.current.dirty).toBe(true);

    // New key + new "current" values become the new snapshot
    rerender({ vals: values, key: "k2" });
    expect(result.current.dirty).toBe(false);
  });

  it("resetSnapshot clears dirty even after edits", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { result, rerender } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    values = { ...values, name: "b" };
    rerender({ vals: values });
    expect(result.current.dirty).toBe(true);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);

    act(() => {
      result.current.resetSnapshot();
    });

    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);

    // After reset, current values are the new snapshot — still clean on next render.
    rerender({ vals: values });
    expect(result.current.dirty).toBe(false);
  });

  it("unmount clears the global flag even when dirty was true", () => {
    let values: FormShape = { name: "a", description: "", tags: [] };

    const { rerender, unmount } = renderHook(
      ({ vals }: { vals: FormShape }) =>
        useEditorDirtyTracking({
          enabled: true,
          currentValues: vals,
          snapshotKey: "k1",
        }),
      { initialProps: { vals: values } }
    );

    values = { ...values, name: "b" };
    rerender({ vals: values });
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);

    unmount();

    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
  });
});
