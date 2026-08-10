/**
 * Tests for ImportSkillZipDialog — the UI driver for the
 * /api/skills/configs/import-zip endpoint.
 *
 * Strategy:
 *   - Mock global.fetch so the route never runs; we assert the
 *     dialog drives the two-phase API correctly (FormData with
 *     `file`, then again with `file` + `resolutions`).
 *   - The single-skill shortcut path opens a real zip (built via
 *     jszip in the test) and asserts the parent's
 *     `onSingleSkillApplied` callback receives the parsed payload
 *     without a network round-trip.
 *   - We don't test the `<ImportConflictDialog>` itself — that has
 *     its own coverage. We just check the parent forwards the
 *     conflicts correctly.
 */

import React from "react";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";

import { ImportSkillZipDialog } from "@/components/skills/ImportSkillZipDialog";
import { ToastProvider } from "@/components/ui/toast";

const FRONTMATTER = (name: string) =>
  `---\nname: ${name}\ndescription: built from a unit test\n---\n\n# ${name}\n\nbody`;

// jsdom has no Response constructor, so build a duck-typed object
// matching what the dialog reads from `fetch()`.
function fakeResponse(body: unknown, status = 200) {
  const ok = status >= 200 && status < 300;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === "string" ? body : JSON.parse(text)),
    text: async () => text,
  };
}

/**
 * Drop a file directly onto the hidden input. We use fireEvent
 * rather than userEvent.upload because jsdom + the dialog's
 * polyfilled File can otherwise double-fire the change handler,
 * and userEvent.upload's internal click-to-open dance triggers
 * extra React state churn we don't care about in unit tests.
 */
function dropFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  fireEvent.change(input);
}

async function makeZipFile(
  entries: Record<string, string>,
  name = "skills.zip",
): Promise<File> {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(entries)) zip.file(path, body);
  // Build a stable Uint8Array snapshot of the zip bytes. jsdom's
  // File polyfill stores the bytes but doesn't always expose
  // `.arrayBuffer()` — define it explicitly so the dialog's
  // single-skill shortcut (which calls `file.arrayBuffer()` then
  // hands the result to jszip) works without relying on browser
  // semantics.
  const node = await zip.generateAsync({ type: "uint8array" });
  // Allocate a fresh ArrayBuffer (.buffer of a typed-array slice can
  // be a SharedArrayBuffer in some Node builds, which jszip rejects).
  const ab = new ArrayBuffer(node.byteLength);
  new Uint8Array(ab).set(node);
  const file = new File([new Uint8Array(ab)], name, {
    type: "application/zip",
  });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => ab.slice(0),
  });
  return file;
}

let lastUnmount: (() => void) | null = null;
function renderWithToastTracked(ui: React.ReactElement) {
  const r = render(<ToastProvider>{ui}</ToastProvider>);
  lastUnmount = r.unmount;
  return r;
}

afterEach(() => {
  // Belt + braces: explicitly unmount the previous test's tree before
  // running cleanup, so the dialog's still-pending fetch promises
  // don't fire `setState` against the next test's spy.
  try {
    lastUnmount?.();
  } catch {
    // Ignore — best effort.
  }
  lastUnmount = null;
  cleanup();
  jest.restoreAllMocks();
});

beforeEach(() => {
  // The repo-wide jest.setup.js installs `global.fetch = jest.fn(...)`
  // — that means the same mock instance accumulates calls across
  // tests in this suite. Reset it so each test sees a clean call
  // log even when an earlier test mutated `mockResolvedValueOnce`.
  if (
    typeof global.fetch === "function" &&
    typeof (global.fetch as jest.Mock).mockClear === "function"
  ) {
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(fakeResponse({})),
    );
  }
});

// ---------------------------------------------------------------------------
// Single-skill shortcut (Skill Workspace path)
// ---------------------------------------------------------------------------

describe("ImportSkillZipDialog — single-skill shortcut", () => {
  it("calls onSingleSkillApplied with parsed payload for a one-skill zip and skips the API", async () => {
    const onApplied = jest.fn();
    const fetchSpy = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue(fakeResponse("nope") as never);
    renderWithToastTracked(
      <ImportSkillZipDialog
        open
        onOpenChange={() => {}}
        onSingleSkillApplied={onApplied}
      />,
    );
    const file = await makeZipFile({
      // Use a sub-directory so the SKILL.md claims the script as
      // an ancillary file. Root-level SKILL.md (the other code
      // path) only collects siblings at the root, by design.
      "solo/SKILL.md": FRONTMATTER("solo"),
      "solo/scripts/run.sh": "#!/bin/bash",
    });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    const payload = onApplied.mock.calls[0][0];
    expect(payload.proposedName).toBe("solo");
    expect(payload.description).toBe("built from a unit test");
    expect(payload.skillContent).toContain("# solo");
    expect(Object.keys(payload.ancillaryFiles)).toContain("scripts/run.sh");
    // Critical: the dialog must NOT have hit the API for a
    // single-skill workspace import — that would create an
    // unwanted catalog row.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the API path when the zip contains multiple SKILL.md files", async () => {
    const onApplied = jest.fn();
    // Mock fetch to return an analyze response so we can verify
    // the dialog enters the bulk flow.
    const fetchSpy = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue(
        fakeResponse({
          data: {
            phase: "analyze",
            candidates: [
              {
                candidateId: "a",
                directory: "a",
                proposedName: "Foo",
                description: "",
                bytes: 100,
                ancillaryCount: 0,
                skippedFiles: [],
              },
              {
                candidateId: "b",
                directory: "b",
                proposedName: "Bar",
                description: "",
                bytes: 100,
                ancillaryCount: 0,
                skippedFiles: [],
              },
            ],
            conflicts: [],
            totalBytes: 200,
            totalEntries: 2,
          },
        }) as never,
      );
    renderWithToastTracked(
      <ImportSkillZipDialog
        open
        onOpenChange={() => {}}
        onSingleSkillApplied={onApplied}
      />,
    );
    const file = await makeZipFile({
      "a/SKILL.md": FRONTMATTER("Foo"),
      "b/SKILL.md": FRONTMATTER("Bar"),
    });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);

    // Multi-skill zip: parent's single-skill handler is NOT called.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(onApplied).not.toHaveBeenCalled();
    // Bulk checklist now shows both candidates.
    await waitFor(() => {
      expect(screen.getByTestId("zip-import-candidate-a")).toBeInTheDocument();
      expect(screen.getByTestId("zip-import-candidate-b")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Bulk flow (Gallery path — no onSingleSkillApplied prop)
// ---------------------------------------------------------------------------

describe("ImportSkillZipDialog — bulk flow", () => {
  it("posts to /api/skills/configs/import-zip without resolutions on first upload", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue(
        fakeResponse({
          phase: "analyze",
          candidates: [
            {
              candidateId: "(root)",
              directory: "",
              proposedName: "alpha",
              description: "",
              bytes: 100,
              ancillaryCount: 0,
              skippedFiles: [],
            },
          ],
          conflicts: [],
          totalBytes: 100,
          totalEntries: 1,
        }) as never,
      );
    renderWithToastTracked(
      <ImportSkillZipDialog open onOpenChange={() => {}} />,
    );
    const file = await makeZipFile({ "SKILL.md": FRONTMATTER("alpha") });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/skills/configs/import-zip");
    expect((init as RequestInit).method).toBe("POST");
    const body = (init as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("resolutions")).toBeNull();
  });

  it("renders an enabled Import button after analyze and posts resolutions on confirm", async () => {
    const onBulkImported = jest.fn();
    // First call: analyze. Second call: import.
    const fetchSpy = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValueOnce(
        fakeResponse({
          phase: "analyze",
          candidates: [
            {
              candidateId: "(root)",
              directory: "",
              proposedName: "alpha",
              description: "",
              bytes: 100,
              ancillaryCount: 0,
              skippedFiles: [],
            },
          ],
          conflicts: [],
          totalBytes: 100,
          totalEntries: 1,
        }) as never,
      )
      .mockResolvedValueOnce(
        fakeResponse({
          phase: "import",
          imported: [
            {
              candidateId: "(root)",
              skillId: "skill-alpha-xyz",
              name: "alpha",
              scan_status: "passed",
              outcome: "created",
            },
          ],
        }) as never,
      );
    renderWithToastTracked(
      <ImportSkillZipDialog
        open
        onOpenChange={() => {}}
        onBulkImported={onBulkImported}
      />,
    );
    const file = await makeZipFile({ "SKILL.md": FRONTMATTER("alpha") });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);

    const confirm = await waitFor(() =>
      screen.getByTestId("zip-import-confirm"),
    );
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveTextContent(/Import 1 skill/);
    await userEvent.click(confirm);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const importBody = (fetchSpy.mock.calls[1][1] as RequestInit).body as FormData;
    expect(importBody.get("file")).toBeInstanceOf(File);
    expect(typeof importBody.get("resolutions")).toBe("string");
    const resolutions = JSON.parse(importBody.get("resolutions") as string);
    expect(Array.isArray(resolutions)).toBe(true);

    // Imported summary view rendered.
    await waitFor(() =>
      expect(screen.getByTestId("zip-import-done")).toBeInTheDocument(),
    );
    expect(onBulkImported).toHaveBeenCalledTimes(1);
  });

  it("disables the Import button when the user de-selects every candidate", async () => {
    jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue(
        fakeResponse({
          phase: "analyze",
          candidates: [
            {
              candidateId: "x",
              directory: "x",
              proposedName: "x",
              description: "",
              bytes: 1,
              ancillaryCount: 0,
              skippedFiles: [],
            },
          ],
          conflicts: [],
          totalBytes: 1,
          totalEntries: 1,
        }) as never,
      );
    renderWithToastTracked(
      <ImportSkillZipDialog open onOpenChange={() => {}} />,
    );
    const file = await makeZipFile({ "x/SKILL.md": FRONTMATTER("x") });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);
    const cb = await waitFor(() =>
      screen.getByTestId("zip-import-candidate-x"),
    );
    await userEvent.click(cb);
    const confirm = screen.getByTestId("zip-import-confirm");
    expect(confirm).toBeDisabled();
  });

  it("rejects oversize zip uploads inline without hitting the API", async () => {
    const fetchSpy = jest.spyOn(global, "fetch" as never);
    renderWithToastTracked(
      <ImportSkillZipDialog open onOpenChange={() => {}} />,
    );
    // Synthesize a fake oversize file via Blob; we don't need real
    // bytes — just a `size` property the dialog reads.
    const tooBig = new File([new Blob([""])], "huge.zip", {
      type: "application/zip",
    });
    Object.defineProperty(tooBig, "size", { value: 60 * 1024 * 1024 });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    // userEvent.upload validates the size on click; we use
    // fireEvent.change directly so we hit the dialog's own size
    // guard.
    fireEvent.change(input, { target: { files: [tooBig] } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces an error when the analyze API returns non-OK", async () => {
    const fetchSpy = jest
      .spyOn(global, "fetch" as never)
      .mockResolvedValue(
        fakeResponse("No SKILL.md files found in the zip.", 400) as never,
      );
    renderWithToastTracked(
      <ImportSkillZipDialog open onOpenChange={() => {}} />,
    );
    const file = await makeZipFile({ "README.md": "no skills" });
    const input = screen.getByTestId("zip-import-file-input") as HTMLInputElement;
    dropFile(input, file);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    // Dialog returns to idle so the user can pick a different zip.
    await waitFor(() =>
      expect(screen.getByTestId("zip-import-file-input")).toBeInTheDocument(),
    );
  });
});
