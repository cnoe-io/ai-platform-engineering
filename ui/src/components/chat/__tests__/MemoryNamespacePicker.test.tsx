import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MemoryNamespacePicker } from "../MemoryNamespacePicker";

describe("MemoryNamespacePicker", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("stays absent when the agent declares no namespaces", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { items: [], allow_custom: false } }),
    } as Response);

    const { container } = render(
      <MemoryNamespacePicker agentId="agent-a" onChange={jest.fn()} />,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("lets the user enter a validated custom namespace", async () => {
    const onChange = jest.fn();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { items: [], allow_custom: true } }),
    } as Response);
    const user = userEvent.setup();
    render(<MemoryNamespacePicker agentId="agent-a" onChange={onChange} />);

    const picker = await screen.findByLabelText("Memory namespace");
    await user.selectOptions(picker, "__custom");
    const input = screen.getByLabelText("Custom memory namespace");
    await user.type(input, "Pod-One");
    await user.tab();

    expect(onChange).toHaveBeenCalledWith("pod-one");
  });
});
