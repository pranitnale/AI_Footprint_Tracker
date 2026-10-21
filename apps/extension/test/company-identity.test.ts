import test from "node:test";
import assert from "node:assert/strict";
import {
  PROMPT_ACTIONS,
  REPLY_ACTIONS,
  REQUEST_PROMPT_SITES,
  companyKeySecret,
  companyKeyer,
  savedCompanyId,
  streamPromptId,
} from "../lib/company-identity";
import { hmacIdentity } from "../lib/ownership";

// Company keys (W11): synthetic secrets and provider ids only.
const KEY = "Zm9vYmFyLWNvbXBhbnkta2V5LWZvci10ZXN0cy0wMDE";
const scope = {
  namespace: "company:c1:u1",
  mode: "company" as const,
  era: "era-1",
};
const credentials = {
  namespace: scope.namespace,
  enrollment_era: {
    id: scope.era,
    start: "2026-10-04T00:00:00.000Z",
    end: null,
  },
  company_dedup_key: KEY,
} as any;

test("W11 the company key belongs only to the enrolment it was handed out for", () => {
  assert.equal(companyKeySecret(credentials, scope), KEY);
  assert.equal(
    companyKeySecret(credentials, {
      namespace: "personal:p",
      mode: "personal",
      era: null,
    }),
    null,
  );
  assert.equal(companyKeySecret(credentials, { ...scope, era: "era-0" }), null);
  assert.equal(
    companyKeySecret(credentials, { ...scope, namespace: "company:c1:u2" }),
    null,
  );
  assert.equal(
    companyKeySecret({ ...credentials, company_dedup_key: null }, scope),
    null,
  );
  // Credentials saved before company keys have no field at all.
  const { company_dedup_key: _, ...older } = credentials;
  assert.equal(companyKeySecret(older, scope), null);
  assert.equal(companyKeySecret(undefined, scope), null);
});

test("W11 only prompts the user wrote and new replies are named", () => {
  assert.deepEqual([...PROMPT_ACTIONS].sort(), ["edit_and_send", "send"]);
  assert.deepEqual([...REPLY_ACTIONS].sort(), [
    "edit_and_send",
    "regenerate",
    "send",
  ]);
  for (const action of ["continue", "read_aloud", "notebook_guide"]) {
    assert.equal(PROMPT_ACTIONS.has(action), false);
    assert.equal(REPLY_ACTIONS.has(action), false);
  }
  assert.deepEqual([...REQUEST_PROMPT_SITES].sort(), ["chatgpt", "perplexity"]);
});

test("W11 a live capture and a saved copy of one prompt or reply get the same key on every site", async () => {
  const sign = companyKeyer(KEY);
  // How each site's live capture names the prompt and the reply, and the saved rows the
  // history readers make for them (packages/adapters/src/history).
  const cases = [
    {
      site: "chatgpt",
      live: { prompt: "user-message-1", reply: "turn-first-message-1" },
      saved: {
        prompt: { sourceId: "user-message-1", requestId: "user-message-1" },
        reply: {
          sourceId: "turn-first-message-1",
          liveAttemptId: "turn-first-message-1",
        },
      },
    },
    {
      site: "perplexity",
      live: { prompt: "frontend-uuid-1", reply: "backend-reply-1" },
      saved: {
        prompt: { sourceId: "entry-1:prompt", requestId: "frontend-uuid-1" },
        reply: { sourceId: "entry-1:reply", liveAttemptId: "backend-reply-1" },
      },
    },
    {
      site: "gemini",
      live: {
        prompt: streamPromptId("gemini", {
          providerRequestId: "turn-1",
          parentId: null,
        })!,
        reply: "candidate-1",
      },
      saved: {
        prompt: { sourceId: "turn-1", requestId: "turn-1" },
        reply: { sourceId: "candidate-1", liveAttemptId: "candidate-1" },
      },
    },
    {
      site: "claude",
      live: {
        // The reply's message_start names the prompt it answers.
        prompt: streamPromptId("claude", { parentId: "human-uuid-1" })!,
        reply: "assistant-uuid-1",
      },
      saved: {
        prompt: { sourceId: "human-uuid-1", requestId: null },
        reply: {
          sourceId: "assistant-uuid-1",
          liveAttemptId: "assistant-uuid-1",
        },
      },
    },
  ];
  for (const { site, live, saved } of cases) {
    const prompt = savedCompanyId(site, false, {
      role: "prompt",
      liveAttemptId: null,
      ...saved.prompt,
    })!;
    const reply = savedCompanyId(site, false, {
      role: "response",
      requestId: null,
      ...saved.reply,
    })!;
    assert.equal(
      await sign(site, prompt.kind, prompt.id),
      await sign(site, "company-request", live.prompt),
      site,
    );
    assert.equal(
      await sign(site, reply.kind, reply.id),
      await sign(site, "company-attempt", live.reply),
      site,
    );
    // The coordinator signs with the same identity function as the member keys, under
    // the company's key and its own kinds.
    const memberKey = await hmacIdentity(
      "b".repeat(64),
      site,
      "attempt",
      live.reply,
    );
    const companyKey = await hmacIdentity(
      KEY,
      site,
      "company-attempt",
      live.reply,
    );
    assert.equal(await sign(site, "company-attempt", live.reply), companyKey);
    assert.notEqual(companyKey, memberKey);
    assert.notEqual(
      companyKey,
      await hmacIdentity(KEY, site, "attempt", live.reply),
    );
  }
  // Gemini and Claude name the prompt in the stream; ChatGPT and Perplexity in the request.
  for (const site of ["chatgpt", "perplexity", "notebooklm"])
    assert.equal(
      streamPromptId(site, { providerRequestId: "x", parentId: "y" }),
      null,
    );
});

test("W11 saved rows no live capture sees use their own ids, and Cowork results get none", () => {
  // NotebookLM Studio items: the prompt and the reply share the item id, under saved kinds.
  assert.deepEqual(
    savedCompanyId("notebooklm", false, {
      role: "prompt",
      sourceId: "studio-1",
      requestId: null,
      liveAttemptId: null,
    }),
    { kind: "company-saved-prompt", id: "studio-1" },
  );
  assert.deepEqual(
    savedCompanyId("notebooklm", false, {
      role: "response",
      sourceId: "studio-1",
      requestId: null,
      liveAttemptId: null,
    }),
    { kind: "company-saved-response", id: "studio-1" },
  );
  // A saved reply without the id its live capture uses keeps its own id.
  assert.deepEqual(
    savedCompanyId("chatgpt", false, {
      role: "response",
      sourceId: "message-9",
      requestId: null,
      liveAttemptId: null,
    }),
    { kind: "company-saved-response", id: "message-9" },
  );
  // Cowork results count from each browser's own checkpoint, so copies never merge.
  for (const role of ["prompt", "response"] as const)
    assert.equal(
      savedCompanyId("claude", true, {
        role,
        sourceId: "event-1",
        requestId: null,
        liveAttemptId: role === "response" ? "event-1" : null,
      }),
      null,
    );
});
