import {
  DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
  TRON_HALO_COLOR,
  sanitizeAgenticSdlcUiSettings,
} from "@/lib/agentic-sdlc/ui-settings";

describe("Agentic SDLC UI settings", () => {
  it("defaults repo update halos to the Tron cyan treatment", () => {
    expect(DEFAULT_AGENTIC_SDLC_UI_SETTINGS.haloColor).toBe(TRON_HALO_COLOR);
    expect(DEFAULT_AGENTIC_SDLC_UI_SETTINGS.haloDurationSeconds).toBe(30);
  });

  it("sanitizes editable timing and lookback values", () => {
    expect(
      sanitizeAgenticSdlcUiSettings({
        doneIssuesLookbackHours: "0",
        haloDurationSeconds: "not-a-number",
        haloColor: "#ff00ff",
      }),
    ).toEqual({
      ...DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
      haloColor: "#ff00ff",
    });
  });
});
