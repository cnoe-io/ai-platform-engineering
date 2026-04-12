#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "module";

// Read version from package.json at runtime
const _require = createRequire(import.meta.url);
const pkg = _require("../package.json") as { version: string };

// Suppress color when --no-color or NO_COLOR is set.
// This is done early so all downstream renderers respect it.
function applyNoColor(args: string[]): void {
  if (args.includes("--no-color") || process.env["NO_COLOR"]) {
    process.env["NO_COLOR"] = "1";
    process.env["FORCE_COLOR"] = "0";
  }
}
applyNoColor(process.argv);

const program = new Command();

program
  .name("caipe")
  .description("AI-assisted coding, workflows, and platform engineering from the terminal")
  .version(pkg.version, "-v, --version", "Print version and exit")
  .option("--agent <name>", "CAIPE server agent to use for this session", "default")
  .option("--url <url>", "Override server.url from settings.json for this invocation only")
  .option("--no-color", "Disable ANSI color output")
  .option("--json", "Machine-readable JSON output (non-interactive commands only)");

// ---------------------------------------------------------------------------
// caipe chat
// ---------------------------------------------------------------------------
const chatCmd = program
  .command("chat")
  .description("Open an interactive streaming chat session (or headless when no TTY / --headless)")
  .option("--agent <name>", "Pin session to this CAIPE server agent")
  .option("--protocol <protocol>", "Streaming protocol: a2a (default) or agui", "a2a")
  .option("--no-context", "Skip git/repo context gathering")
  .option("--resume <sessionId>", "Resume a previous session by ID")
  .option("--headless", "Force headless mode even when TTY is present")
  .option("--token <jwt>", "JWT to use directly (highest auth priority)")
  .option("--prompt <text>", "Inline prompt text (headless only)")
  .option("--prompt-file <path>", "Read prompt from file (headless only)")
  .option("--output <format>", "Headless response format: text | json | ndjson", "text")
  .option("--interactive-stdin", "Multi-turn headless mode; reads newline-delimited turns from stdin")
  .action(async (opts: Record<string, unknown>) => {
    const { runChat } = await import("./chat/runner.js");
    await runChat(opts, program.opts());
  });

void chatCmd;

// ---------------------------------------------------------------------------
// caipe auth
// ---------------------------------------------------------------------------
const authCmd = program.command("auth").description("Manage authentication");

authCmd
  .command("login")
  .description("Authenticate with the CAIPE server")
  .option("--manual", "Print auth URL only; wait for user to paste authorization code back")
  .option("--device", "Device Authorization Grant (RFC 8628): display short user code + URL, poll until approved")
  .action(async (opts: Record<string, unknown>) => {
    const { runLogin } = await import("./auth/commands.js");
    await runLogin(opts, program.opts());
  });

authCmd
  .command("logout")
  .description("Remove stored tokens from OS keychain")
  .action(async () => {
    const { runLogout } = await import("./auth/commands.js");
    await runLogout();
  });

authCmd
  .command("status")
  .description("Print current auth state")
  .option("--json", "Output JSON")
  .action(async (opts: Record<string, unknown>) => {
    const { runStatus } = await import("./auth/commands.js");
    await runStatus(opts, program.opts());
  });

// ---------------------------------------------------------------------------
// caipe config
// ---------------------------------------------------------------------------
const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set <key> <value>")
  .description("Set a configuration key")
  .action(async (key: string, value: string) => {
    const { runConfigSet } = await import("./platform/configcmd.js");
    await runConfigSet(key, value);
  });

configCmd
  .command("get <key>")
  .description("Print the current value of a configuration key")
  .option("--json", "Output JSON")
  .action(async (key: string, opts: Record<string, unknown>) => {
    const { runConfigGet } = await import("./platform/configcmd.js");
    await runConfigGet(key, opts);
  });

configCmd
  .command("unset <key>")
  .description("Remove a configuration key")
  .action(async (key: string) => {
    const { runConfigUnset } = await import("./platform/configcmd.js");
    await runConfigUnset(key);
  });

// ---------------------------------------------------------------------------
// caipe skills
// ---------------------------------------------------------------------------
const skillsCmd = program.command("skills").description("Manage the skills catalog and installed skills");

skillsCmd
  .command("list")
  .description("List available skills from catalog")
  .option("--tag <tag>", "Filter by tag")
  .option("--installed", "Show only installed skills")
  .option("--json", "Output JSON array")
  .action(async (opts: Record<string, unknown>) => {
    const { runSkillsList } = await import("./skills/commands.js");
    await runSkillsList(opts);
  });

skillsCmd
  .command("preview <name>")
  .description("Display full SKILL.md content in terminal")
  .action(async (name: string) => {
    const { runSkillsPreview } = await import("./skills/commands.js");
    await runSkillsPreview(name);
  });

skillsCmd
  .command("install <name>")
  .description("Install a skill from the catalog")
  .option("--global", "Install to ~/.config/caipe/skills/")
  .option("--target <dir>", "Override install directory")
  .option("--force", "Overwrite if already installed")
  .action(async (name: string, opts: Record<string, unknown>) => {
    const { runSkillsInstall } = await import("./skills/commands.js");
    await runSkillsInstall(name, opts);
  });

skillsCmd
  .command("update [name]")
  .description("Check and update installed skills")
  .option("--all", "Check and update all installed skills")
  .option("--dry-run", "Report available updates without applying")
  .action(async (name: string | undefined, opts: Record<string, unknown>) => {
    const { runSkillsUpdate } = await import("./skills/commands.js");
    await runSkillsUpdate(name, opts);
  });

// ---------------------------------------------------------------------------
// caipe agents
// ---------------------------------------------------------------------------
const agentsCmd = program.command("agents").description("List and inspect CAIPE server agents");

agentsCmd
  .command("list")
  .description("List available agents")
  .option("--json", "Output JSON array")
  .action(async (opts: Record<string, unknown>) => {
    const { runAgentsList } = await import("./agents/commands.js");
    await runAgentsList(opts, program.opts());
  });

agentsCmd
  .command("info <name>")
  .description("Show full capability description for a specific agent")
  .action(async (name: string) => {
    const { runAgentsInfo } = await import("./agents/commands.js");
    await runAgentsInfo(name, program.opts());
  });

// ---------------------------------------------------------------------------
// caipe memory
// ---------------------------------------------------------------------------
program
  .command("memory")
  .description("Manage memory files that provide persistent context to chat sessions")
  .option("--global", "Open global ~/.config/caipe/CLAUDE.md instead of project")
  .action(async (opts: Record<string, unknown>) => {
    const { runMemory } = await import("./memory/commands.js");
    await runMemory(opts);
  });

// ---------------------------------------------------------------------------
// caipe commit
// ---------------------------------------------------------------------------
program
  .command("commit")
  .description("DCO-compliant commit with AI attribution")
  .option("--install-hook", "Install prepare-commit-msg hook into current repo")
  .action(async (opts: Record<string, unknown>) => {
    const { runCommit } = await import("./commit/commands.js");
    await runCommit(opts);
  });

// ---------------------------------------------------------------------------
// Default action: open chat REPL when invoked with no subcommand
// ---------------------------------------------------------------------------
program.action(async () => {
  const { runChat } = await import("./chat/runner.js");
  await runChat({}, program.opts());
});

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ERROR] ${msg}\n`);
  process.exit(4);
});
