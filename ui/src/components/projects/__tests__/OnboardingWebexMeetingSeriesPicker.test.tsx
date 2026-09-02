import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { OnboardingWebexMeetingSeriesPicker } from "../OnboardingWebexMeetingSeriesPicker";

function Harness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <OnboardingWebexMeetingSeriesPicker
      selectedSeriesKeys={selected}
      onSelectedSeriesKeysChange={setSelected}
    />
  );
}

describe("OnboardingWebexMeetingSeriesPicker", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          candidates: [
            {
              seriesKey: "hosted-series",
              title: "Platform weekly",
              hostEmail: "creator@example.test",
              canAutoIngest: true,
              nextOccurrence: { start: "2026-09-10T10:00:00Z" },
            },
            {
              seriesKey: "guest-series",
              title: "Customer update",
              hostEmail: "host@example.test",
              canAutoIngest: false,
              unavailableReason: "Only the host can add this series.",
            },
          ],
        },
      }),
    }) as jest.Mock;
  });

  afterEach(() => jest.clearAllMocks());

  it("refreshes meetings on open and permits selecting only hosted series", async () => {
    render(<Harness />);

    const hosted = await screen.findByRole("checkbox", { name: "Select Platform weekly" });
    const guest = screen.getByRole("checkbox", { name: "Select Customer update" });
    expect(global.fetch).toHaveBeenCalledWith("/api/tome/webex-meeting-series", {
      cache: "no-store",
    });
    expect(guest).toBeDisabled();

    fireEvent.click(hosted);
    expect(screen.getByText("1 meeting series selected")).toBeInTheDocument();
    expect(hosted).toBeChecked();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search recurring Webex meetings" }), {
      target: { value: "customer" },
    });
    expect(screen.queryByText("Platform weekly")).not.toBeInTheDocument();
    expect(screen.getByText("Customer update")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
