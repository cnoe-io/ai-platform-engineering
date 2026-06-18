// assisted-by claude code claude-sonnet-4-6
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

  it("sends a PutObjectCommand with correct key pattern and gzip body", async () => {
    const backend = new S3Backend("my-bucket", "audit", "us-east-1");
    backend.write(makeEvent());

    // flush async queue
    await new Promise((r) => setImmediate(r));

    const mockInstance = MockS3Client.mock.instances[0] as unknown as { send: jest.Mock };
    expect(mockInstance.send).toHaveBeenCalledTimes(1);

    const [cmd] = mockInstance.send.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(cmd.input.Bucket).toBe("my-bucket");
    const key = cmd.input.Key as string;
    expect(key).toMatch(/^audit\/2026\/06\/18\/auth-20260618T\d{6}Z-[a-f0-9]+\.ndjson\.gz$/);
    expect(cmd.input.ContentEncoding).toBe("gzip");
  });

  it("catches S3 errors and does not throw", async () => {
    const mockInstance = MockS3Client.mock.instances[0] as unknown as { send: jest.Mock } | undefined;
    // Instantiate backend to get a fresh instance
    const backend = new S3Backend("my-bucket");
    const freshMock = MockS3Client.mock.instances[MockS3Client.mock.instances.length - 1] as unknown as { send: jest.Mock };
    freshMock.send.mockRejectedValueOnce(new Error("network error"));

    expect(() => backend.write(makeEvent())).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it("passes custom endpoint to S3Client for MinIO compatibility", () => {
    new S3Backend("minio-bucket", "audit", "us-east-1", "http://localhost:9000");
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://localhost:9000", forcePathStyle: true }),
    );
  });
});
