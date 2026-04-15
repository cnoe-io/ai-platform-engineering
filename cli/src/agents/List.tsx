/**
 * Ink agent list component (T034).
 */

import { Box, Text } from "ink";
import type React from "react";
import { statusDot } from "../platform/display.js";
import type { Agent } from "./types.js";

interface AgentListProps {
  agents: Agent[];
}

export function AgentList({ agents }: AgentListProps): React.ReactElement {
  if (agents.length === 0) {
    return (
      <Box>
        <Text dimColor>No agents available.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        <Text bold color="cyan">
          {"Name".padEnd(20)}
        </Text>
        <Text bold color="cyan">
          {"Domain".padEnd(14)}
        </Text>
        <Text bold color="cyan">
          {"Protocols".padEnd(16)}
        </Text>
        <Text bold color="cyan">
          Status
        </Text>
      </Box>
      <Box>
        <Text dimColor>{"─".repeat(60)}</Text>
      </Box>

      {agents.map((agent) => (
        <Box key={agent.name}>
          <Text>{agent.name.padEnd(20)}</Text>
          <Text dimColor>{agent.domain.padEnd(14)}</Text>
          <Text dimColor>{(agent.protocols ?? ["a2a"]).join(", ").padEnd(16)}</Text>
          <Text>{statusDot(agent.available)}</Text>
          <Text dimColor> {agent.displayName}</Text>
        </Box>
      ))}
    </Box>
  );
}
