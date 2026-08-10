/**
 * @jest-environment node
 */

import { getRequestOrigin } from "../request-origin";

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

describe("getRequestOrigin", () => {
  const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (ORIGINAL_NEXTAUTH_URL === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
    }
  });

  describe("priority 1: NEXTAUTH_URL env var", () => {
    it("uses NEXTAUTH_URL when set, ignoring request and headers", () => {
      process.env.NEXTAUTH_URL = "https://grid.outshift.io";
      const req = makeRequest("http://0.0.0.0:3000/api/skills/install.sh", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "wrong-host.example.com",
      });
      expect(getRequestOrigin(req)).toBe("https://grid.outshift.io");
    });

    it("strips trailing path/slashes (origin only)", () => {
      process.env.NEXTAUTH_URL = "https://grid.outshift.io/some/path";
      const req = makeRequest("http://0.0.0.0:3000");
      expect(getRequestOrigin(req)).toBe("https://grid.outshift.io");
    });

    it("falls through when NEXTAUTH_URL is not http/https", () => {
      process.env.NEXTAUTH_URL = "ftp://nope.example.com";
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "fallback.example.com",
      });
      expect(getRequestOrigin(req)).toBe("https://fallback.example.com");
    });

    it("falls through when NEXTAUTH_URL is malformed", () => {
      process.env.NEXTAUTH_URL = "not a url";
      const req = makeRequest("http://0.0.0.0:3000");
      expect(getRequestOrigin(req)).toBe("http://0.0.0.0:3000");
    });

    it("falls through when NEXTAUTH_URL is empty/whitespace", () => {
      process.env.NEXTAUTH_URL = "   ";
      const req = makeRequest("http://0.0.0.0:3000");
      expect(getRequestOrigin(req)).toBe("http://0.0.0.0:3000");
    });
  });

  describe("priority 2: x-forwarded-* headers (NEXTAUTH_URL unset)", () => {
    beforeEach(() => {
      delete process.env.NEXTAUTH_URL;
    });

    it("uses x-forwarded-proto + x-forwarded-host together", () => {
      const req = makeRequest("http://0.0.0.0:3000/api/skills/install.sh", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "grid.outshift.io",
      });
      expect(getRequestOrigin(req)).toBe("https://grid.outshift.io");
    });

    it("only honors the first value in a comma-separated chain", () => {
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "real.example.com, attacker.example.com",
      });
      expect(getRequestOrigin(req)).toBe("https://real.example.com");
    });

    it("preserves an explicit port in x-forwarded-host", () => {
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "internal.example.com:8443",
      });
      expect(getRequestOrigin(req)).toBe("https://internal.example.com:8443");
    });

    it("rejects invalid host characters and falls through to request.url", () => {
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "bad host with spaces",
      });
      expect(getRequestOrigin(req)).toBe("http://0.0.0.0:3000");
    });

    it("rejects unknown protos and falls through to request.url", () => {
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-proto": "gopher",
        "x-forwarded-host": "real.example.com",
      });
      expect(getRequestOrigin(req)).toBe("http://0.0.0.0:3000");
    });

    it("requires BOTH proto and host headers (host alone is not honored)", () => {
      const req = makeRequest("http://0.0.0.0:3000", {
        "x-forwarded-host": "real.example.com",
      });
      expect(getRequestOrigin(req)).toBe("http://0.0.0.0:3000");
    });
  });

  describe("priority 3: request.url fallback", () => {
    beforeEach(() => {
      delete process.env.NEXTAUTH_URL;
    });

    it("uses request.url origin when no env or headers are set", () => {
      const req = makeRequest("https://localhost:3000/api/skills/install.sh");
      expect(getRequestOrigin(req)).toBe("https://localhost:3000");
    });

    it("strips path and query from request.url", () => {
      const req = makeRequest(
        "http://localhost:3000/api/skills/install.sh?agent=claude&scope=user",
      );
      expect(getRequestOrigin(req)).toBe("http://localhost:3000");
    });
  });
});
