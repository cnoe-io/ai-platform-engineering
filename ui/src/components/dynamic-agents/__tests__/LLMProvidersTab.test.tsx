import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LLMProvidersTab } from "../LLMProvidersTab";

jest.mock("../LLMModelsTab", () => ({
  LLMModelsTab: () => <div data-testid="llm-models-tab">LLM models content</div>,
}));

describe("LLMProvidersTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url, init) => {
      const href = String(url);
      if (href.includes("/api/llm-models")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              items: [
                { _id: "gpt-4o", model_id: "gpt-4o", name: "GPT-4o", provider: "openai" },
                {
                  _id: "global.anthropic.claude-sonnet-4-6",
                  model_id: "global.anthropic.claude-sonnet-4-6",
                  name: "Claude Sonnet",
                  provider: "aws-bedrock",
                },
              ],
            },
          }),
        } as Response;
      }
      if (href.includes("/api/credentials/secrets") && (!init || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "secret-1",
                name: "llm:openai:api_key",
                type: "api_key",
                maskedPreview: "sk-...1234",
              },
            ],
          }),
        } as Response;
      }
      if (href.includes("/api/credentials/secrets") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { id: "secret-2", name: "llm:aws-bedrock:secret_access_key" } }),
        } as Response;
      }
      return { ok: false, json: async () => ({ error: "unexpected request" }) } as Response;
    }) as jest.Mock;
  });

  it("shows provider status cards and keeps the model list available", async () => {
    render(<LLMProvidersTab />);

    expect(await screen.findByText("LLM Providers")).toBeInTheDocument();
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("AWS Bedrock")).toBeInTheDocument();
    expect(await screen.findByText("Credential secret configured")).toBeInTheDocument();
    expect(screen.getByTestId("llm-models-tab")).toBeInTheDocument();
  });

  it("creates provider credential secrets using the shared credential store", async () => {
    const user = userEvent.setup();
    render(<LLMProvidersTab />);

    await user.click(await screen.findByRole("button", { name: /configure aws bedrock/i }));
    await user.type(screen.getByLabelText(/access key id/i), "aws-access-key-test");
    await user.type(screen.getByLabelText(/secret access key/i), "secret-value");
    await user.type(screen.getByLabelText(/region/i), "us-east-1");
    await user.click(screen.getByRole("button", { name: /save provider credentials/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/credentials/secrets",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("llm:aws-bedrock:secret_access_key"),
        }),
      );
    });
  });
});
