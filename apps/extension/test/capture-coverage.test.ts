import assert from "node:assert/strict";
import test from "node:test";
import {
  COVERAGE_PENDING_LIMIT,
  FetchCoverageCheck,
} from "../lib/capture-coverage";

const origin = "https://chatgpt.com";
const base = `${origin}/c/1`;
const generation = `${origin}/backend-api/f/conversation`;
const route = (url: URL) =>
  /^\/backend-api\/(f\/)?conversation$/.test(url.pathname);

class FakeObserver {
  static last: FakeObserver | null = null;
  options: unknown;
  constructor(
    public callback: (list: {
      getEntries(): { name: string; initiatorType?: string }[];
    }) => void,
  ) {
    FakeObserver.last = this;
  }
  observe(options: unknown) {
    this.options = options;
  }
  deliver(...entries: { name: string; initiatorType?: string }[]) {
    this.callback({ getEntries: () => entries });
  }
}

function observed() {
  const check = new FetchCoverageCheck(origin, route);
  const misses: number[] = [];
  check.observe(FakeObserver, () => misses.push(1));
  return { check, observer: FakeObserver.last!, misses };
}

test("coverage: every finished chat request that passed the wrapper keeps coverage monitored", () => {
  const { check, observer, misses } = observed();
  assert.deepEqual(observer.options, { type: "resource", buffered: true });
  assert.equal(check.state(), "monitored");
  check.passed("/backend-api/f/conversation", base);
  check.passed(new Request(generation, { method: "POST" }), base);
  check.passed(new URL(generation), base);
  observer.deliver(
    { name: generation, initiatorType: "fetch" },
    { name: generation, initiatorType: "fetch" },
    { name: generation, initiatorType: "fetch" },
  );
  assert.equal(check.state(), "monitored");
  assert.deepEqual(misses, []);
});

test("coverage: a finished chat request that skipped the wrapper is missed once", () => {
  const { check, observer, misses } = observed();
  check.passed(generation, base);
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.equal(check.state(), "monitored");
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.equal(check.state(), "missed");
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.deepEqual(misses, [1], "reported once");
});

test("coverage: only same-origin chat requests made with fetch are compared", () => {
  const { check, observer, misses } = observed();
  observer.deliver(
    { name: `${origin}/backend-api/conversations`, initiatorType: "fetch" },
    { name: generation, initiatorType: "xmlhttprequest" },
    { name: generation, initiatorType: "beacon" },
    { name: "https://example.com/backend-api/f/conversation", initiatorType: "fetch" },
    { name: "not a url", initiatorType: "fetch" },
  );
  assert.equal(check.state(), "monitored");
  assert.deepEqual(misses, []);
});

test("coverage: addresses match without their fragment but with their query", () => {
  const { check, observer } = observed();
  check.passed(`${generation}#part`, base);
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.equal(check.state(), "monitored");
  check.passed(`${generation}?a=1`, base);
  observer.deliver({ name: `${generation}?a=2`, initiatorType: "fetch" });
  assert.equal(check.state(), "missed");
});

test("coverage: a relative address resolves against the base the caller gives, as fetch does", () => {
  const { check, observer } = observed();
  // A <base> element can point relative addresses at another path (Codex review, 12 Oct).
  check.passed("f/conversation", `${origin}/backend-api/`);
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.equal(check.state(), "monitored");
});

test("coverage: an input whose address cannot be read safely makes coverage unavailable, never missed", () => {
  const { check, observer, misses } = observed();
  let called = false;
  const input = {
    toString() {
      called = true;
      return generation;
    },
  };
  check.passed(input, base);
  assert.equal(called, false, "a page object's own toString never runs");
  observer.deliver({ name: generation, initiatorType: "fetch" });
  assert.equal(check.state(), "unavailable");
  assert.deepEqual(misses, []);
});

test("coverage: too many pending addresses make coverage unavailable instead of forgetting one", () => {
  const { check, observer, misses } = observed();
  for (let index = 0; index <= COVERAGE_PENDING_LIMIT; index++)
    check.passed(`${generation}?n=${index}`, base);
  observer.deliver({ name: `${generation}?n=other`, initiatorType: "fetch" });
  assert.equal(check.state(), "unavailable");
  assert.deepEqual(misses, []);
});

test("coverage: without a timing observer the check is unavailable", () => {
  const check = new FetchCoverageCheck(origin, route);
  check.observe(undefined, () => assert.fail("no observer"));
  assert.equal(check.state(), "unavailable");
  const throwing = new FetchCoverageCheck(origin, route);
  throwing.observe(
    class {
      observe() {
        throw new TypeError("resource timing unsupported");
      }
    },
    () => assert.fail("no observer"),
  );
  assert.equal(throwing.state(), "unavailable");
});
