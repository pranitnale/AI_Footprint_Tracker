import test from "node:test";
import assert from "node:assert/strict";
import { createClaudeResearchStatus } from "../lib/claude-research-status";

const conversation = "00000000-0000-4000-8000-000000000042";
const route = (task: string, chat = conversation) =>
  new URL(
    `https://claude.ai/api/organizations/00000000-0000-4000-8000-000000000001/chat_conversations/${chat}/task/${task}/status`,
  );
const poll = (status: string, query: string) =>
  JSON.stringify({
    status,
    started_at: "2026-10-04T12:00:00.000Z",
    completed_at: status === "completed" ? "2026-10-04T12:01:00.000Z" : null,
    agents: [{ name: "agent", calls: [{ tool_input: { query } }] }],
  });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("E1 the page's own Research polls are kept passively, latest first, and read when needed", async () => {
  const status = createClaudeResearchStatus();
  assert.equal(
    status.observe(
      new URL(
        `https://claude.ai/api/organizations/x/chat_conversations/${conversation}`,
      ),
      "GET",
      Promise.resolve(new Response("{}")),
    ),
    false,
  );
  // A POST to the same route is not a poll.
  assert.equal(
    status.observe(
      route("wf-run1"),
      "POST",
      Promise.resolve(new Response("{}")),
    ),
    false,
  );
  const first = new Response(poll("searching", "early"));
  assert.equal(
    status.observe(route("wf-run1"), "GET", Promise.resolve(first)),
    true,
  );
  await settle();
  // The page still reads its own body.
  assert.match(await first.text(), /early/);
  assert.deepEqual(status.tasks(conversation), []);
  status.observe(
    route("wf-run1"),
    "GET",
    Promise.resolve(new Response(poll("completed", "final query"))),
  );
  status.observe(
    route("wf-run2", "00000000-0000-4000-8000-000000000043"),
    "GET",
    Promise.resolve(new Response(poll("completed", "other chat"))),
  );
  await settle();
  assert.deepEqual(status.tasks(conversation), [
    { id: "wf-run1", queries: "final query", seconds: 60 },
  ]);
});

test("E1 the newest poll the page sent stays authoritative when an older response arrives late", async () => {
  const status = createClaudeResearchStatus();
  let release!: (response: Response) => void;
  const late = new Promise<Response>((resolve) => {
    release = resolve;
  });
  status.observe(route("wf-run1"), "GET", late);
  status.observe(
    route("wf-run1"),
    "GET",
    Promise.resolve(new Response(poll("completed", "final query"))),
  );
  await settle();
  release(new Response(poll("searching", "early")));
  await settle();
  assert.deepEqual(status.tasks(conversation), [
    { id: "wf-run1", queries: "final query", seconds: 60 },
  ]);
});

test("E1 a Research poll that fails, is too large or is not JSON gives no facts", async () => {
  const status = createClaudeResearchStatus();
  status.observe(
    route("wf-failed"),
    "GET",
    Promise.resolve(new Response(poll("completed", "x"), { status: 500 })),
  );
  status.observe(
    route("wf-large"),
    "GET",
    Promise.resolve(new Response("x".repeat(4_194_305))),
  );
  status.observe(
    route("wf-text"),
    "GET",
    Promise.resolve(new Response("<html>")),
  );
  status.observe(
    route("wf-rejected"),
    "GET",
    Promise.reject(new Error("offline")),
  );
  await settle();
  assert.deepEqual(status.tasks(conversation), []);
});
