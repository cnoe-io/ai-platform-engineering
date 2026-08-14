/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/components/ui/toast";
import { ModelConfigTab } from "../ModelConfigTab";

const fetchMock = jest.fn();
global.fetch = fetchMock;

describe("ModelConfigTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
  });

  it("keeps Custom selected and reveals an editable model id", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><ModelConfigTab /></ToastProvider>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(5));
    const ingestPicker = screen.getAllByRole("combobox")[1];
    await user.selectOptions(ingestPicker, "__custom__");

    expect(ingestPicker).toHaveValue("__custom__");
    const customInput = screen.getByPlaceholderText("provider/model-id");
    expect(customInput).toHaveValue("");
    await user.type(customInput, "provider/example-model");
    expect(customInput).toHaveValue("provider/example-model");
  });
});
