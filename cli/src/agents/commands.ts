/**
 * Command handlers for `caipe agents list` and `caipe agents info`.
 */

import { render } from "ink";
import React from "react";
import { getValidToken } from "../auth/tokens.js";
import { getAuthUrl } from "../platform/config.js";
import { AgentList } from "./List.js";
import { fetchAgents, getAgent } from "./registry.js";

interface GlobalOpts {
  url?: string;
  json?: boolean;
}

export async function runAgentsList(
  opts: { json?: boolean },
  globalOpts: GlobalOpts,
): Promise<void> {
  const authUrl = getAuthUrl(globalOpts.url);
  const agents = await fetchAgents(authUrl, () => getValidToken(authUrl));

  const useJson = opts.json ?? globalOpts.json;

  if (useJson) {
    process.stdout.write(
      `${JSON.stringify(
        agents.map((a) => ({
          name: a.name,
          displayName: a.displayName,
          domain: a.domain,
          protocols: a.protocols,
          available: a.available,
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (!process.stdout.isTTY) {
    for (const a of agents) {
      const dot = a.available ? "✓" : "✗";
      process.stdout.write(
        `${dot} ${a.name.padEnd(20)} ${a.domain.padEnd(12)} ${(a.protocols ?? ["a2a"]).join(",")}\n`,
      );
    }
    return;
  }

  render(React.createElement(AgentList, { agents }));
}

export async function runAgentsInfo(name: string, globalOpts: GlobalOpts): Promise<void> {
  const authUrl = getAuthUrl(globalOpts.url);
  const agents = await fetchAgents(authUrl, () => getValidToken(authUrl));
  const agent = getAgent(agents, name);

  if (!agent) {
    process.stderr.write(`[ERROR] Agent "${name}" not found.\n`);
    process.exit(3);
  }

  process.stdout.write(`\nAgent: ${agent.displayName}\n`);
  process.stdout.write(`  Name:        ${agent.name}\n`);
  process.stdout.write(`  Domain:      ${agent.domain}\n`);
  process.stdout.write(`  Protocols:   ${(agent.protocols ?? ["a2a"]).join(", ")}\n`);
  process.stdout.write(`  Available:   ${agent.available ? "yes" : "no"}\n`);
  process.stdout.write(`  Endpoint:    ${agent.endpoint}\n`);
  process.stdout.write(`  Description: ${agent.description}\n\n`);
}
