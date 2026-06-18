import fs from "fs/promises";

jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined),
}));

const mockMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>;
const mockAppendFile = fs.appendFile as jest.MockedFunction<typeof fs.appendFile>;

import { LocalBackend } from "../backends/local-backend";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2026-06-18T12:00:00.000Z",
    type: "auth",
    action: "admin_ui#view",
    outcome: "allow",
    ...overrides,
  };
}

describe("LocalBackend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls mkdir with recursive:true and appendFile for a write", async () => {
    const backend = new LocalBackend("/audit-logs");
    backend.write(makeEvent());

    // write is async internally — flush microtask queue
    await Promise.resolve();
    await Promise.resolve();

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringMatching(/2026\/06\/18$/),
      { recursive: true },
    );
    expect(mockAppendFile).toHaveBeenCalledWith(
      expect.stringMatching(/auth-20260618.*\.ndjson$/),
      expect.stringContaining('"type":"auth"'),
      "utf-8",
    );
  });

  it("appends (does not recreate) on second write from the same backend instance", async () => {
    const backend = new LocalBackend("/audit-logs");
    backend.write(makeEvent());
    backend.write(makeEvent({ action: "admin_ui#export" }));

    await Promise.resolve();
    await Promise.resolve();

    expect(mockAppendFile).toHaveBeenCalledTimes(2);
    // Both calls should use the same filename (same UUID per instance)
    const [call1, call2] = mockAppendFile.mock.calls;
    expect(call1[0]).toBe(call2[0]);
  });

  it("catches fs errors and does not throw", async () => {
    mockMkdir.mockRejectedValueOnce(new Error("disk full"));

    const backend = new LocalBackend("/audit-logs");
    expect(() => backend.write(makeEvent())).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
  });

  it("serialises Date objects to ISO strings", async () => {
    const backend = new LocalBackend("/audit-logs");
    backend.write(makeEvent({ ts: new Date("2026-06-18T00:00:00.000Z") }));

    await Promise.resolve();
    await Promise.resolve();

    const content = mockAppendFile.mock.calls[0][1] as string;
    expect(content).toContain("2026-06-18");
    expect(content).not.toContain("[object Object]");
  });
});
