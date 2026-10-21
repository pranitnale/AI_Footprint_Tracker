import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient, ApiError, queryString, rateLimitMessage, requestTimeoutMs } from "../src/api";

test("API client keeps credentials on same-origin v1 JSON requests", async () => {
  const original = globalThis.fetch;
  let seen: [URL | RequestInfo, RequestInit?] | undefined;
  globalThis.fetch = (async (input, init) => {
    seen = [input, init];
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const api = new ApiClient("https://tenant.example");
    api.setCsrf("csrf-token");
    assert.deepEqual(await api.post("/v1/admin/policy", { value: 1 }), {
      ok: true,
    });
    assert.equal(String(seen?.[0]), "https://tenant.example/v1/admin/policy");
    assert.equal(seen?.[1]?.credentials, "include");
    assert.equal(seen?.[1]?.redirect, "error");
    assert.equal(
      new Headers(seen?.[1]?.headers).get("x-csrf-token"),
      "csrf-token",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("API client rejects cross-origin paths before fetch", async () => {
  const api = new ApiClient("https://tenant.example");
  await assert.rejects(
    api.get("https://attacker.example/v1/admin/users"),
    (error: ApiError) => error.code === "invalid_api_path",
  );
});

test("API client reports network and malformed response failures", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    await assert.rejects(
      new ApiClient("https://tenant.example").get("/v1/config"),
      (error: ApiError) => error.code === "offline",
    );
    globalThis.fetch = (async () =>
      new Response("<html>", {
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    await assert.rejects(
      new ApiClient("https://tenant.example").get("/v1/config"),
      (error: ApiError) => error.code === "invalid_response",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("date and site filters are encoded without credentials", () => {
  assert.equal(
    queryString({
      start: "2026-09-01",
      end: "2026-10-01",
      site: "claude",
      model: undefined,
    }),
    "?start=2026-09-01&end=2026-10-01&site=claude",
  );
});

test("organization summaries may take longer than other requests before the page reports offline", () => {
  // 14 Oct 2026: the admin summary took 5 to 37 s and the page showed "Error code: offline" at 15 s.
  assert.equal(requestTimeoutMs("/v1/admin/summary?period=custom&start=2026-09-15&end=2026-10-15"), 90_000);
  assert.equal(requestTimeoutMs("/v1/company/summary"), 90_000);
  assert.equal(requestTimeoutMs("/v1/me/summary?period=all"), 90_000);
  assert.equal(requestTimeoutMs("/v1/admin/activity?period=month"), 90_000);
  assert.equal(requestTimeoutMs("/v1/admin/people?period=custom"), 15_000);
  assert.equal(requestTimeoutMs("/v1/admin/summary/export"), 15_000);
  assert.equal(requestTimeoutMs("/v1/auth/session"), 15_000);
});

test("a summary larger than 2 MiB is read, other answers keep the 2 MiB limit (15 October 2026)", async () => {
  // A 30-day admin summary with its splits measured 2.3 MB and the overview showed
  // "The server did not answer" with response_too_large.
  const original = globalThis.fetch;
  const big = JSON.stringify({ aggregate_status: "current", padding: "x".repeat(2_400_000) });
  globalThis.fetch = (async () =>
    new Response(big, { headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const api = new ApiClient("https://tenant.example");
    const summary = await api.get<{ aggregate_status: string }>("/v1/admin/summary?period=custom&start=2026-09-15&end=2026-10-15");
    assert.equal(summary.aggregate_status, "current");
    await api.get("/v1/company/summary");
    await api.get("/v1/me/summary");
    await assert.rejects(api.get("/v1/admin/users"), (error: ApiError) => error.code === "response_too_large");
  } finally {
    globalThis.fetch = original;
  }
});

// QA of 19 Oct 2026: the sixth admin action code in 15 minutes ended in the generic error.
test("a refused code request says plainly when a new code can be requested", async () => {
  const original = globalThis.fetch;
  const refusal = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    (async () =>
      new Response(
        JSON.stringify({ error: { code: "otp_rate_limited", retryable: true, correlation_id: "c-1", safe_message: "Generic.", ...body } }),
        { status: 429, headers: { "content-type": "application/json", ...headers } },
      )) as typeof fetch;
  const refused = () =>
    new ApiClient("https://tenant.example").post("/v1/auth/otp/request", {}).then(
      () => assert.fail("the request is refused"),
      (caught: ApiError) => caught,
    );
  try {
    globalThis.fetch = refusal({ retry_after_seconds: 600 }, { "retry-after": "600" });
    const error = await refused();
    assert.equal(error.code, "otp_rate_limited");
    assert.match(error.message, /^Too many email codes were requested in a short time\. You can request a new code at .+, in about 10 minutes\.$/);
    assert.equal(error.safe_message, error.message);
    // A server that sends only the header is read the same way.
    globalThis.fetch = refusal({}, { "retry-after": "45" });
    assert.match((await refused()).message, /in under a minute\.$/);
    // Without retry information it still says what happened and what to do.
    globalThis.fetch = refusal({});
    assert.equal(
      (await refused()).message,
      "Too many email codes were requested in a short time. Wait a few minutes, then request a new code.",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("the retry time names the day when it is not today", () => {
  const now = new Date(2026, 9, 20, 23, 50);
  const tomorrow = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(2026, 9, 21));
  const later = rateLimitMessage("otp_rate_limited", 3 * 3600, now)!;
  assert.ok(later.includes(tomorrow), later);
  assert.match(later, /in about 3 hours\.$/);
  assert.match(rateLimitMessage("rate_limited", 120, now)!, /^Too many requests were made in a short time\. You can try again at .+, in about 2 minutes\.$/);
  assert.equal(rateLimitMessage("stale_version", 10, now), null);
});
