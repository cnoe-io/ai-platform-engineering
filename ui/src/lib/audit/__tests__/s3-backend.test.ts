import { S3Client } from "@aws-sdk/client-s3";

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const MockS3Client = S3Client as jest.MockedClass<typeof S3Client>;

import { S3Backend } from "../backends/s3-backend";

function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2026-06-18T12:00:00.000Z",
    type: "auth",
    action: "admin_ui#view",
    outcome: "allow",
    ...overrides,
  };
}

describe("S3Backend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("buffers events and flushes as a single batch when count threshold is reached", async () => {
    const backend = new S3Backend("my-bucket", "audit", "us-east-1", undefined, 999_999, 2);
    backend.write(makeEvent());
    backend.write(makeEvent({ action: "admin_ui#export" })); // triggers flush at size=2

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const mockInstance = MockS3Client.mock.instances[0] as unknown as { send: jest.Mock };
    expect(mockInstance.send).toHaveBeenCalledTimes(1); // one batch, not two PUTs

    const [cmd] = mockInstance.send.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(cmd.input.Bucket).toBe("my-bucket");
    const key = cmd.input.Key as string;
    expect(key).toMatch(/^audit\/2026\/06\/18\/audit-20260618T\d{6}Z-[a-f0-9]+\.ndjson\.gz$/);
    expect(cmd.input.ContentType).toBe("application/gzip");
    // No ContentEncoding — avoids transparent auto-decompression by S3 consumers
    expect(cmd.input.ContentEncoding).toBeUndefined();
  });

  it("does not flush until batch size is reached", async () => {
    const backend = new S3Backend("my-bucket", "audit", "us-east-1", undefined, 999_999, 5);
    backend.write(makeEvent());
    backend.write(makeEvent());

    await new Promise((r) => setImmediate(r));

    const mockInstance = MockS3Client.mock.instances[0] as unknown as { send: jest.Mock };
    expect(mockInstance.send).not.toHaveBeenCalled();
  });

  it("catches S3 errors and does not throw", async () => {
    const backend = new S3Backend("my-bucket", "audit", "us-east-1", undefined, 999_999, 1);
    const freshMock = MockS3Client.mock.instances[MockS3Client.mock.instances.length - 1] as unknown as { send: jest.Mock };
    freshMock.send.mockRejectedValueOnce(new Error("network error"));

    expect(() => backend.write(makeEvent())).not.toThrow();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  });

  it("passes custom endpoint to S3Client for MinIO compatibility", () => {
    new S3Backend("minio-bucket", "audit", "us-east-1", "http://localhost:9000");
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://localhost:9000", forcePathStyle: true }),
    );
  });
});
