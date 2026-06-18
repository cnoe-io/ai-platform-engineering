describe("getAuditBackend", () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.AUDIT_LOG_BACKEND;
    delete process.env.AUDIT_LOG_LOCAL_PATH;
    delete process.env.AUDIT_LOG_S3_BUCKET;
    delete process.env.AUDIT_LOG_S3_PREFIX;
    delete process.env.AUDIT_LOG_S3_REGION;
    delete process.env.AUDIT_LOG_S3_ENDPOINT_URL;
  });

  it("defaults to LocalBackend when AUDIT_LOG_BACKEND is not set", () => {
    const mockWrite = jest.fn();
    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: mockWrite }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockLocalBackend).toHaveBeenCalledTimes(1);
    expect(MockLocalBackend).toHaveBeenCalledWith("./audit-logs");
  });

  it("creates LocalBackend with custom AUDIT_LOG_LOCAL_PATH", () => {
    process.env.AUDIT_LOG_BACKEND = "local";
    process.env.AUDIT_LOG_LOCAL_PATH = "/var/log/audit";

    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockLocalBackend).toHaveBeenCalledWith("/var/log/audit");
  });

  it("AUDIT_LOG_BACKEND is case-insensitive", () => {
    process.env.AUDIT_LOG_BACKEND = "LOCAL";

    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockLocalBackend).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace from AUDIT_LOG_BACKEND", () => {
    process.env.AUDIT_LOG_BACKEND = "  local  ";

    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockLocalBackend).toHaveBeenCalledTimes(1);
  });

  it("creates S3Backend when AUDIT_LOG_BACKEND=s3", () => {
    process.env.AUDIT_LOG_BACKEND = "s3";
    process.env.AUDIT_LOG_S3_BUCKET = "my-audit-bucket";
    process.env.AUDIT_LOG_S3_PREFIX = "logs";
    process.env.AUDIT_LOG_S3_REGION = "eu-west-1";

    const MockS3Backend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: jest.fn() }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: MockS3Backend }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockS3Backend).toHaveBeenCalledTimes(1);
    expect(MockS3Backend).toHaveBeenCalledWith(
      "my-audit-bucket",
      "logs",
      "eu-west-1",
      undefined,
    );
  });

  it("S3Backend defaults prefix to audit and region to us-east-1", () => {
    process.env.AUDIT_LOG_BACKEND = "s3";
    process.env.AUDIT_LOG_S3_BUCKET = "only-bucket";

    const MockS3Backend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: jest.fn() }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: MockS3Backend }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockS3Backend).toHaveBeenCalledWith(
      "only-bucket",
      "audit",
      "us-east-1",
      undefined,
    );
  });

  it("S3Backend passes endpointUrl from AUDIT_LOG_S3_ENDPOINT_URL", () => {
    process.env.AUDIT_LOG_BACKEND = "s3";
    process.env.AUDIT_LOG_S3_BUCKET = "my-bucket";
    process.env.AUDIT_LOG_S3_ENDPOINT_URL = "http://minio:9000";

    const MockS3Backend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: jest.fn() }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: MockS3Backend }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    getAuditBackend();

    expect(MockS3Backend).toHaveBeenCalledWith(
      "my-bucket",
      "audit",
      "us-east-1",
      "http://minio:9000",
    );
  });

  it("throws when AUDIT_LOG_BACKEND=s3 and bucket is missing", () => {
    process.env.AUDIT_LOG_BACKEND = "s3";

    jest.doMock("../backends/local-backend", () => ({ LocalBackend: jest.fn() }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");

    expect(() => getAuditBackend()).toThrow("AUDIT_LOG_S3_BUCKET");
  });

  it("throws for unknown backend name", () => {
    process.env.AUDIT_LOG_BACKEND = "kafka";

    jest.doMock("../backends/local-backend", () => ({ LocalBackend: jest.fn() }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");

    expect(() => getAuditBackend()).toThrow("kafka");
  });

  it("returns the same instance on repeated calls (singleton)", () => {
    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");

    const first = getAuditBackend();
    const second = getAuditBackend();

    expect(first).toBe(second);
    expect(MockLocalBackend).toHaveBeenCalledTimes(1);
  });

  it("singleton resets when module is re-required after jest.resetModules()", () => {
    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend: getFirst } = require("../backend") as typeof import("../backend");
    const firstInstance = getFirst();

    jest.resetModules();

    const MockLocalBackend2 = jest.fn().mockImplementation(() => ({ write: jest.fn() }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend2 }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend: getSecond } = require("../backend") as typeof import("../backend");
    const secondInstance = getSecond();

    expect(secondInstance).not.toBe(firstInstance);
    expect(MockLocalBackend2).toHaveBeenCalledTimes(1);
  });

  it("write() on returned backend calls through to the underlying implementation", () => {
    const mockWrite = jest.fn();
    const MockLocalBackend = jest.fn().mockImplementation(() => ({ write: mockWrite }));
    jest.doMock("../backends/local-backend", () => ({ LocalBackend: MockLocalBackend }));
    jest.doMock("../backends/s3-backend", () => ({ S3Backend: jest.fn() }));

    const { getAuditBackend } = require("../backend") as typeof import("../backend");
    const backend = getAuditBackend();
    const event = { type: "user.login", ts: "2026-06-18T00:00:00.000Z", userId: "u1" };
    backend.write(event);

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(event);
  });
});
