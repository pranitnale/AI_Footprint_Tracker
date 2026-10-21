import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  UploadCorrelations,
  UPLOAD_CORRELATION_LIMITS as LIMITS,
} from "../lib/upload-correlation";
const evidence = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/provider-uploads-2026-09-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const file = (n = 1) => "file_" + n.toString(16).padStart(32, "0");
function cg(n = 1) {
  const identity = file(n),
    handle = crypto.randomUUID(),
    url = `https://storage.example/upload/${n}?signed=PRIVATE_URL_MARKER`;
  return {
    identity,
    handle,
    url,
    reservation: {
      method: "POST",
      path: evidence.chatgpt.reservation.path,
      transport: "Fetch",
      status: 200,
      eligible: true,
      reservationId: identity,
      uploadUrl: url,
      fileHandle: handle,
    },
    upload: {
      method: "PUT",
      transport: "XHR",
      url,
      status: 201,
      outcome: "success",
      fileHandle: handle,
    },
    claim: {
      method: "POST",
      path: `/backend-api/files/upload_reservations/${identity}/claim_and_finish`,
      transport: "Fetch",
      status: 200,
      outcome: "success",
      reservationId: identity,
      events: evidence.chatgpt.claim.events.map((event: string) => ({
        event,
        fileId: identity,
      })),
    },
    attachment: {
      ...evidence.chatgpt.generation.attachment,
      id: identity,
      name: "PRIVATE_FILENAME_MARKER",
    },
  };
}
function pp() {
  const client = crypto.randomUUID(),
    identity = crypto.randomUUID(),
    handle = crypto.randomUUID(),
    bucket = "https://ppl-ai-file-upload.s3.amazonaws.com/",
    key = `uploads/${identity}/PRIVATE_NAME_MARKER.txt`,
    url = bucket + key;
  return {
    identity,
    handle,
    url,
    reservation: {
      method: "POST",
      path: evidence.perplexity.reservation.path,
      transport: "Fetch",
      status: 200,
      clientId: client,
      resultClientId: client,
      fileId: identity,
      bucketUrl: bucket,
      objectUrl: url,
      formKey: key,
      rateLimited: false,
      error: null,
      fileHandle: handle,
    },
    upload: {
      method: "POST",
      transport: "Fetch",
      url: bucket,
      formKey: key,
      multipart: true,
      status: 204,
      outcome: "success",
      fileHandle: handle,
    },
  };
}
const chat = (attachments: any[], captureId: string = crypto.randomUUID()) => ({
  method: "POST",
  path: evidence.chatgpt.generation.path,
  transport: "Fetch",
  captureId,
  messageCount: 1,
  attachments,
});
const perplex = (
  attachments: string[],
  captureId: string = crypto.randomUUID(),
) => ({
  method: "POST",
  path: evidence.perplexity.generation.path,
  transport: "Fetch",
  captureId,
  attachments,
});
function ready(m: UploadCorrelations, x: ReturnType<typeof cg>) {
  const e = m.context();
  m.reserveChatGPT(e, x.reservation);
  assert.equal(m.uploadChatGPT(e, x.upload), true);
  assert.equal(m.claimChatGPT(e, x.claim), true);
}

test("ChatGPT exact reservation/upload/claim/dispatch relation returns only opaque local handles", () => {
  const m = new UploadCorrelations(),
    x = cg(),
    y = cg(2),
    e = m.context();
  ready(m, x);
  ready(m, y);
  const d = chat([x.attachment]),
    result = m.consumeChatGPT(e, d);
  assert.deepEqual(result, {
    captureId: d.captureId,
    status: "matched",
    unmatchedReferenceCount: 0,
    files: [{ fileHandle: x.handle, origin: "new_upload" }],
  });
  for (const marker of [
    x.identity,
    x.url,
    "PRIVATE_FILENAME_MARKER",
    "PRIVATE_URL_MARKER",
  ])
    assert.ok(!JSON.stringify(result).includes(marker));
  result.files.length = 0;
  assert.equal(m.consumeChatGPT(e, d).files.length, 1);
  assert.equal(m.consumeChatGPT(e, chat([x.attachment])).status, "unavailable");
  assert.equal(
    m.consumeChatGPT(e, chat([y.attachment])).files[0].fileHandle,
    y.handle,
  );
  assert.throws(
    () => m.consumeChatGPT(e, chat([y.attachment], d.captureId)),
    /rejected/,
  );
});

test("Perplexity uses returned file UUID, exact object URL and native multipart key, never client UUID", () => {
  const m = new UploadCorrelations(),
    x = pp(),
    y = pp(),
    e = m.context();
  m.reservePerplexity(e, x.reservation);
  m.reservePerplexity(e, y.reservation);
  assert.throws(
    () => m.uploadPerplexity(e, { ...x.upload, formKey: y.upload.formKey }),
    /rejected/,
  );
  assert.throws(
    () => m.uploadPerplexity(e, { ...x.upload, url: x.url }),
    /rejected/,
  );
  assert.throws(
    () => m.uploadPerplexity(e, { ...x.upload, multipart: false }),
    /rejected/,
  );
  assert.equal(m.uploadPerplexity(e, x.upload), true);
  assert.equal(
    m.consumePerplexity(e, perplex([x.url + "?different"])).status,
    "unavailable",
  );
  const d = perplex([x.url]);
  const result = m.consumePerplexity(e, d);
  assert.equal(result.files[0].fileHandle, x.handle);
  assert.deepEqual(m.consumePerplexity(e, d), result);
  assert.equal(m.consumePerplexity(e, perplex([x.url])).files.length, 0);
  for (const secret of [
    x.identity,
    x.url,
    x.reservation.clientId,
    "PRIVATE_NAME_MARKER",
  ])
    assert.ok(!JSON.stringify(result).includes(secret));
});

for (const provider of ["chatgpt", "perplexity"] as const)
  test(`${provider} first dispatch can advance after prerequisites finish, later captures cannot steal it`, () => {
    const m = new UploadCorrelations(),
      e = m.context();
    if (provider === "chatgpt") {
      const x = cg();
      m.reserveChatGPT(e, x.reservation);
      const first = chat([x.attachment]),
        later = chat([x.attachment]);
      assert.equal(m.consumeChatGPT(e, first).status, "unavailable");
      m.uploadChatGPT(e, x.upload);
      assert.equal(m.consumeChatGPT(e, later).status, "unavailable");
      m.claimChatGPT(e, x.claim);
      assert.equal(m.consumeChatGPT(e, later).status, "unavailable");
      assert.equal(m.consumeChatGPT(e, first).status, "matched");
    } else {
      const x = pp(),
        first = perplex([x.url]),
        later = perplex([x.url]);
      assert.equal(m.consumePerplexity(e, first).status, "unavailable");
      m.reservePerplexity(e, x.reservation);
      m.uploadPerplexity(e, x.upload);
      assert.equal(m.consumePerplexity(e, later).status, "unavailable");
      assert.equal(m.consumePerplexity(e, first).status, "matched");
    }
  });

test("partial and observed-empty states never turn unmatched references into an empty extraction claim", () => {
  const m = new UploadCorrelations(),
    e = m.context(),
    x = cg();
  ready(m, x);
  const result = m.consumeChatGPT(e, chat([x.attachment, cg(9).attachment]));
  assert.equal(result.status, "partial");
  assert.equal(result.unmatchedReferenceCount, 1);
  const empty = m.consumeChatGPT(e, chat([]));
  assert.equal(empty.status, "observed_empty");
  assert.equal(empty.files.length, 0);
  assert.throws(
    () => m.consumeChatGPT(e, chat([x.attachment, x.attachment])),
    /rejected/,
  );
  assert.throws(() => m.consumeChatGPT(e, chat(Array(2))), /rejected/);
  assert.throws(
    () => m.consumeChatGPT(e, chat(Array(17).fill(x.attachment))),
    /rejected/,
  );
});

for (const outcome of ["failure", "aborted"] as const)
  test(`failed or aborted native upload and claim (${outcome}) remain unavailable`, () => {
    for (const stage of ["upload", "claim", "perplexity"]) {
      const m = new UploadCorrelations(),
        e = m.context();
      if (stage === "perplexity") {
        const x = pp();
        m.reservePerplexity(e, x.reservation);
        assert.equal(
          m.uploadPerplexity(e, { ...x.upload, outcome, status: 0 }),
          false,
        );
        assert.equal(
          m.consumePerplexity(e, perplex([x.url])).status,
          "unavailable",
        );
      } else {
        const x = cg();
        m.reserveChatGPT(e, x.reservation);
        if (stage === "upload")
          assert.equal(
            m.uploadChatGPT(e, { ...x.upload, outcome, status: 0 }),
            false,
          );
        else {
          m.uploadChatGPT(e, x.upload);
          assert.equal(
            m.claimChatGPT(e, { ...x.claim, outcome, status: 500 }),
            false,
          );
        }
        assert.equal(
          m.consumeChatGPT(e, chat([x.attachment])).status,
          "unavailable",
        );
        assert.throws(() => m.claimChatGPT(e, x.claim), /rejected/);
      }
    }
  });

test("claim requires complete observed event sequence and equal file IDs; malformed metadata cannot retain ready state", () => {
  for (const mutate of [
    (x: any) => ({ ...x, events: x.events.slice(0, 3) }),
    (x: any) => ({
      ...x,
      events: x.events.map((v: any, i: number) =>
        i === 1 ? { ...v, fileId: file(9) } : v,
      ),
    }),
    (x: any) => ({ ...x, events: [{}, ...x.events.slice(1)] }),
  ]) {
    const m = new UploadCorrelations(),
      x = cg(),
      e = m.context();
    m.reserveChatGPT(e, x.reservation);
    m.uploadChatGPT(e, x.upload);
    assert.throws(() => m.claimChatGPT(e, mutate(x.claim)), /rejected/);
    assert.equal(m.consumeChatGPT(e, chat([x.attachment])).files.length, 0);
    assert.throws(() => m.claimChatGPT(e, x.claim), /rejected/);
  }
});

test("strict route, status, URL and identity validation rejects conflicting reservations without disturbing unrelated uploads", () => {
  const m = new UploadCorrelations(),
    x = cg(),
    e = m.context();
  m.reserveChatGPT(e, x.reservation);
  for (const reservation of [
    { ...x.reservation, fileHandle: crypto.randomUUID() },
    { ...cg(2).reservation, uploadUrl: x.url },
    { ...cg(3).reservation, path: "/backend-api/files" },
    { ...cg(4).reservation, uploadUrl: "http://storage.example" },
    { ...cg(5).reservation, eligible: false },
    { ...cg(6).reservation, rawBody: "PRIVATE" },
  ])
    assert.throws(() => m.reserveChatGPT(e, reservation), /rejected/);
  assert.throws(
    () => m.uploadChatGPT(e, { ...x.upload, url: x.url + "&wrong" }),
    /rejected/,
  );
  m.uploadChatGPT(e, x.upload);
  m.claimChatGPT(e, x.claim);
  assert.equal(m.consumeChatGPT(e, chat([x.attachment])).status, "matched");
  const p = pp();
  for (const reservation of [
    { ...p.reservation, resultClientId: crypto.randomUUID() },
    { ...p.reservation, fileId: p.reservation.clientId },
    { ...p.reservation, rateLimited: true },
    { ...p.reservation, error: "PRIVATE" },
    { ...p.reservation, objectUrl: "https://storage.example/unrelated" },
  ])
    assert.throws(() => m.reservePerplexity(e, reservation), /rejected/);
  m.reservePerplexity(e, p.reservation);
  assert.equal(m.uploadPerplexity(e, { ...p.upload, status: 200 }), false);
  assert.equal(m.consumePerplexity(e, perplex([p.url])).status, "unavailable");
});

test("expiry drops associations but bounded seen tombstones reject replay until authoritative reset", () => {
  let now = 0;
  const m = new UploadCorrelations(() => now),
    e = m.context(),
    x = cg();
  ready(m, x);
  const d = chat([x.attachment]);
  m.consumeChatGPT(e, d);
  now = LIMITS.ttlMs;
  assert.throws(() => m.consumeChatGPT(e, d), /rejected/);
  assert.throws(() => m.reserveChatGPT(e, x.reservation), /rejected/);
  assert.throws(() => m.uploadChatGPT(e, x.upload), /rejected/);
  m.reset();
  assert.throws(() => m.reserveChatGPT(e, cg(8).reservation), /rejected/);
  assert.throws(() => m.consumeChatGPT(e, chat([])), /rejected/);
  ready(m, x);
  assert.equal(
    m.consumeChatGPT(m.context(), chat([x.attachment])).status,
    "matched",
  );
});

test("active, seen and capture floods fail explicitly without evicting replay guards", () => {
  let now = 0;
  const m = new UploadCorrelations(() => now),
    e = m.context();
  for (let n = 1; n <= LIMITS.active; n++)
    m.reserveChatGPT(e, cg(n).reservation);
  assert.throws(() => m.reserveChatGPT(e, cg(1000).reservation), /capacity/);
  now += LIMITS.ttlMs;
  for (let n = 65; n <= 128; n++) m.reserveChatGPT(e, cg(n).reservation);
  now += LIMITS.ttlMs;
  assert.throws(() => m.reserveChatGPT(e, cg(1001).reservation), /capacity/);
  assert.throws(() => m.reserveChatGPT(e, cg(1).reservation), /rejected/);
  m.reset();
  const next = m.context();
  for (let n = 0; n < LIMITS.captures; n++) m.consumeChatGPT(next, chat([]));
  now += LIMITS.ttlMs;
  assert.throws(() => m.consumeChatGPT(next, chat([])), /capacity/);
});

test("sweep releases expired private locators and one local handle cannot be reused across providers", () => {
  let now = 0;
  const m = new UploadCorrelations(() => now),
    e = m.context(),
    x = cg();
  m.reserveChatGPT(e, x.reservation);
  m.uploadChatGPT(e, x.upload);
  assert.equal((m as any).uploads.get(x.handle).uploadUrl, undefined);
  now = LIMITS.ttlMs;
  m.sweep(e);
  assert.equal((m as any).uploads.size, 0);
  const p = pp();
  assert.throws(
    () => m.reservePerplexity(e, { ...p.reservation, fileHandle: x.handle }),
    /rejected/,
  );
  m.reservePerplexity(e, p.reservation);
  m.uploadPerplexity(e, p.upload);
  assert.equal((m as any).uploads.get(p.handle).formKey, undefined);
  assert.equal((m as any).uploads.get(p.handle).uploadUrl, undefined);
  m.consumePerplexity(e, perplex([p.url]));
  assert.equal((m as any).uploads.get(p.handle).objectUrl, undefined);
});

for (const expired of [false, true])
  test(`ChatGPT consumed signed URL cannot be reused under another file identity (expired=${expired})`, () => {
    let now = 0;
    const m = new UploadCorrelations(() => now),
      e = m.context(),
      a = cg(1),
      b = cg(2);
    ready(m, a);
    const first = m.consumeChatGPT(e, chat([a.attachment]));
    assert.equal(first.files.length, 1);
    if (expired) {
      now = LIMITS.ttlMs + 1;
      m.sweep(e);
    }
    b.reservation.uploadUrl = a.url;
    b.upload.url = a.url;
    assert.throws(() => m.reserveChatGPT(e, b.reservation), /rejected/);
    b.reservation.uploadUrl = cg(90).url;
    b.upload.url = b.reservation.uploadUrl;
    m.reserveChatGPT(e, b.reservation);
    m.uploadChatGPT(e, b.upload);
    m.claimChatGPT(e, b.claim);
    assert.equal(m.consumeChatGPT(e, chat([b.attachment])).files.length, 1);
  });

for (const collision of ["object", "formKey"] as const)
  test(`Perplexity spent ${collision} rejects a conflicting identity after locator release without duplicating one reference`, () => {
    const m = new UploadCorrelations(),
      e = m.context(),
      a = pp(),
      b = pp();
    const shared = a.reservation.bucketUrl + a.identity + "/" + b.identity;
    a.reservation.objectUrl = shared;
    b.reservation.objectUrl = collision === "object" ? shared : b.url;
    if (collision === "formKey") {
      b.reservation.formKey = a.reservation.formKey;
      b.upload.formKey = a.upload.formKey;
    }
    m.reservePerplexity(e, a.reservation);
    m.uploadPerplexity(e, a.upload);
    const first = perplex([shared]);
    const before = m.consumePerplexity(e, first);
    assert.equal(before.files.length, 1);
    assert.throws(() => m.reservePerplexity(e, b.reservation), /rejected/);
    assert.deepEqual(m.consumePerplexity(e, first), before);
    assert.equal(m.consumePerplexity(e, first).unmatchedReferenceCount, 0);
  });

for (const provider of ["chatgpt", "perplexity"] as const)
  test(`${provider} expired unknown reference retains first-capture ownership through late reservation`, () => {
    let now = 0;
    const m = new UploadCorrelations(() => now),
      e = m.context();
    if (provider === "chatgpt") {
      const x = cg(),
        first = chat([x.attachment]);
      assert.equal(m.consumeChatGPT(e, first).status, "unavailable");
      now = LIMITS.ttlMs + 1;
      m.sweep(e);
      ready(m, x);
      assert.equal(
        m.consumeChatGPT(e, chat([x.attachment])).status,
        "unavailable",
      );
      assert.throws(() => m.consumeChatGPT(e, first), /rejected/);
    } else {
      const x = pp(),
        first = perplex([x.url]);
      assert.equal(m.consumePerplexity(e, first).status, "unavailable");
      now = LIMITS.ttlMs + 1;
      m.sweep(e);
      m.reservePerplexity(e, x.reservation);
      m.uploadPerplexity(e, x.upload);
      assert.equal(
        m.consumePerplexity(e, perplex([x.url])).status,
        "unavailable",
      );
      assert.throws(() => m.consumePerplexity(e, first), /rejected/);
    }
  });

test("reference-ownership capacity rejects an entire dispatch atomically and never evicts expired owners", () => {
  let now = 0;
  const m = new UploadCorrelations(() => now),
    e = m.context();
  for (let page = 0; page < 15; page++)
    m.consumeChatGPT(
      e,
      chat(
        Array.from({ length: 16 }, (_, i) => cg(page * 16 + i + 1).attachment),
      ),
    );
  m.consumeChatGPT(
    e,
    chat(Array.from({ length: 15 }, (_, i) => cg(241 + i).attachment)),
  );
  const a = cg(999),
    b = cg(1000);
  ready(m, a);
  ready(m, b);
  assert.throws(
    () => m.consumeChatGPT(e, chat([a.attachment, b.attachment])),
    /capacity/,
  );
  assert.equal(m.consumeChatGPT(e, chat([a.attachment])).status, "matched");
  now = LIMITS.ttlMs + 1;
  m.sweep(e);
  assert.throws(() => m.consumeChatGPT(e, chat([b.attachment])), /capacity/);
  m.reset();
  ready(m, b);
  assert.equal(
    m.consumeChatGPT(m.context(), chat([b.attachment])).status,
    "matched",
  );
});

test("conflicting reference sets do not consume an independently ready file in partial batches", () => {
  const m = new UploadCorrelations(),
    e = m.context(),
    a = cg(1),
    b = cg(2);
  ready(m, a);
  ready(m, b);
  const first = chat([a.attachment, cg(3).attachment]);
  assert.equal(m.consumeChatGPT(e, first).status, "partial");
  assert.throws(
    () =>
      m.consumeChatGPT(e, chat([a.attachment, b.attachment], first.captureId)),
    /rejected/,
  );
  assert.equal(m.consumeChatGPT(e, chat([b.attachment])).status, "matched");
  assert.equal(m.consumeChatGPT(e, first).unmatchedReferenceCount, 1);
});

for (const wireRole of ["fileId", "clientId"] as const)
  test(`provider ${wireRole} cannot masquerade as a local handle or capture capability`, () => {
    const m = new UploadCorrelations(),
      e = m.context(),
      p = pp();
    assert.throws(
      () =>
        m.reservePerplexity(e, {
          ...p.reservation,
          fileHandle: p.reservation[wireRole],
        }),
      /rejected/,
    );
    m.reservePerplexity(e, p.reservation);
    m.uploadPerplexity(e, p.upload);
    assert.throws(
      () => m.consumePerplexity(e, perplex([p.url], p.reservation[wireRole])),
      /rejected/,
    );
    assert.equal(
      m.consumePerplexity(e, perplex([p.url])).files[0].fileHandle,
      p.handle,
    );
  });

for (const localRole of ["context", "handle", "capture"] as const)
  test(`later provider identities cannot collide with an existing ${localRole} capability`, () => {
    const m = new UploadCorrelations(),
      e = m.context(),
      first = pp();
    m.reservePerplexity(e, first.reservation);
    const capture = crypto.randomUUID();
    m.consumePerplexity(e, perplex([], capture));
    const local =
      localRole === "context"
        ? e
        : localRole === "handle"
          ? first.handle
          : capture;
    for (const wireRole of ["clientId", "fileId"] as const) {
      const p = pp();
      const changed: Record<string, any> = {
        ...p.reservation,
        [wireRole]: local,
      };
      if (wireRole === "clientId") changed.resultClientId = local;
      else changed.objectUrl = changed.bucketUrl + local + "/file";
      assert.throws(() => m.reservePerplexity(e, changed), /rejected/);
      m.reservePerplexity(e, p.reservation);
    }
  });

test("local role collisions and reverse wire-to-handle collisions reject atomically after active expiry", () => {
  let now = 0;
  const m = new UploadCorrelations(() => now),
    e = m.context(),
    p = pp();
  m.reservePerplexity(e, p.reservation);
  const capture = crypto.randomUUID();
  m.consumePerplexity(e, perplex([], capture));
  for (const local of [e, p.handle])
    assert.throws(() => m.consumePerplexity(e, perplex([], local)), /rejected/);
  for (const local of [e, capture]) {
    const q = pp();
    assert.throws(
      () => m.reservePerplexity(e, { ...q.reservation, fileHandle: local }),
      /rejected/,
    );
    m.reservePerplexity(e, q.reservation);
  }
  now = LIMITS.ttlMs + 1;
  m.sweep(e);
  const q = pp();
  assert.throws(
    () => m.reservePerplexity(e, { ...q.reservation, fileHandle: p.identity }),
    /rejected/,
  );
  m.reset();
  assert.throws(() => m.reservePerplexity(e, q.reservation), /rejected/);
  m.reservePerplexity(m.context(), q.reservation);
});
