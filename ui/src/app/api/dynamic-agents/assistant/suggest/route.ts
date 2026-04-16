/**
 * API route for AI-assisted suggestions in the Custom Agent Builder.
 *
 * Receives a field-specific request from the editor, constructs the
 * appropriate system prompt and user message, then forwards to the
 * dynamic-agents backend generic /api/v1/assistant/suggest endpoint.
 *
 * Prompt templates live here (server-side) — the backend is a generic
 * LLM proxy with no knowledge of agent fields.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  withAuth,
  withErrorHandler,
  successResponse,
  ApiError,
} from "@/lib/api-middleware";
import { authenticateRequest } from "@/app/api/v1/chat/_helpers";
import { gradientThemes } from "@/lib/gradient-themes";

const DYNAMIC_AGENTS_URL =
  process.env.DYNAMIC_AGENTS_URL || "http://localhost:8100";

type SuggestField = "description" | "system_prompt" | "theme";

interface SuggestFieldRequest {
  field: SuggestField;
  context: {
    name: string;
    description?: string;
    system_prompt?: string;
    allowed_tools?: Record<string, string[]>;
    builtin_tools?: Record<string, unknown>;
    subagents?: Array<{
      agent_id: string;
      name: string;
      description?: string;
    }>;
  };
  model_id: string;
  model_provider: string;
  instruction?: string;
  prompt_style?: "concise" | "comprehensive";
}

/**
 * Build a human-readable summary of the agent's tools and subagents
 * for inclusion in prompts.
 */
function buildToolsContext(context: SuggestFieldRequest["context"]): string {
  const parts: string[] = [];

  // MCP tools
  if (context.allowed_tools && Object.keys(context.allowed_tools).length > 0) {
    const serverNames = Object.keys(context.allowed_tools);
    parts.push(`It has access to these MCP tool servers: ${serverNames.join(", ")}.`);
  }

  // Builtin tools
  if (context.builtin_tools && Object.keys(context.builtin_tools).length > 0) {
    const toolNames = Object.keys(context.builtin_tools).filter(
      (k) => context.builtin_tools?.[k]
    );
    if (toolNames.length > 0) {
      parts.push(`It has these built-in tools enabled: ${toolNames.join(", ")}.`);
    }
  }

  // Subagents
  if (context.subagents && context.subagents.length > 0) {
    const subagentDescs = context.subagents.map((s) =>
      s.description ? `${s.name} (${s.description})` : s.name
    );
    parts.push(
      `It can delegate tasks to these subagents: ${subagentDescs.join(", ")}.`
    );
  }

  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/**
 * Build the system prompt and user message for a given field.
 */
function buildPrompts(body: SuggestFieldRequest): {
  system_prompt: string;
  user_message: string;
} {
  const { field, context, instruction } = body;
  const toolsContext = buildToolsContext(context);

  switch (field) {
    case "description": {
      return {
        system_prompt:
          "You are an AI assistant that writes concise, informative agent descriptions. " +
          "Output ONLY the description text — no quotes, no preamble, no explanation, no markdown formatting.",
        user_message:
          `Write a 1-2 sentence description for an AI agent named "${context.name}".${toolsContext} ` +
          "The description should explain what the agent does and its key capabilities.",
      };
    }

    case "system_prompt": {
      const descPart = context.description
        ? ` described as "${context.description}"`
        : "";
      const instructionPart = instruction
        ? ` Additional guidance from the user: ${instruction}`
        : "";
      const isConcise = body.prompt_style !== "comprehensive";
      return {
        system_prompt: isConcise
          ? "You are an expert AI agent designer. You create concise, focused system prompts " +
            "that define an agent's role, personality, and behavioral guidelines. " +
            "Keep the prompt short and actionable — avoid filler. " +
            "Do NOT include instructions about specific tools, MCP servers, or subagents — " +
            "those are injected separately by the platform. " +
            "Write the system prompt in markdown. Output ONLY the system " +
            "prompt content — no wrapping, no preamble, no explanation."
          : "You are an expert AI agent designer. You create comprehensive, detailed system prompts " +
            "that thoroughly define an agent's role, personality, behavioral guidelines, " +
            "reasoning approach, output format, edge-case handling, and interaction style. " +
            "Do NOT include instructions about specific tools, MCP servers, or subagents — " +
            "those are injected separately by the platform. " +
            "Write the system prompt in markdown. Output ONLY the system " +
            "prompt content — no wrapping, no preamble, no explanation.",
        user_message:
          `Create a ${isConcise ? "concise" : "comprehensive"} system prompt for an AI agent named "${context.name}"${descPart}.${instructionPart} ` +
          (isConcise
            ? "Focus on the agent's role, tone, and reasoning approach. Keep it concise."
            : "Cover the agent's role, tone, reasoning approach, output format, and behavioral guidelines in detail."),
      };
    }

    case "theme": {
      const themeList = gradientThemes
        .map((t) => `- ${t.id}: ${t.label} — ${t.description}`)
        .join("\n");
      const descPart = context.description
        ? ` described as "${context.description}"`
        : "";
      return {
        system_prompt:
          "You are a UI design assistant. You pick visual themes that best match " +
          "an agent's purpose and personality. Output ONLY the theme ID — nothing else, " +
          "no explanation, no quotes.",
        user_message:
          `Pick the most fitting visual theme for an agent named "${context.name}"${descPart}.\n\n` +
          `Available themes:\n${themeList}\n\nOutput ONLY the theme ID.`,
      };
    }

    default:
      throw new ApiError(`Unknown field: ${field}`, 400);
  }
}

/**
 * POST /api/dynamic-agents/assistant/suggest
 * AI-assisted field suggestion for the Custom Agent Builder.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  return await withAuth(request, async (req, user, session) => {
    const body: SuggestFieldRequest = await request.json();

    // Validate required fields
    if (!body.field || !body.context?.name || !body.model_id || !body.model_provider) {
      throw new ApiError(
        "Missing required fields: field, context.name, model_id, model_provider",
        400
      );
    }

    if (!["description", "system_prompt", "theme"].includes(body.field)) {
      throw new ApiError(
        `Invalid field: ${body.field}. Must be one of: description, system_prompt, theme`,
        400
      );
    }

    // Build prompts from templates
    const { system_prompt, user_message } = buildPrompts(body);

    // Forward to backend with X-User-Context auth (same as chat routes)
    const auth = await authenticateRequest(request);
    if (auth instanceof NextResponse) return auth;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (auth.userContextHeader) {
      headers["X-User-Context"] = auth.userContextHeader;
    }

    const response = await fetch(
      `${DYNAMIC_AGENTS_URL}/api/v1/assistant/suggest`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          system_prompt,
          user_message,
          model_id: body.model_id,
          model_provider: body.model_provider,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(
        data.detail || "Failed to generate suggestion",
        response.status
      );
    }

    return successResponse({
      field: body.field,
      content: data.content,
    });
  });
});
