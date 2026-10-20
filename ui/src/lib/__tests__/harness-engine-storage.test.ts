/** @jest-environment node */
import { canonicalMongoStorageBinding } from "../harness-engine-proxy";

it("compares canonical storage without coupling service credentials or pool/TLS options", () => {
  expect(canonicalMongoStorageBinding("mongodb://reader:example@b.example.test:27017,a.example.test:27017/?authSource=admin", "example"))
    .toBe(canonicalMongoStorageBinding("mongodb://writer:example@a.example.test,b.example.test/?tls=true", "example"));
  expect(canonicalMongoStorageBinding("mongodb://a.example.test", "example"))
    .not.toBe(canonicalMongoStorageBinding("mongodb://a.example.test", "other"));
  expect(canonicalMongoStorageBinding("mongodb://a.example.test", "example"))
    .not.toBe(canonicalMongoStorageBinding("mongodb://other.example.test", "example"));
});
