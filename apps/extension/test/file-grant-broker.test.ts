import assert from "node:assert/strict";
import test from "node:test";
import { countAccessibleFile } from "@footprint/file-text";
import {
  unavailable,
  type AccessibleFileJob,
} from "@footprint/file-text/types";
import {
  FileGrantBroker,
  type FileBrokerDependencies,
} from "../lib/file-grant-broker";
import { FILE_RELAY_LIMITS } from "../lib/file-relay-protocol";
const root = "chrome-extension://synthetic/";
const parent = {
  id: "synthetic",
  url: "https://chatgpt.com/",
  tab: { id: 5 },
  frameId: 0,
  documentId: "parent-doc",
};
const relay = {
  id: "synthetic",
  url: root + "file-relay.html",
  tab: { id: 5 },
  frameId: 9,
  documentId: "relay-doc",
};
const client = { url: relay.url, id: "actual-client" };
function setup(overrides: Partial<FileBrokerDependencies> = {}) {
  let calls = 0,
    basis = "scopeA-era1-erasure0";
  const broker = new FileGrantBroker({
    extensionId: "synthetic",
    relayUrl: relay.url,
    snapshot: async () => basis,
    parentCurrent: async () => true,
    count: async (job, signal) => {
      calls++;
      return countAccessibleFile(job, { signal });
    },
    ...overrides,
  });
  const request = {
    target: "file-grant",
    fileHandle: crypto.randomUUID(),
    kind: "text",
    size: 5,
    binding: {
      documentNonce: crypto.randomUUID(),
      navigationNonce: crypto.randomUUID(),
      captureId: null,
    },
    observedAt: overrides.clock?.() ?? Date.now(),
  };
  return {
    broker,
    request,
    calls: () => calls,
    change: () => {
      basis = "scopeB-era2-erasure1";
    },
  };
}
async function granted(f: ReturnType<typeof setup>, firefox = false) {
  const grant = await f.broker.issue(f.request, parent);
  assert.equal(grant.status, "granted");
  if (grant.status !== "granted") throw Error();
  const nonce = crypto.randomUUID();
  const redeemed = await f.broker.redeem(
    {
      target: "file-relay-redeem",
      grant: grant.grant,
      parentOrigin: new URL(parent.url).origin,
      relayNonce: nonce,
    },
    relay,
  );
  assert.equal(redeemed.status, "redeemed");
  const registered = {
    target: "file-relay-register",
    token: redeemed.token,
    relayNonce: nonce,
  };
  if (!firefox)
    assert.deepEqual(await f.broker.register(registered, client), {
      status: "ready",
    });
  const message = {
    target: "file-relay-count",
    token: redeemed.token,
    relayNonce: nonce,
    job: {
      jobId: redeemed.spec.jobId,
      revision: 1,
      kind: "text",
      bytes: new TextEncoder().encode("hello").buffer,
    },
  };
  return { grant, redeemed, registered, message };
}

test("broker returns only status to relay and retains strictly unassociated validated numerical receipt", async () => {
  const f = setup();
  try {
    const g = await granted(f);
    assert.deepEqual(await f.broker.submit(g.message, client), {
      status: "complete",
    });
    const result = await (f.broker as any).getUnassociated(
      f.request.fileHandle,
    );
    assert.equal(result?.tokens, "1");
    assert.equal(result?.association, "unassociated");
    assert.equal(result?.telemetryAllowed, false);
    assert.equal(result?.inputBytes, 5);
    assert.ok(!JSON.stringify(result).includes("hello"));
    assert.equal(f.calls(), 1);
    assert.equal(
      (await f.broker.submit(g.message, client)).status,
      "unavailable",
    );
  } finally {
    f.broker.invalidate();
  }
});

for (const change of [
  { id: "other" },
  { url: "https://unapproved.example/" },
  { frameId: 3 },
  { tab: undefined },
])
  test(`forged parent cannot request a grant ${JSON.stringify(change)}`, async () => {
    const f = setup();
    assert.equal(
      (await f.broker.issue(f.request, { ...parent, ...change })).status,
      "unavailable",
    );
    assert.equal(f.calls(), 0);
    f.broker.invalidate();
  });

test("strict grant payload forbids tenant overrides, stale native time, oversized file and conflicting origin", async () => {
  const f = setup();
  for (const message of [
    { ...f.request, tenant: "other" },
    { ...f.request, size: FILE_RELAY_LIMITS.inputBytes + 1 },
    { ...f.request, observedAt: Date.now() - 30001 },
    { ...f.request, observedAt: Date.now() + 10000 },
    { ...f.request, binding: { ...f.request.binding, epoch: 9 } },
  ])
    assert.equal((await f.broker.issue(message, parent)).status, "unavailable");
  assert.equal(f.calls(), 0);
  const grant = await f.broker.issue(f.request, parent);
  assert.equal(grant.status, "granted");
  f.broker.invalidate();
});

test("relay redemption binds exact extension frame, parent origin, nonce and one-time grant", async () => {
  const f = setup();
  try {
    const g = await f.broker.issue(f.request, parent);
    if (g.status !== "granted") throw Error();
    const body = {
      target: "file-relay-redeem",
      grant: g.grant,
      parentOrigin: "https://chatgpt.com",
      relayNonce: crypto.randomUUID(),
    };
    for (const sender of [
      { ...relay, id: "forged" },
      { ...relay, url: relay.url + "?grant=bad" },
      { ...relay, frameId: 0 },
      { ...relay, tab: { id: 8 } },
    ])
      assert.equal((await f.broker.redeem(body, sender)).status, "unavailable");
    assert.equal(
      (
        await f.broker.redeem(
          { ...body, parentOrigin: "https://claude.ai" },
          relay,
        )
      ).status,
      "unavailable",
    );
    assert.equal((await f.broker.redeem(body, relay)).status, "redeemed");
    assert.equal((await f.broker.redeem(body, relay)).status, "unavailable");
  } finally {
    f.broker.invalidate();
  }
});

for (const firefox of [false, true])
  test(`bytes reject forged client/frame, duplicate submission and wrong length (${firefox ? "Firefox" : "Chromium"})`, async () => {
    const f = setup();
    try {
      const g = await granted(f, firefox);
      assert.equal(
        (
          await f.broker.submit(
            g.message,
            firefox
              ? { ...relay, documentId: "other" }
              : { ...client, id: "other" },
            firefox,
          )
        ).status,
        "unavailable",
      );
      assert.equal(
        (
          await f.broker.submit(
            { ...g.message, token: crypto.randomUUID() },
            firefox ? relay : client,
            firefox,
          )
        ).status,
        "unavailable",
      );
      assert.equal(
        (
          await f.broker.submit(
            {
              ...g.message,
              job: { ...g.message.job, bytes: new ArrayBuffer(4) },
            },
            firefox ? relay : client,
            firefox,
          )
        ).status,
        "unavailable",
      );
      assert.equal(f.calls(), 0);
      assert.equal(
        await (f.broker as any).getUnassociated(f.request.fileHandle),
        null,
      );
    } finally {
      f.broker.invalidate();
    }
  });

test("flood admission precedes asynchronous authorization and cancellation retains unresolved physical slot", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: () => void,
    reads = 0;
  const wait = new Promise<void>((r) => (release = r));
  const f = setup({
    snapshot: async () => {
      reads++;
      await wait;
      return "scope";
    },
  });
  const first = f.broker.issue(f.request, parent);
  await new Promise(setImmediate);
  const flood = await Promise.all(
    Array.from({ length: 50 }, () =>
      f.broker.issue({ ...f.request, fileHandle: crypto.randomUUID() }, parent),
    ),
  );
  assert.ok(flood.every((x) => x.status === "unavailable"));
  assert.equal(reads, 1);
  t.mock.timers.tick(30000);
  assert.equal((await first).status, "unavailable");
  assert.equal(
    (
      await f.broker.issue(
        { ...f.request, fileHandle: crypto.randomUUID() },
        parent,
      )
    ).status,
    "unavailable",
  );
  assert.equal(reads, 1);
  release();
  await new Promise(setImmediate);
  assert.equal(f.broker.isBusy(), false);
  f.broker.invalidate();
});

for (const phase of ["count", "final-check"] as const)
  test(`scope or erasure change during ${phase} cannot cache or relabel a result`, async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      wait = new Promise<void>((r) => (release = r));
    let checks = 0;
    let f: ReturnType<typeof setup>;
    f = setup({
      count: async (job) => {
        if (phase === "count") {
          enter();
          await wait;
        }
        return countAccessibleFile(job);
      },
      parentCurrent: async () => {
        checks++;
        if (phase === "final-check" && checks === 5) {
          enter();
          await wait;
        }
        return true;
      },
    });
    try {
      const g = await granted(f);
      const work = f.broker.submit(g.message, client);
      await entered;
      f.change();
      release();
      assert.equal((await work).status, "unavailable");
      assert.equal(
        await (f.broker as any).getUnassociated(f.request.fileHandle),
        null,
      );
    } finally {
      release();
      f.broker.invalidate();
    }
  });

for (const change of [
  "asset",
  "size",
  "identity",
  "missing",
  "token-bound",
] as const)
  test(`malformed worker ${change} cannot become a numerical receipt`, async () => {
    const f = setup({
      count: async (job) => {
        const result = await countAccessibleFile(job);
        if (change === "asset") result.tokenizerAssetHash = "a".repeat(64);
        if (change === "size") result.inputBytes = 4;
        if (change === "identity") result.jobId = crypto.randomUUID();
        if (change === "missing") result.missing = [];
        if (change === "token-bound") result.tokens = "99";
        return result;
      },
    });
    try {
      const g = await granted(f);
      assert.equal(
        (await f.broker.submit(g.message, client)).status,
        "unavailable",
      );
      assert.equal(
        await (f.broker as any).getUnassociated(f.request.fileHandle),
        null,
      );
    } finally {
      f.broker.invalidate();
    }
  });

test("receipt binds once to actual capture and survives composing, but not parent cancellation or five-minute expiry", async () => {
  let now = Date.now();
  let allowedCapture: string | null = null;
  const f = setup({
    clock: () => now,
    parentCurrent: async (p) => p.captureId === allowedCapture,
  });
  try {
    const g = await granted(f);
    await f.broker.submit(g.message, client);
    now += 120000;
    assert.equal(
      (await (f.broker as any).getUnassociated(f.request.fileHandle))?.tokens,
      "1",
    );
    allowedCapture = crypto.randomUUID();
    const bind = {
      target: "file-receipt-bind",
      binding: f.request.binding,
      fileHandle: f.request.fileHandle,
      captureId: allowedCapture,
    };
    assert.deepEqual(
      await f.broker.bind(bind, {
        ...parent,
        url: "https://chatgpt.com/c/synthetic",
      }),
      { bound: true },
    );
    assert.equal(
      (await (f.broker as any).getUnassociated(f.request.fileHandle))?.tokens,
      "1",
    );
    assert.deepEqual(
      await f.broker.bind({ ...bind, captureId: crypto.randomUUID() }, parent),
      { bound: false },
    );
    f.broker.cancel(
      {
        target: "file-grant-cancel",
        binding: f.request.binding,
        fileHandle: f.request.fileHandle,
      },
      parent,
    );
    assert.equal(
      await (f.broker as any).getUnassociated(f.request.fileHandle),
      null,
    );
  } finally {
    f.broker.invalidate();
  }
});

test("missing worker stays explicit unavailable and timeout prevents late physical completion from publishing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release!: (value: any) => void;
  let physicalJob: AccessibleFileJob | undefined;
  const f = setup({
    count: async (job) => {
      physicalJob = job;
      return new Promise((r) => (release = r));
    },
  });
  try {
    const g = await granted(f);
    const work = f.broker.submit(g.message, client);
    while (!physicalJob) await new Promise(setImmediate);
    t.mock.timers.tick(30000);
    assert.equal((await work).status, "unavailable");
    assert.equal(f.broker.isBusy(), true);
    release(unavailable(physicalJob, "worker_unavailable"));
    await new Promise(setImmediate);
    assert.equal(f.broker.isBusy(), false);
    assert.equal(
      await (f.broker as any).getUnassociated(f.request.fileHandle),
      null,
    );
  } finally {
    f.broker.invalidate();
  }
});

for (const scenario of [
  { kind: "text", change: "pages" },
  { kind: "text", change: "parts" },
  { kind: "pdf", change: "pages" },
  { kind: "pptx", change: "parts" },
  { kind: "docx", change: "pages" },
  { kind: "xlsx", change: "pages" },
  { kind: "docx", change: "layout" },
  { kind: "pptx", change: "visibility" },
  { kind: "xlsx", change: "formula" },
  { kind: "docx", change: "font" },
  { kind: "text", change: "cancel-reason" },
] as const)
  test(`contradictory ${scenario.kind} ${scenario.change} worker metadata is rejected`, async () => {
    const f = setup({
      count: async (job) => {
        const result = await countAccessibleFile({ ...job, kind: "text" });
        result.kind = job.kind;
        if (job.kind !== "text") {
          result.missing.push("layout_and_drawing_text", "rendered_visibility");
          if (job.kind === "pdf" || job.kind === "pptx") result.pages = 1;
          if (job.kind === "xlsx") result.missing.push("formula_recalculation");
        }
        if (scenario.change === "pages")
          result.pages = result.pages === null ? 1 : 0;
        if (scenario.change === "parts") result.textParts = 2;
        if (scenario.change === "layout")
          result.missing = result.missing.filter(
            (x) => x !== "layout_and_drawing_text",
          );
        if (scenario.change === "visibility")
          result.missing = result.missing.filter(
            (x) => x !== "rendered_visibility",
          );
        if (scenario.change === "formula")
          result.missing = result.missing.filter(
            (x) => x !== "formula_recalculation",
          );
        if (scenario.change === "font")
          result.missing.push("external_font_mapping");
        if (scenario.change === "cancel-reason")
          return { ...unavailable(job, "cancelled"), status: "unavailable" };
        return result;
      },
    });
    f.request.kind = scenario.kind;
    try {
      const g = await granted(f);
      g.message.job.kind = scenario.kind;
      assert.equal(
        (await f.broker.submit(g.message, client)).status,
        "unavailable",
      );
      assert.equal(
        await (f.broker as any).getUnassociated(f.request.fileHandle),
        null,
      );
    } finally {
      f.broker.invalidate();
    }
  });

test("trusted receipt read requires exact sender, document, binding and one-time capture association", async () => {
  const basis = {
    scope: {
      namespace: "personal:synthetic",
      mode: "personal",
      era: "synthetic",
    },
    erasureVersion: 0,
    ownershipStart: 0,
    ownershipEnd: null,
    deviceId: null,
    enrollmentState: null,
  };
  const f = setup({ snapshot: async () => JSON.stringify(basis) });
  try {
    const g = await granted(f);
    const captureId = crypto.randomUUID();
    const lookup = {
      binding: f.request.binding,
      fileHandle: f.request.fileHandle,
      captureId,
    };
    assert.equal(
      (await f.broker.readReceipt(lookup, parent)).status,
      "unavailable",
    );
    assert.deepEqual(
      await f.broker.bind({ target: "file-receipt-bind", ...lookup }, parent),
      { bound: true },
    );
    assert.equal(
      (await f.broker.readReceipt(lookup, parent)).status,
      "pending",
    );
    await f.broker.submit(g.message, client);
    const result = await f.broker.readReceipt(lookup, parent);
    assert.equal(result.status, "complete");
    assert.deepEqual(result.basis, basis);
    assert.equal(result.observedAt, f.request.observedAt);
    assert.equal(result.result?.tokens, "1");
    for (const sender of [
      { ...parent, tab: { id: 8 } },
      { ...parent, documentId: "other" },
      { ...parent, frameId: 3 },
    ])
      assert.equal((await f.broker.readReceipt(lookup, sender)).result, null);
    for (const value of [
      { ...lookup, captureId: crypto.randomUUID() },
      {
        ...lookup,
        binding: { ...lookup.binding, navigationNonce: crypto.randomUUID() },
      },
    ])
      assert.equal((await f.broker.readReceipt(value, parent)).result, null);
  } finally {
    f.broker.invalidate();
  }
});

test("receipt completion callbacks coalesce cancellation and bounded metadata expires without exposing numbers to another scope", async () => {
  let now = Date.now();
  const basis = JSON.stringify({
    scope: { namespace: "personal:test", mode: "personal", era: null },
    erasureVersion: 0,
    ownershipStart: 0,
    ownershipEnd: null,
    deviceId: null,
    enrollmentState: null,
  });
  const f = setup({ clock: () => now, snapshot: async () => basis });
  const notices: string[] = [];
  const unsubscribe = f.broker.onReceipt((handle) => notices.push(handle));
  try {
    const g = await granted(f);
    const captureId = crypto.randomUUID(),
      lookup = {
        binding: f.request.binding,
        captureId,
        fileHandle: f.request.fileHandle,
      };
    await f.broker.bind({ target: "file-receipt-bind", ...lookup }, parent);
    await f.broker.submit(g.message, client);
    assert.deepEqual(notices, [f.request.fileHandle]);
    assert.equal(
      (await f.broker.readReceipt(lookup, parent)).status,
      "complete",
    );
    now += FILE_RELAY_LIMITS.resultTtlMs + 1;
    const expired = await f.broker.readReceipt(lookup, parent);
    assert.equal(expired.status, "expired");
    assert.equal(expired.result, null);
    f.broker.invalidate();
    assert.equal((await f.broker.readReceipt(lookup, parent)).basis, null);
  } finally {
    unsubscribe();
    f.broker.invalidate();
  }
});

for (const scopeChanged of [false, true])
  test(`final snapshot retries stable refresh but rejects scope changes (${scopeChanged})`, async () => {
    let version = 0,
      checks = 0;
    let basis = "scope";
    const f = setup({
      routingVersion: () => version,
      snapshot: async () => {
        checks++;
        if (checks === 10)
          queueMicrotask(() => {
            version++;
            if (scopeChanged) basis = "new-scope";
          });
        return basis;
      },
    });
    try {
      const g = await granted(f);
      const result = await f.broker.submit(g.message, client);
      assert.equal(result.status, scopeChanged ? "unavailable" : "complete");
      const receipt = await (f.broker as any).getUnassociated(
        f.request.fileHandle,
      );
      if (scopeChanged) assert.equal(receipt, null);
      else {
        assert.equal(receipt.tokens, "1");
        assert.ok(checks >= 12);
      }
    } finally {
      f.broker.invalidate();
    }
  });

test("an unavailable worker receipt retains its scoped reason without claiming counted or empty extraction", async () => {
  const basis = {
    scope: { namespace: "personal:test", mode: "personal", era: null },
    erasureVersion: 0,
    ownershipStart: 0,
    ownershipEnd: null,
    deviceId: null,
    enrollmentState: null,
  };
  const f = setup({
    snapshot: async () => JSON.stringify(basis),
    count: async (job) => unavailable(job, "worker_unavailable"),
  });
  try {
    const g = await granted(f);
    const lookup = {
      binding: f.request.binding,
      fileHandle: f.request.fileHandle,
      captureId: crypto.randomUUID(),
    };
    await f.broker.bind({ target: "file-receipt-bind", ...lookup }, parent);
    assert.equal((await f.broker.submit(g.message, client)).status, "complete");
    const result = await f.broker.readReceipt(lookup, parent);
    assert.equal(result.status, "unavailable");
    assert.equal(result.result?.reason, "worker_unavailable");
    assert.equal(result.result?.tokens, null);
    assert.equal(result.result?.telemetryAllowed, false);
  } finally {
    f.broker.invalidate();
  }
});

for (const bytes of [
  new Uint8Array(),
  new Uint8Array([0xef, 0xbb, 0xbf]),
  new TextEncoder().encode("hello"),
  new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hello")]),
])
  test(`text receipt validates exact input/BOM byte accounting (${bytes.byteLength})`, async () => {
    const f = setup();
    f.request.size = bytes.byteLength;
    try {
      const g = await granted(f);
      g.message.job.bytes = bytes.slice().buffer;
      assert.equal(
        (await f.broker.submit(g.message, client)).status,
        "complete",
      );
      const result = await (f.broker as any).getUnassociated(
        f.request.fileHandle,
      );
      assert.equal(
        result.extractedTextBytes,
        bytes.byteLength >= 3 && bytes[0] === 0xef
          ? bytes.byteLength - 3
          : bytes.byteLength,
      );
      assert.equal(result.tokens, bytes.byteLength <= 3 ? "0" : "1");
    } finally {
      f.broker.invalidate();
    }
  });
for (const extracted of [0, 2, 4, 6])
  test(`text worker cannot replace actual 5-byte extraction with ${extracted} bytes`, async () => {
    const f = setup({
      count: async (job) => {
        const result = await countAccessibleFile(job);
        result.extractedTextBytes = extracted;
        if (!extracted) result.tokens = "0";
        return result;
      },
    });
    try {
      const g = await granted(f);
      assert.equal(
        (await f.broker.submit(g.message, client)).status,
        "unavailable",
      );
      assert.equal(
        await (f.broker as any).getUnassociated(f.request.fileHandle),
        null,
      );
    } finally {
      f.broker.invalidate();
    }
  });
