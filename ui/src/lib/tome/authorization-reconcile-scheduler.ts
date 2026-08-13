import { reconcileTomeAuthorization } from "@/lib/tome/authorization-health";
import { isTomeServerEnabled } from "@/lib/tome/guard";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function intervalMs(): number {
  const configured = Number(process.env.TOME_AUTHORIZATION_RECONCILE_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= MIN_INTERVAL_MS
    ? Math.floor(configured)
    : DEFAULT_INTERVAL_MS;
}

export async function tickTomeAuthorizationReconciler(
  trigger: "startup" | "periodic" = "periodic",
): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await reconcileTomeAuthorization({ trigger, repair: true });
    console.log(
      `[TomeAuthorization] ${trigger} scan completed: status=${result.status} ` +
        `checked=${result.relationships_checked} repaired=${result.relationships_repaired}`,
    );
  } catch (error) {
    console.error("[TomeAuthorization] reconciliation failed:", error);
  } finally {
    running = false;
  }
}

export function startTomeAuthorizationReconciler(): void {
  if (timer || !isTomeServerEnabled()) return;
  const interval = intervalMs();
  console.log(`[TomeAuthorization] auto-repair started (every ${interval}ms)`);
  void tickTomeAuthorizationReconciler("startup");
  timer = setInterval(() => void tickTomeAuthorizationReconciler("periodic"), interval);
  timer.unref?.();
}

export function stopTomeAuthorizationReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  running = false;
}
