/**
 * Next.js instrumentation hook — runs once at server startup before any
 * requests are handled.
 *
 * Initialization order matters:
 *   1. Master key bootstrap (generates/loads key, auto-rotates if key changed)
 *   2. Config seed (models, MCP servers, agents from APP_CONFIG_PATH YAML)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeMasterSecret } = await import("./lib/secret-manager");
    await initializeMasterSecret();

    const { applySeedConfig } = await import("./lib/seed-config");
    await applySeedConfig();
  }
}
