import { ServiceBackend } from "../backends/service-backend";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2026-06-20T12:00:00.000Z",
    type: "auth",
    action: "admin_ui#view",
    outcome: "allow",
    ...overrides,
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("ServiceBackend", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 }) as jest.Mock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("posts buffered events to audit-service when batch size is reached", async () => {
    const backend = new ServiceBackend("http://audit-service:8010/", 999_999, 2);
    backend.write(makeEvent());
    backend.write(makeEvent({ action: "admin_ui#export" }));

    await tick();
    await tick();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://audit-service:8010/v1/audit/events",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      events: [expect.objectContaining({ action: "admin_ui#view" }), expect.objectContaining({ action: "admin_ui#export" })],
    });
  });

  it("catches audit-service errors and does not throw", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    const backend = new ServiceBackend("http://audit-service:8010", 999_999, 1);

    expect(() => backend.write(makeEvent())).not.toThrow();
    await tick();
    await tick();
  });
});
