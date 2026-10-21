import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger } from "@footprint/ledger";
import {
  serverSummary,
  monthlySummary,
  validatedSummary,
  SUMMARY_RESPONSE_BYTES,
} from "../lib/server-summary";
import { CompanyClient } from "../lib/company";
async function fixture() {
  const ledger = await Ledger.open("summary-" + crypto.randomUUID());
  const credentials: any = {
    key: "credentials",
    namespace: "company:test",
    origin: "https://company.example",
    enrollment_era: { id: "00000000-0000-4000-8000-000000000001" },
    device_id: "device-one",
    policy: { deletion_epoch: 0, timezone: "Europe/Berlin" },
  };
  await ledger.put("policy", credentials);
  let offline = false;
  let failure: Error | null = null;
  const company: any = {
    credentials: () => ledger.get("policy", "credentials"),
    authorized: async (path: string) => {
      // The message fetch rejects with when the server cannot be reached.
      if (offline) throw new TypeError("Failed to fetch");
      if (failure) throw failure;
      return {
        aggregate_status: "current",
        request_count: path.includes("/me/") ? "3" : "12",
        attempt_count: "3",
        resources: [],
        tokens: [],
        unexpected_secret: "must not persist",
      };
    },
  };
  return {
    ledger,
    company,
    credentials,
    offline: () => {
      offline = true;
    },
    fail: (error: Error | null) => {
      failure = error;
    },
  };
}
test("offline server cache stays separate by namespace/view/filters and deletion epoch", async () => {
  const f = await fixture();
  assert.equal(
    (await serverSummary(f.ledger, f.company, "my", "?period=all"))
      .request_count,
    "3",
  );
  await serverSummary(f.ledger, f.company, "company", "?period=all");
  f.offline();
  const mine = await serverSummary(f.ledger, f.company, "my", "?period=all");
  assert.equal(mine.snapshot_source, "cached");
  assert.equal(mine.request_count, "3");
  assert.equal(mine.offline, true);
  assert.ok(mine.cached_at);
  assert.equal(
    (await serverSummary(f.ledger, f.company, "company", "?period=all"))
      .request_count,
    "12",
  );
  await assert.rejects(
    serverSummary(f.ledger, f.company, "my", "?period=month"),
  );
  assert.ok(
    !JSON.stringify(
      await f.ledger.list("dashboard_cache", "company:test"),
    ).includes("must not persist"),
  );
  await f.ledger.put("policy", {
    ...f.credentials,
    policy: { ...f.credentials.policy, deletion_epoch: 1 },
  });
  await assert.rejects(serverSummary(f.ledger, f.company, "my", "?period=all"));
});
test("a cached summary served after a server error is not marked offline", async () => {
  // The popup says Offline only when the server cannot be reached (14 Oct 2026).
  const f = await fixture();
  await serverSummary(f.ledger, f.company, "company", "?period=all");
  for (const error of [
    Object.assign(new Error("sync_delayed"), { status: 503, retryAfter: 0 }),
    Object.assign(new Error("sync_delayed"), { status: 429, retryAfter: 60000 }),
    new TypeError("Cannot read properties of undefined"),
  ]) {
    f.fail(error);
    const cached = await serverSummary(f.ledger, f.company, "company", "?period=all");
    assert.equal(cached.snapshot_source, "cached");
    assert.equal(cached.request_count, "12");
    assert.equal(cached.offline, false, error.message);
  }
  f.fail(new DOMException("The organization server did not answer in time.", "TimeoutError"));
  assert.equal(
    (await serverSummary(f.ledger, f.company, "company", "?period=all")).offline,
    true,
  );
});
test("monthly panel is claimed atomically once across two user-opened dashboards", async () => {
  const f = await fixture();
  const now = new Date("2026-09-10T12:00:00Z");
  const results = await Promise.all([
    monthlySummary(f.ledger, f.company, now),
    monthlySummary(f.ledger, f.company, now),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean)?.month, "2026-08");
  assert.equal(results.find(Boolean)?.timezone, "Europe/Berlin");
  assert.equal(await monthlySummary(f.ledger, f.company, now), null);
});
test("cache lookup and write cannot survive namespace change or an erasure in progress", async () => {
  const f = await fixture();
  await serverSummary(f.ledger, f.company, "my");
  f.offline();
  await f.ledger.put("deletion_markers", {
    key: "range:company:test:1",
    namespace: "company:test",
    status: "purging",
  });
  await assert.rejects(serverSummary(f.ledger, f.company, "my"));
  await f.ledger.put("policy", {
    ...f.credentials,
    namespace: "company:other",
  });
  await assert.rejects(serverSummary(f.ledger, f.company, "my"));
});

const fileResponse = () => ({
  aggregate_status: "current",
  request_count: "1",
  file_text: [
    {
      quantity: "extracted_file_text",
      scope: "extracted_file_text",
      unit: "tokens",
      additive: false,
      value: "33",
      measurement_group: {
        origin: "unknown_origin",
        extraction_profile_id: "observed-inline-file-text-v1",
        evidence: "heuristic_estimate",
        profile_id: "o200k-base-4.0.0-reference",
      },
      applicable_count: 1,
      contributing_component_count: 1,
      unknown_count: 0,
      partial_count: 0,
      unvalidated_count: 1,
      reason_counts: { tokenizer_mapping_unverified: 1 },
      missing_counts: { provider_processing: 1, ocr: 1 },
    },
  ],
  file_text_coverage: {
    observed_request_count: "1",
    unknown_request_count: "0",
    scope: "extracted_file_text",
    additive: false,
  },
});
test("file projection preserves populated, unknown, empty, null and legacy absence distinctly", () => {
  const response = fileResponse();
  const projected = validatedSummary(response);
  assert.deepEqual(projected.file_text, response.file_text);
  assert.deepEqual(projected.file_text_coverage, response.file_text_coverage);
  response.file_text[0].value = "99";
  assert.equal((projected.file_text as any)[0].value, "33");
  const unknown: any = fileResponse();
  Object.assign(unknown.file_text[0], {
    value: null,
    contributing_component_count: 0,
    unknown_count: 1,
    unvalidated_count: 0,
  });
  Object.assign(unknown.file_text[0].measurement_group, {
    evidence: "unknown",
    profile_id: null,
  });
  unknown.file_text[0].reason_counts = { tokenizer_unavailable: 1 };
  assert.equal((validatedSummary(unknown).file_text as any)[0].value, null);
  for (const value of [null, []]) {
    const input = { ...fileResponse(), file_text: value };
    assert.deepEqual(validatedSummary(input).file_text, value);
  }
  assert.equal(
    validatedSummary({ aggregate_status: "current", file_text_coverage: null })
      .file_text_coverage,
    null,
  );
  const old = validatedSummary({
    aggregate_status: "current",
    request_count: "1",
  });
  assert.equal(Object.hasOwn(old, "file_text"), false);
  assert.equal(Object.hasOwn(old, "file_text_coverage"), false);
});
test("file projection rejects malformed numeric, group, count, raw and coverage data", () => {
  const changes: Array<(v: any) => void> = [
    (v) => (v.file_text[0].value = "1.5"),
    (v) => (v.file_text[0].value = "1e3"),
    (v) => (v.file_text[0].value = 33),
    (v) => (v.file_text[0].value = null),
    (v) => (v.file_text[0].additive = true),
    (v) => (v.file_text[0].scope = "provider_request"),
    (v) => (v.file_text[0].measurement_group.origin = "filename"),
    (v) =>
      (v.file_text[0].measurement_group.extraction_profile_id =
        "unreviewed-profile"),
    (v) =>
      (v.file_text[0].measurement_group.profile_id = "unreviewed-tokenizer"),
    (v) => (v.file_text[0].measurement_group.evidence = "provider_reported"),
    (v) => (v.file_text[0].measurement_group.profile_id = null),
    (v) => (v.file_text[0].component_id = "raw-provider-id"),
    (v) => (v.file_text[0].measurement_group.filename = "private.txt"),
    (v) => (v.file_text[0].partial_count = 2),
    (v) => (v.file_text[0].unknown_count = 1),
    (v) => (v.file_text[0].applicable_count = 1.5),
    (v) => (v.file_text[0].unvalidated_count = -1),
    (v) => (v.file_text[0].applicable_count = Number.MAX_SAFE_INTEGER + 1),
    (v) => (v.file_text[0].reason_counts = { arbitrary_message: 1 }),
    (v) => (v.file_text[0].reason_counts = { tokenizer_mapping_unverified: 2 }),
    (v) => (v.file_text[0].missing_counts = { provider_processing: "1" }),
    (v) => (v.file_text[0].missing_counts = { raw_file_content: 1 }),
    (v) => v.file_text.push(structuredClone(v.file_text[0])),
    (v) => (v.file_text = Array(1001).fill(v.file_text[0])),
    (v) => (v.file_text_coverage.unknown_request_count = "1"),
    (v) => (v.file_text_coverage.observed_request_count = "0"),
    (v) => (v.file_text_coverage.observed_request_count = "1.0"),
    (v) => (v.file_text_coverage.additive = true),
    (v) => (v.file_text_coverage.raw = "secret"),
    (v) => delete v.file_text[0].partial_count,
  ];
  for (const mutate of changes) {
    const v = fileResponse();
    mutate(v);
    assert.throws(() => validatedSummary(v), /^Error: payload_rejected$/);
  }
});
test("invalid file response never replaces an already validated synced cache", async () => {
  const f = await fixture();
  try {
    f.company.authorized = async () => fileResponse();
    await serverSummary(f.ledger, f.company, "my");
    f.company.authorized = async () => {
      const v = fileResponse();
      v.file_text[0].unknown_count = 2;
      return v;
    };
    await assert.rejects(
      serverSummary(f.ledger, f.company, "my"),
      /payload_rejected/,
    );
    f.company.authorized = async () => {
      throw new TypeError("offline");
    };
    const cached = await serverSummary(f.ledger, f.company, "my");
    assert.equal((cached.file_text as any)[0].value, "33");
    assert.equal(
      (cached.file_text_coverage as any).observed_request_count,
      "1",
    );
  } finally {
    f.ledger.close();
  }
});

/** A connected CompanyClient whose transport answers every request with `answer()`. */
async function clientFixture(answer: () => Response) {
  const ledger = await Ledger.open("summary-client-" + crypto.randomUUID());
  await ledger.put("policy", {
    key: "credentials",
    origin: "https://large.example",
    namespace: "company:large",
    access_token: "access-proof",
    access_expires_at: new Date(Date.now() + 600000).toISOString(),
    enrollment_era: { id: "00000000-0000-4000-8000-000000000002" },
    device_id: "device-large",
    policy: { deletion_epoch: 0, timezone: "Europe/Berlin" },
  });
  return {
    ledger,
    client: new CompanyClient(ledger, (async () => answer()) as typeof fetch),
  };
}
/**
 * A current company summary padded with day splits to about `bytes` bytes of JSON. The days are
 * real dates within the 62 the server sends, since the splits are validated and kept.
 */
function paddedSummary(bytes: number) {
  const count = 60;
  const day = {
    aggregate_status: "current",
    request_count: "1",
    safe_message: "x".repeat(Math.ceil(bytes / count)),
  };
  const days: Record<string, unknown> = {};
  const start = Date.parse("2026-08-01T00:00:00Z");
  for (let i = 0; i < count; i++)
    days[new Date(start + i * 86400000).toISOString().slice(0, 10)] = day;
  return JSON.stringify({
    aggregate_status: "current",
    request_count: "12",
    resources: [],
    tokens: [],
    days,
  });
}
test("a company summary over 1 MiB but within the summary cap is accepted; a larger one is refused", async () => {
  // A 30-day company summary with its splits measured just over 1 MiB on 15 Oct 2026.
  let body = paddedSummary(1.5 * 1024 * 1024);
  assert.ok(body.length > 1048576);
  const f = await clientFixture(
    () =>
      new Response(body, { headers: { "Content-Type": "application/json" } }),
  );
  try {
    const summary = await serverSummary(
      f.ledger,
      f.client,
      "company",
      "?period=all",
    );
    assert.equal(summary.request_count, "12");
    assert.equal(summary.snapshot_source, "server");
    // Other calls keep the 1 MiB cap.
    await assert.rejects(f.client.authorized("/v1/config"), /payload_rejected/);
    body = paddedSummary(SUMMARY_RESPONSE_BYTES + 65536);
    await assert.rejects(
      serverSummary(f.ledger, f.client, "company", "?period=month"),
      /payload_rejected/,
    );
  } finally {
    f.ledger.close();
  }
});
test("an unreadable summary answer or a timeout falls back to the last cached snapshot", async () => {
  const f = await fixture();
  try {
    await serverSummary(f.ledger, f.company, "company", "?period=all");
    // Too large for the cap, or not JSON: the server answered but its summary could not be read.
    f.fail(new Error("payload_rejected"));
    const unreadable = await serverSummary(
      f.ledger,
      f.company,
      "company",
      "?period=all",
    );
    assert.equal(unreadable.snapshot_source, "cached");
    assert.equal(unreadable.request_count, "12");
    assert.equal(unreadable.offline, false);
    f.fail(
      new DOMException(
        "The organization server did not answer in time.",
        "TimeoutError",
      ),
    );
    const late = await serverSummary(
      f.ledger,
      f.company,
      "company",
      "?period=all",
    );
    assert.equal(late.snapshot_source, "cached");
    assert.equal(late.offline, true);
    // A refusal with a status is the server's own answer and the cache does not cover it.
    f.fail(
      Object.assign(new Error("payload_rejected"), {
        status: 400,
        retryAfter: 0,
      }),
    );
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=all"),
      /payload_rejected/,
    );
    // Without a cached copy the failure still reaches the caller.
    f.fail(new Error("payload_rejected"));
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=month"),
      /payload_rejected/,
    );
  } finally {
    f.ledger.close();
  }
});
test("splits=none is sent as asked, and an older server's 422 is retried once without it and remembered", async () => {
  const f = await fixture();
  try {
    await f.ledger.put("policy", {
      ...f.credentials,
      origin: "https://older.example",
    });
    const paths: string[] = [];
    let older = true;
    f.company.authorized = async (path: string) => {
      paths.push(path);
      if (older && path.includes("splits=none"))
        throw Object.assign(new Error("payload_rejected"), {
          status: 422,
          retryAfter: 0,
          serverCode: "unsupported_filter",
        });
      return {
        aggregate_status: "current",
        request_count: "12",
        resources: [],
        tokens: [],
      };
    };
    const first = await serverSummary(
      f.ledger,
      f.company,
      "company",
      "?period=all&splits=none",
    );
    assert.equal(first.request_count, "12");
    assert.deepEqual(paths, [
      "/v1/company/summary?period=all&splits=none",
      "/v1/company/summary?period=all",
    ]);
    paths.length = 0;
    await serverSummary(
      f.ledger,
      f.company,
      "company",
      "?period=month&splits=none",
    );
    assert.deepEqual(
      paths,
      ["/v1/company/summary?period=month"],
      "the refusal is remembered for the session",
    );
    // A server that knows the parameter receives it.
    older = false;
    await f.ledger.put("policy", {
      ...f.credentials,
      origin: "https://current.example",
    });
    paths.length = 0;
    await serverSummary(
      f.ledger,
      f.company,
      "company",
      "?period=all&splits=none",
    );
    assert.deepEqual(paths, ["/v1/company/summary?period=all&splits=none"]);
    // Another 422 is not retried, and splits takes no other value.
    f.company.authorized = async () => {
      throw Object.assign(new Error("payload_rejected"), {
        status: 422,
        retryAfter: 0,
        serverCode: "invalid_period",
      });
    };
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=year&splits=none"),
      /payload_rejected/,
    );
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=all&splits=all"),
      /payload_rejected/,
    );
  } finally {
    f.ledger.close();
  }
});

/** One split part as Analytics.splits sends it: a complete summary of its own. */
function splitPart(requests: number, extra: Record<string, unknown> = {}) {
  return {
    aggregate_status: "current",
    request_count: String(requests),
    attempt_count: String(requests),
    resources: [
      {
        quantity: "energy",
        unit: "kWh",
        scope: "modeled_text_component",
        value: "0.25",
        unknown_count: "0",
        contributing_attempt_count: String(requests),
      },
    ],
    tokens: [],
    ...extra,
  };
}
function splitAnswer() {
  return {
    ...splitPart(12),
    active_users: "4",
    days: {
      "2026-10-01": splitPart(5),
      "2026-10-02": splitPart(7, { unexpected_secret: "must not persist" }),
    },
    sites: { chatgpt: splitPart(9), claude: splitPart(3) },
    models: {
      "chatgpt-gpt-6-sol": splitPart(9, { site: "chatgpt" }),
      "claude-opus-5-5": splitPart(3, { site: "claude" }),
    },
  };
}

test("the organization's day, tool and model splits are kept, each checked like a whole summary", () => {
  const out = validatedSummary(splitAnswer()) as any;
  assert.deepEqual(Object.keys(out.days), ["2026-10-01", "2026-10-02"]);
  assert.equal(out.days["2026-10-02"].request_count, "7");
  assert.equal(out.days["2026-10-02"].unexpected_secret, undefined);
  assert.equal(out.days["2026-10-01"].resources[0].value, "0.25");
  assert.deepEqual(Object.keys(out.sites), ["chatgpt", "claude"]);
  assert.equal(out.sites.claude.request_count, "3");
  assert.equal(out.models["chatgpt-gpt-6-sol"].site, "chatgpt");
  assert.equal(out.models["claude-opus-5-5"].request_count, "3");
  // A splits=none answer has no split keys and gains none.
  const { days: _d, sites: _s, models: _m, ...totals } = splitAnswer();
  const plain = validatedSummary(totals);
  assert.equal(plain.request_count, "12");
  for (const field of ["days", "sites", "models"])
    assert.equal(Object.hasOwn(plain, field), false, field);
});

test("malformed, nested or oversized splits are refused, never passed through", () => {
  const reject = (change: (answer: any) => void, why: string) => {
    const answer: any = splitAnswer();
    change(answer);
    assert.throws(() => validatedSummary(answer), /payload_rejected/, why);
  };
  reject((a) => (a.days["2026-10-1"] = splitPart(1)), "short day key");
  reject((a) => (a.days["2026-02-30"] = splitPart(1)), "impossible date");
  reject((a) => (a.days = [splitPart(1)]), "days as a list");
  reject((a) => (a.sites.copilot = splitPart(1)), "unknown tool");
  reject((a) => (a.models["GPT 6"] = splitPart(1, { site: "chatgpt" })), "model key outside the id pattern");
  reject((a) => delete a.models["claude-opus-5-5"].site, "model part without its tool");
  reject((a) => (a.models["claude-opus-5-5"].site = "copilot"), "model part with an unknown tool");
  reject((a) => (a.sites.claude.days = { "2026-10-01": splitPart(1) }), "nested splits");
  reject((a) => (a.days["2026-10-01"].models = {}), "nested empty splits");
  reject((a) => (a.sites.chatgpt.aggregate_status = "unknown"), "part with an invalid status");
  reject((a) => (a.days["2026-10-01"].request_count = "-1"), "part with an invalid count");
  reject((a) => (a.sites.chatgpt = null), "missing part");
  reject((a) => {
    a.aggregate_status = "suppressed";
    a.suppressed = true;
  }, "splits beside withheld totals");
  reject((a) => {
    a.days = {};
    const start = Date.parse("2026-08-01T00:00:00Z");
    for (let i = 0; i < 63; i++)
      a.days[new Date(start + i * 86400000).toISOString().slice(0, 10)] = splitPart(1);
  }, "more than 62 days");
  reject((a) => {
    a.models = {};
    for (let i = 0; i < 201; i++) a.models[`chatgpt-model-${i}`] = splitPart(1, { site: "chatgpt" });
  }, "more than 200 models");
  // The largest answers the server can send still pass.
  const answer: any = splitAnswer();
  answer.days = {};
  const start = Date.parse("2026-08-01T00:00:00Z");
  for (let i = 0; i < 62; i++)
    answer.days[new Date(start + i * 86400000).toISOString().slice(0, 10)] = splitPart(1);
  answer.models = {};
  for (let i = 0; i < 200; i++) answer.models[`chatgpt-model-${i}`] = splitPart(1, { site: "chatgpt" });
  const out = validatedSummary(answer) as any;
  assert.equal(Object.keys(out.days).length, 62);
  assert.equal(Object.keys(out.models).length, 200);
});

test("the splits survive the cached copy that stands in when the server cannot be reached", async () => {
  const f = await fixture();
  try {
    f.company.authorized = async () => splitAnswer();
    const fresh = (await serverSummary(f.ledger, f.company, "company", "?period=all")) as any;
    assert.equal(fresh.days["2026-10-02"].request_count, "7");
    f.offline();
    f.company.authorized = async () => {
      throw new TypeError("Failed to fetch");
    };
    const cached = (await serverSummary(f.ledger, f.company, "company", "?period=all")) as any;
    assert.equal(cached.snapshot_source, "cached");
    assert.equal(cached.days["2026-10-02"].request_count, "7");
    assert.equal(cached.sites.chatgpt.request_count, "9");
    assert.equal(cached.models["claude-opus-5-5"].site, "claude");
    assert.ok(
      !JSON.stringify(await f.ledger.list("dashboard_cache", "company:test")).includes("must not persist"),
    );
  } finally {
    f.ledger.close();
  }
});

test("cached=only returns the saved copy of the same query without asking the server", async () => {
  const f = await fixture();
  try {
    const paths: string[] = [];
    const answer = f.company.authorized;
    f.company.authorized = async (path: string) => {
      paths.push(path);
      return answer(path);
    };
    // Nothing saved yet: the caller waits for the fresh answer.
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=all&splits=none&cached=only"),
      /summary_not_cached/,
    );
    assert.deepEqual(paths, []);
    await serverSummary(f.ledger, f.company, "company", "?period=all&splits=none");
    paths.length = 0;
    const copy = await serverSummary(f.ledger, f.company, "company", "?cached=only&splits=none&period=all");
    assert.deepEqual(paths, [], "a saved copy never contacts the server");
    assert.equal(copy.request_count, "12");
    assert.equal(copy.snapshot_source, "cached");
    assert.equal(copy.offline, false);
    assert.ok(copy.cached_at);
    // Another query, view or period has its own copy, or none.
    for (const query of ["?period=all&cached=only", "?period=month&splits=none&cached=only"])
      await assert.rejects(serverSummary(f.ledger, f.company, "company", query), /summary_not_cached/, query);
    await assert.rejects(
      serverSummary(f.ledger, f.company, "my", "?period=all&splits=none&cached=only"),
      /summary_not_cached/,
    );
    // The flag takes no other value and is not for conversation summaries.
    await assert.rejects(
      serverSummary(f.ledger, f.company, "company", "?period=all&cached=yes"),
      /payload_rejected/,
    );
    await assert.rejects(
      serverSummary(f.ledger, f.company, "my", "?cached=only", { key: "a".repeat(64), namespace: "company:test" }),
      /payload_rejected/,
    );
  } finally {
    f.ledger.close();
  }
});

test("a saved copy is not returned during an erasure or after a deletion epoch change", async () => {
  const f = await fixture();
  try {
    const query = "?period=all&splits=none";
    await serverSummary(f.ledger, f.company, "company", query);
    assert.equal((await serverSummary(f.ledger, f.company, "company", query + "&cached=only")).request_count, "12");
    // An erasure in progress hides every copy of the namespace.
    await f.ledger.put("deletion_markers", { key: "range:company:test:1", namespace: "company:test", status: "purging" });
    await assert.rejects(serverSummary(f.ledger, f.company, "company", query + "&cached=only"), /summary_not_cached/);
    await f.ledger.remove("deletion_markers", "range:company:test:1");
    assert.equal((await serverSummary(f.ledger, f.company, "company", query + "&cached=only")).request_count, "12");
    // A server-side deletion moves the deletion epoch.
    await f.ledger.put("policy", { ...f.credentials, policy: { ...f.credentials.policy, deletion_epoch: 1 } });
    await assert.rejects(serverSummary(f.ledger, f.company, "company", query + "&cached=only"), /summary_not_cached/);
  } finally {
    f.ledger.close();
  }
});
