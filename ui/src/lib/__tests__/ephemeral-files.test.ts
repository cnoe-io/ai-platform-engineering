import { isPreviewableEphemeralFile,PREVIEWABLE_FILE_EXTENSIONS } from "../ephemeral-files";

describe("ephemeral-files", () => {
  it("marks .md and .txt as previewable", () => {
    expect(PREVIEWABLE_FILE_EXTENSIONS).toEqual([".md", ".txt"]);
    expect(isPreviewableEphemeralFile("workflow-state/meraki-docs-networking.md")).toBe(true);
    expect(isPreviewableEphemeralFile("output.txt")).toBe(true);
    expect(isPreviewableEphemeralFile("data.json")).toBe(false);
    expect(isPreviewableEphemeralFile("archive.tar.gz")).toBe(false);
  });
});
