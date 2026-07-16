"use client";

import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";
import { useCallback,useEffect,useRef,useState } from "react";

/**
 * Canonical-JSON equality. Sorts top-level keys so that key order does not
 * cause false positives. Sufficient for editor form values where the shape
 * is small (≤ a few KB) and fully serializable.
 */
function defaultEquals<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  return canonicalStringify(a) === canonicalStringify(b);
}

function canonicalStringify(value: unknown): string {
  // Note: we deliberately do NOT remap undefined to null. JSON.stringify
  // already omits undefined object values at the top level, which is the
  // semantics we want: `{a: 1, b: undefined}` and `{a: 1}` should compare
  // equal. For arrays, JSON.stringify already converts undefined to null,
  // preserving array length.
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

interface UseEditorDirtyTrackingArgs<T extends object> {
  /** When false, the hook is inert and never marks the store dirty. */
  enabled: boolean;
  /** The current form values being tracked. */
  currentValues: T;
  /**
   * Stable identifier for the snapshot. When this changes, the snapshot is
   * re-taken from the latest currentValues. Use this to handle async-loaded
   * defaults (e.g. include a sentinel that flips once defaults are applied).
   */
  snapshotKey: string;
  /** Optional custom equality. Defaults to canonical-JSON of sorted keys. */
  equals?: (a: T, b: T) => boolean;
}

interface UseEditorDirtyTrackingResult {
  dirty: boolean;
  /** Re-snapshot now and clear the global dirty flag. */
  resetSnapshot: () => void;
}

/**
 * Tracks whether currentValues differs from a snapshot taken on mount, and
 * mirrors the result into the global useUnsavedChangesStore.
 *
 * Lifecycle:
 * - Mount: snapshot = currentValues; flag = false.
 * - Render: dirty = !equals(snapshot, currentValues); writes to the store
 *   only when the value changes.
 * - snapshotKey changes: snapshot is re-taken from latest currentValues.
 * - Unmount: always clears the global flag (setUnsaved(false)) so the flag
 *   never leaks to other pages.
 *
 * When enabled=false, the hook does not write to the store except for the
 * unmount-time setUnsaved(false), which is safe because it only flips an
 * already-false flag back to false.
 */
export function useEditorDirtyTracking<T extends object>(
  args: UseEditorDirtyTrackingArgs<T>
): UseEditorDirtyTrackingResult {
  const { enabled, currentValues, snapshotKey, equals = defaultEquals } = args;

  // Track snapshot as state keyed by snapshotKey. When snapshotKey changes,
  // we re-snapshot synchronously via the useState initializer on re-key.
  // Using `key` prop on the consuming component to reset this hook on
  // snapshotKey changes is not always feasible, so we track the active
  // snapshotKey alongside the snapshot value and update in an effect.
  const [snapshotState, setSnapshotState] = useState<{
    key: string;
    values: T;
  }>(() => ({ key: snapshotKey, values: currentValues }));

  // When snapshotKey changes, re-snapshot in an effect. This lags by one
  // render (dirty will briefly be true on the first render after a key change)
  // but avoids reading refs during render.
  useEffect(() => {
    if (snapshotState.key !== snapshotKey) {

      setSnapshotState({ key: snapshotKey, values: currentValues });
    }
    // currentValues intentionally omitted: we only re-snapshot on key change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotKey]);

  const snapshot = snapshotState.key === snapshotKey ? snapshotState.values : currentValues;
  const dirty = enabled ? !equals(snapshot, currentValues) : false;

  const lastWrittenDirtyRef = useRef<boolean>(false);

  // Mirror dirty into the global store, but only when it actually changed.
  // The store's setUnsaved already short-circuits no-op writes via Zustand,
  // but checking here also avoids unnecessary effect re-runs in consumers.
  useEffect(() => {
    if (!enabled) return;
    if (lastWrittenDirtyRef.current === dirty) return;
    lastWrittenDirtyRef.current = dirty;
    useUnsavedChangesStore.getState().setUnsaved(dirty);
  }, [dirty, enabled]);

  // Unmount cleanup: always clear the global flag. Putting this in its own
  // effect with [] deps guarantees it runs exactly on unmount.
  useEffect(() => {
    return () => {
      useUnsavedChangesStore.getState().setUnsaved(false);
    };
  }, []);

  const resetSnapshot = useCallback(() => {
    setSnapshotState({ key: snapshotKey, values: currentValues });
    lastWrittenDirtyRef.current = false;
    useUnsavedChangesStore.getState().setUnsaved(false);
  }, [snapshotKey, currentValues]);

  return { dirty, resetSnapshot };
}
