/** @jest-environment node */

import { presentationPublicOrigin } from "@/lib/tome/public-origin";

const originalTomePublicOrigin = process.env.TOME_PUBLIC_ORIGIN;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

function request(headers?: HeadersInit): Request {
  return new Request("http://0.0.0.0:3000/api/tome/export", { headers });
}

beforeEach(() => {
  delete process.env.TOME_PUBLIC_ORIGIN;
  delete process.env.NEXTAUTH_URL;
});

afterAll(() => {
  if (originalTomePublicOrigin === undefined) delete process.env.TOME_PUBLIC_ORIGIN;
  else process.env.TOME_PUBLIC_ORIGIN = originalTomePublicOrigin;
  if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuthUrl;
});

it("prefers the configured TOME public origin", () => {
  process.env.TOME_PUBLIC_ORIGIN = "https://tome.example.test/base/path";
  process.env.NEXTAUTH_URL = "https://auth.example.test";

  expect(presentationPublicOrigin(request())).toBe("https://tome.example.test");
});

it("uses the NextAuth origin when no TOME override is configured", () => {
  process.env.NEXTAUTH_URL = "https://app.example.test/login";

  expect(presentationPublicOrigin(request())).toBe("https://app.example.test");
});

it("uses sanitized proxy headers when public origins are not configured", () => {
  expect(presentationPublicOrigin(request({
    "X-Forwarded-Host": "external.example.test",
    "X-Forwarded-Proto": "https",
  }))).toBe("https://external.example.test");
});

it("falls back to the request origin without trusted public metadata", () => {
  expect(presentationPublicOrigin(request())).toBe("http://0.0.0.0:3000");
});
