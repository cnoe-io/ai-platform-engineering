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
    const onDirtyChange = jest.fn();
    render(
      <ToastProvider>
        <EntityModelSettings
          slug="example-project"
          entityType="project"
          canEdit
          onDirtyChange={onDirtyChange}
        />
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
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("saves Inherit by clearing the exact override", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          configs: [{
            role: "ingest",
            model: "bedrock/example-model",
            version: 1,
            tested_at: "2026-09-04T00:00:00.000Z",
            updated_at: "2026-09-04T00:00:00.000Z",
            updated_by: "test-user@example.com",
          }],
          resolved: [{
            role: "ingest",
            model: "bedrock/example-model",
            source: "exact",
            config_version: 1,
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ config: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ configs: [], resolved: [] }) });

    render(
      <ToastProvider>
        <EntityModelSettings slug="example-project" entityType="project" canEdit />
      </ToastProvider>,
    );

    const ingestPicker = (await screen.findAllByRole("combobox"))[0];
    await user.selectOptions(ingestPicker, "");
    await user.click(screen.getAllByRole("button", { name: /Save/ })[0]);

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/tome/projects/example-project/model-config?role=ingest",
      { method: "DELETE" },
    ));
  });
});
