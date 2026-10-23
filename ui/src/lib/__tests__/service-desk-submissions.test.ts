/** @jest-environment node */
import { submitServiceDeskOnce } from "@/lib/service-desk-submissions";

const mockInsert = jest.fn();
const mockFind = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/mongodb", () => ({
  getCollection: async () => ({ insertOne: mockInsert, findOne: mockFind, updateOne: mockUpdate }),
}));
jest.mock("@/lib/api-middleware", () => ({
  ApiError: class extends Error {
    constructor(message: string, public statusCode: number) { super(message); }
  },
}));

const ticket = { id: "#7", number: 7, url: "https://example.test/issues/7", provider: "github" as const };

beforeEach(() => {
  jest.resetAllMocks();
  mockInsert.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
});

it("reserves before writing and stores the actual ticket", async () => {
  const submit = jest.fn(async () => {
    expect(mockInsert).toHaveBeenCalledTimes(1);
    return ticket;
  });
  await expect(submitServiceDeskOnce("test-user@example.com", "request", submit)).resolves.toEqual(ticket);
  expect(mockUpdate).toHaveBeenCalledWith({ _id: expect.any(String) }, { $set: { ticket } });
});

it("replays the saved result without another GitHub write", async () => {
  mockInsert.mockRejectedValue({ code: 11000 });
  mockFind.mockResolvedValue({ ticket });
  const submit = jest.fn();
  await expect(submitServiceDeskOnce("test-user@example.com", "request", submit)).resolves.toEqual(ticket);
  expect(submit).not.toHaveBeenCalled();
});

it("blocks a concurrent or uncertain submission", async () => {
  mockInsert.mockRejectedValue({ code: 11000 });
  mockFind.mockResolvedValue({});
  const submit = jest.fn();
  await expect(submitServiceDeskOnce("test-user@example.com", "request", submit)).rejects.toMatchObject({ statusCode: 409 });
  expect(submit).not.toHaveBeenCalled();
});

it("keeps a reservation after an uncertain write outcome", async () => {
  await expect(submitServiceDeskOnce("test-user@example.com", "request", async () => { throw new Error("timeout"); })).rejects.toThrow("timeout");
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockInsert).toHaveBeenCalledTimes(1);
});

it("fails closed when the reservation store is unavailable", async () => {
  mockInsert.mockRejectedValue(new Error("database unavailable"));
  const submit = jest.fn();
  await expect(submitServiceDeskOnce("test-user@example.com", "request", submit)).rejects.toThrow("database unavailable");
  expect(submit).not.toHaveBeenCalled();
});

it("scopes request identifiers to the authenticated reporter", async () => {
  await submitServiceDeskOnce("primary@example.com", "same-request", async () => ticket);
  await submitServiceDeskOnce("secondary@example.com", "same-request", async () => ticket);
  expect(mockInsert.mock.calls[0][0]._id).not.toEqual(mockInsert.mock.calls[1][0]._id);
});
