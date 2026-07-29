/**
 * Pure helpers for Tome's per-user BHAG order on the projects hub.
 *
 * BHAG groups can exist as labels before they are promoted to first-class
 * entities, so preferences use normalized labels instead of Mongo ids/slugs.
 */

const MAX_BHAG_ORDER = 500;

function bhagKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeBhagOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const key = bhagKey(raw);
    if (!key || key.length > 256 || /[\r\n]/.test(key) || seen.has(key)) continue;
    seen.add(key);
    order.push(key);
    if (order.length >= MAX_BHAG_ORDER) break;
  }
  return order;
}

export function applyBhagOrder<T extends { label: string }>(
  groups: readonly T[],
  order: readonly string[],
): T[] {
  const positions = new Map(order.map((label, index) => [bhagKey(label), index]));
  return groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .sort((a, b) => {
      const aPosition = positions.get(bhagKey(a.group.label));
      const bPosition = positions.get(bhagKey(b.group.label));
      if (aPosition !== undefined && bPosition !== undefined) return aPosition - bPosition;
      if (aPosition !== undefined) return -1;
      if (bPosition !== undefined) return 1;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ group }) => group);
}

export function moveBhagAround(
  order: readonly string[],
  draggedLabel: string,
  targetLabel: string,
  placement: "before" | "after" = "before",
): string[] {
  const draggedKey = bhagKey(draggedLabel);
  const targetKey = bhagKey(targetLabel);
  if (draggedKey === targetKey) return [...order];
  const next = order.map(bhagKey).filter((label) => label !== draggedKey);
  const targetIndex = next.indexOf(targetKey);
  if (targetIndex === -1) return [...next, draggedKey];
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, draggedKey);
  return next;
}
