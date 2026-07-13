import { fireEvent,render,screen } from "@testing-library/react";

import { LLMModelsTab } from "../LLMModelsTab";

const model = {
  _id: "openai/gpt-4o",
  model_id: "openai/gpt-4o",
  name: "GPT-4o",
  provider: "openai",
  description: "General-purpose model",
  config_driven: false,
};

describe("LLMModelsTab deep links", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url) => {
      const href = String(url);
      if (href === "/api/llm-models?page_size=100") {
        return {
          json: async () => ({ success: true, data: { items: [model] } }),
        } as Response;
      }
      if (href === "/api/llm-models?id=openai%2Fgpt-4o") {
        return {
          json: async () => ({ success: true, data: model }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as jest.Mock;
  });

  it("loads a directly linked model and reports when its editor closes", async () => {
    const onSelectedModelChange = jest.fn();

    render(
      <LLMModelsTab
        selectedModelId="openai/gpt-4o"
        onSelectedModelChange={onSelectedModelChange}
      />,
    );

    expect(await screen.findByText("Edit Model")).toBeInTheDocument();
    expect(screen.getByLabelText("Model ID")).toHaveValue("openai/gpt-4o");
    expect(global.fetch).toHaveBeenCalledWith("/api/llm-models?id=openai%2Fgpt-4o");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSelectedModelChange).toHaveBeenCalledWith(null);
  });

  it("reports row selection so the page can add the model ID to the URL", async () => {
    const onSelectedModelChange = jest.fn();
    render(<LLMModelsTab onSelectedModelChange={onSelectedModelChange} />);

    fireEvent.click(await screen.findByText("openai/gpt-4o"));

    expect(onSelectedModelChange).toHaveBeenCalledWith("openai/gpt-4o");
  });
});
