import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, listMandates } from "../lib/api.ts";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("the API client", () => {
  it("returns the decoded envelope on success", async () => {
    const payload = { data: { mandates: [], nextAfter: null }, meta: { cluster: "surfpool" } };
    mockFetchOnce(200, payload);
    const result = await listMandates({ limit: 10 });
    expect(result).toEqual(payload);
  });

  it("throws a typed ApiError carrying the server's code and message on a non-2xx response", async () => {
    mockFetchOnce(404, { error: { code: "mandate_not_found", message: "no indexed mandate X" } });
    await expect(listMandates()).rejects.toMatchObject({
      status: 404,
      code: "mandate_not_found",
      message: "no indexed mandate X",
    });
  });

  it("falls back to a generic message when the server's error body is malformed", async () => {
    mockFetchOnce(500, {});
    await expect(listMandates()).rejects.toMatchObject({ status: 500, code: "unknown" });
  });

  it("wraps a network failure (fetch itself throwing) in an ApiError instead of letting it propagate raw", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(listMandates()).rejects.toBeInstanceOf(ApiError);
  });

  it("never sends a request body for a GET-style read", async () => {
    mockFetchOnce(200, { data: { mandates: [], nextAfter: null }, meta: {} });
    await listMandates({ status: "Active" });
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.method ?? "GET").not.toBe("POST");
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      "status=Active",
    );
  });
});
