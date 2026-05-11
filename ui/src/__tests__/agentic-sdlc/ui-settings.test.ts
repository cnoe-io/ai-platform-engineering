import {
  DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
  HALO_COLOR_OPTIONS,
  TRON_HALO_COLOR,
  sanitizeAgenticSdlcUiSettings,
} from "@/lib/agentic-sdlc/ui-settings";

describe("Agentic SDLC UI settings", () => {
  it("defaults repo update halos to the Tron cyan treatment", () => {
    expect(DEFAULT_AGENTIC_SDLC_UI_SETTINGS.haloColor).toBe(TRON_HALO_COLOR);
    expect(DEFAULT_AGENTIC_SDLC_UI_SETTINGS.haloDurationSeconds).toBe(30);
    expect(DEFAULT_AGENTIC_SDLC_UI_SETTINGS.replayIntervalSeconds).toBe(3);
    expect(HALO_COLOR_OPTIONS[0]).toEqual({
      label: "Default",
      value: TRON_HALO_COLOR,
    });
  });

  it("sanitizes editable timing and lookback values", () => {
    expect(
      sanitizeAgenticSdlcUiSettings({
        doneIssuesLookbackHours: "0",
        haloDurationSeconds: "not-a-number",
        replayIntervalSeconds: "0",
        haloColor: "#ff00ff",
      }),
    ).toEqual({
      ...DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
      haloColor: "#ff00ff",
    });
  });
});
