/**
 * @jest-environment jsdom
 */

import {
  markAppearanceInteraction,
  mergeUnchangedServerAppearance,
  readCachedAppearancePreferences,
  snapshotAppearanceInteractions,
  type AppearancePreferences,
} from "@/lib/appearance-preferences";

const CURRENT: AppearancePreferences = {
  fontFamily: "inter",
  fontSize: "large",
  gradientTheme: "default",
  theme: "dark",
};

describe("appearance preference hydration",() => {
  beforeEach(() => localStorage.clear());

  it("reads the next-themes cache with the other appearance values",() => {
    localStorage.setItem("theme","nord");

    expect(readCachedAppearancePreferences()).toMatchObject({ theme: "nord" });
  });

  it("does not overwrite a field changed after hydration started",() => {
    const snapshot = snapshotAppearanceInteractions();
    markAppearanceInteraction("fontSize");

    expect(mergeUnchangedServerAppearance(
      CURRENT,
      {
        fontFamily: "source-sans",
        fontSize: "small",
        gradientTheme: "ocean",
        theme: "light",
      },
      snapshot,
    )).toEqual({
      fontFamily: "source-sans",
      fontSize: "large",
      gradientTheme: "ocean",
      theme: "light",
    });
  });
});
