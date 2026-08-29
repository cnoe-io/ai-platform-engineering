/** @jest-environment node */

jest.mock("@/lib/agentic-sdlc/sli", () => ({
  incSseConnection: jest.fn(),
  decSseConnection: jest.fn(),
}));

describe("shared SSE bus", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("delivers across separately loaded server bundle modules", () => {
    const first = jest.requireActual<typeof import("../sse-bus")>("../sse-bus");
    first._resetBusForTest();
    const send = jest.fn();
    const subscription = first.subscribe("example:topic", {
      id: "subscriber-1",
      userId: "viewer@example.test",
      send,
      close: jest.fn(),
    });

    jest.resetModules();
    const second = jest.requireActual<typeof import("../sse-bus")>("../sse-bus");
    second.publish("example:topic", {
      event: "event_appended",
      data: { repository: "example/service", number: 42 },
    });

    expect(send).toHaveBeenCalledWith({
      event: "event_appended",
      data: { repository: "example/service", number: 42 },
    });
    subscription.dispose();
    second._resetBusForTest();
  });
});
