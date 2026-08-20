/** Server-side smoke test used by every model-config write path. */

export type ModelCheckResult = { ok: true } | { ok: false; error: string };

export async function testTomeModel(model: string): Promise<ModelCheckResult> {
  const agentUrl = process.env.TOME_AGENT_URL;
  if (!agentUrl) return { ok: false, error: "TOME_AGENT_URL not configured" };

  try {
    const response = await fetch(`${agentUrl.replace(/\/$/, "")}/model-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model.trim() }),
      cache: "no-store",
    });
    const result = (await response.json().catch(() => null)) as ModelCheckResult | null;
    if (!response.ok || !result) {
      return { ok: false, error: `agent /model-check failed (${response.status})` };
    }
    return result.ok
      ? { ok: true }
      : { ok: false, error: "error" in result ? result.error : "Model test failed" };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to reach the Tome agent",
    };
  }
}
