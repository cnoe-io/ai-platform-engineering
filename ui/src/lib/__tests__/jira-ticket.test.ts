import { attachScreenshotToJiraIssue, createJiraTicket } from "@/lib/jira-ticket";

describe("jira-ticket", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("createJiraTicket", () => {
    it("maps issueType Bug to the ITSM '[System] Problem' type", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "10001", key: "OPENSD-1" }),
      }) as unknown as typeof fetch;

      await createJiraTicket(
        "https://org.atlassian.net",
        "bot@example.com",
        "token",
        "OPENSD",
        {
          description: "Broken button",
          userEmail: "user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
          issueType: "Bug",
        },
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.fields.issuetype.name).toBe("[System] Problem");
    });

    it("maps issueType Enhancement to Task", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "10002", key: "OPENSD-2" }),
      }) as unknown as typeof fetch;

      await createJiraTicket(
        "https://org.atlassian.net",
        "bot@example.com",
        "token",
        "OPENSD",
        {
          description: "Add dark mode",
          userEmail: "user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
          issueType: "Enhancement",
        },
      );

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.fields.issuetype.name).toBe("Task");
    });

    it("throws with the Jira error message on failure", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ errors: { issuetype: "Specify a valid issue type" } }),
      }) as unknown as typeof fetch;

      await expect(
        createJiraTicket("https://org.atlassian.net", "bot@example.com", "token", "OPENSD", {
          description: "x",
          userEmail: "user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
        }),
      ).rejects.toThrow("Specify a valid issue type");
    });

    it("adds the exact active reporter account as a watcher", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "10003", key: "EXAMPLE-3" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              accountId: "account-123",
              active: true,
              emailAddress: "test-user@example.com",
            },
          ],
        })
        .mockResolvedValueOnce({ ok: true, status: 204 }) as unknown as typeof fetch;

      await createJiraTicket(
        "https://example.atlassian.net",
        "example-bot@example.com",
        "token",
        "EXAMPLE",
        {
          description: "Broken button",
          userEmail: "test-user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
          issueType: "Bug",
        },
      );

      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        new URL(
          "https://example.atlassian.net/rest/api/3/user/search?query=test-user%40example.com&maxResults=20",
        ),
        expect.objectContaining({
          headers: expect.objectContaining({ Accept: "application/json" }),
        }),
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        "https://example.atlassian.net/rest/api/3/issue/EXAMPLE-3/watchers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify("account-123"),
        }),
      );
    });

    it("does not add a watcher without one exact active email match", async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "10004", key: "EXAMPLE-4" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              accountId: "inactive-account",
              active: false,
              emailAddress: "test-user@example.com",
            },
            {
              accountId: "different-account",
              active: true,
              emailAddress: "different-user@example.com",
            },
          ],
        }) as unknown as typeof fetch;

      await createJiraTicket(
        "https://example.atlassian.net",
        "example-bot@example.com",
        "token",
        "EXAMPLE",
        {
          description: "Broken button",
          userEmail: "test-user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
        },
      );

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("does not add a watcher when the reporter created the Jira ticket", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "10007", key: "EXAMPLE-7" }),
      }) as unknown as typeof fetch;

      await createJiraTicket(
        "https://example.atlassian.net",
        "test-user@example.com",
        "token",
        "EXAMPLE",
        {
          description: "Broken button",
          userEmail: "test-user@example.com",
          contextUrl: "https://example.test",
          area: "Chat",
        },
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("still returns the ticket when Jira user lookup fails", async () => {
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "10008", key: "EXAMPLE-8" }),
        })
        .mockResolvedValueOnce({ ok: false, status: 403 }) as unknown as typeof fetch;

      await expect(
        createJiraTicket(
          "https://example.atlassian.net",
          "example-bot@example.com",
          "token",
          "EXAMPLE",
          {
            description: "Broken button",
            userEmail: "test-user@example.com",
            contextUrl: "https://example.test",
            area: "Chat",
          },
        ),
      ).resolves.toEqual({
        id: "EXAMPLE-8",
        url: "https://example.atlassian.net/browse/EXAMPLE-8",
        provider: "jira",
      });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Could not add reporter test-user@example.com as a watcher"),
        expect.any(Error),
      );
    });

    it("still returns the ticket when adding the Jira watcher fails", async () => {
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "10009", key: "EXAMPLE-9" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            {
              accountId: "account-456",
              active: true,
              emailAddress: "test-user@example.com",
            },
          ],
        })
        .mockResolvedValueOnce({ ok: false, status: 403 }) as unknown as typeof fetch;

      await expect(
        createJiraTicket(
          "https://example.atlassian.net",
          "example-bot@example.com",
          "token",
          "EXAMPLE",
          {
            description: "Broken button",
            userEmail: "test-user@example.com",
            contextUrl: "https://example.test",
            area: "Chat",
          },
        ),
      ).resolves.toEqual(expect.objectContaining({ id: "EXAMPLE-9" }));
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Could not add reporter test-user@example.com as a watcher"),
        expect.any(Error),
      );
    });
  });

  describe("attachScreenshotToJiraIssue", () => {
    const pngDataUrl = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`;

    it("uploads the decoded screenshot as a multipart attachment", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

      await attachScreenshotToJiraIssue(
        "https://org.atlassian.net",
        "bot@example.com",
        "token",
        "OPENSD-42",
        pngDataUrl,
      );

      expect(global.fetch).toHaveBeenCalledWith(
        "https://org.atlassian.net/rest/api/3/issue/OPENSD-42/attachments",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "X-Atlassian-Token": "no-check" }),
        }),
      );
      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.body).toBeInstanceOf(FormData);
    });

    it("throws on a non-data URL", async () => {
      await expect(
        attachScreenshotToJiraIssue(
          "https://org.atlassian.net",
          "bot@example.com",
          "token",
          "OPENSD-42",
          "not-a-data-url",
        ),
      ).rejects.toThrow("not a valid base64 data URL");
    });

    it("throws with the response body on a failed upload", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: async () => "Attachment too large",
      }) as unknown as typeof fetch;

      await expect(
        attachScreenshotToJiraIssue(
          "https://org.atlassian.net",
          "bot@example.com",
          "token",
          "OPENSD-42",
          pngDataUrl,
        ),
      ).rejects.toThrow("Jira attachment upload failed (413)");
    });
  });
});
