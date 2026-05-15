/**
 * Next.js instrumentation hook.
 *
 * The register() function runs once on server startup before the server
 * handles any requests. Same semantics as FastAPI's lifespan hook.
 *
 * Used to seed config-driven agents, MCP servers, and LLM models
 * from a YAML config file into MongoDB.
 *
 * See: https://nextjs.org/docs/app/guides/instrumentation
 */

export async function register() {
  // Only run on the Node.js server runtime (not Edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { applySeedConfig } = await import("./lib/seed-config");
    await applySeedConfig();
  }
}
