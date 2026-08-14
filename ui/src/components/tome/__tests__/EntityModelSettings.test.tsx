/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/components/ui/toast";
import { EntityModelSettings } from "../EntityModelSettings";

const fetchMock = jest.fn();
global.fetch = fetchMock;

describe("EntityModelSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ configs: [], resolved: [] }),
    });
  });

  it("keeps Custom selected and reveals an editable model id", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <EntityModelSettings slug="example-project" entityType="project" canEdit />
      </ToastProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const ingestPicker = (await screen.findAllByRole("combobox"))[0];
    await user.selectOptions(ingestPicker, "__custom__");

    expect(ingestPicker).toHaveValue("__custom__");
    const customInput = screen.getByPlaceholderText("provider/model-id");
    expect(customInput).toHaveValue("");
    await user.type(customInput, "provider/example-model");
    expect(customInput).toHaveValue("provider/example-model");
  });
});
