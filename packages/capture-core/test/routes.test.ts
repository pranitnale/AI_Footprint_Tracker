import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geminiRequestPath,
  GEMINI_STREAM_PATH,
  isNotebooklmChatPath,
  NOTEBOOKLM_BATCH_PATH,
  siteForHost,
  isCoworkSessionId,
  isRouteConversationId,
  parseConversationRoute,
} from "../src/index";

const session = "cse_0123456789ABCDEFghijklmn";
const chat = "0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b";

test("G5 ChatGPT project and GPT chats are the same conversations as at /c/", () => {
  for (const path of [
    `/c/${chat}`,
    `/g/g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f-energy-study/c/${chat}`,
    `/g/g-AbC123xyz-research-helper/c/${chat}`,
    `/g/g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f-%C3%A9nergie/c/${chat}`,
  ])
    assert.deepEqual(
      parseConversationRoute("chatgpt", path),
      { site: "chatgpt", conversationId: chat },
      path,
    );
  for (const path of [
    "/g/g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f-energy-study/project",
    "/g/g-AbC123xyz-research-helper",
    `/g/g-AbC123xyz/c/${chat}/`,
    `/g//c/${chat}`,
    `/g/x-AbC123xyz/c/${chat}`,
    `/g/g-AbC/extra/c/${chat}`,
    `/g/g-${"a".repeat(257)}/c/${chat}`,
    `/x/c/${chat}`,
  ])
    assert.equal(parseConversationRoute("chatgpt", path), null, path);
  // Other sites keep their own routes.
  assert.equal(
    parseConversationRoute("claude", `/g/g-AbC123xyz/c/${chat}`),
    null,
  );
});
test("Claude Cowork sessions are Claude conversations of their own kind (W5)", () => {
  assert.deepEqual(parseConversationRoute("claude", `/cowork/${session}`), {
    site: "claude",
    conversationId: session,
  });
  assert.deepEqual(parseConversationRoute("claude", `/chat/${chat}`), {
    site: "claude",
    conversationId: chat,
  });
  for (const path of [
    "/cowork",
    "/cowork/",
    "/cowork/new",
    `/cowork/${session}/`,
    `/cowork/${session}/files`,
    "/cowork/cse_short",
    `/cowork/cse_${"a".repeat(65)}`,
    "/cowork/cse_0123456789ABCDEF-ghij",
    `/chat/${session}`,
    `/cowork/${chat}`,
  ])
    assert.equal(parseConversationRoute("claude", path), null, path);
  assert.equal(isCoworkSessionId(session), true);
  assert.equal(isCoworkSessionId(chat), false);
  assert.equal(isRouteConversationId("claude", session), true);
  assert.equal(isRouteConversationId("claude", chat), true);
  // Other sites never take a Cowork id.
  for (const site of ["chatgpt", "gemini", "perplexity"] as const) {
    assert.equal(isRouteConversationId(site, session), false, site);
    assert.equal(
      parseConversationRoute(site, `/cowork/${session}`),
      null,
      site,
    );
  }
});

test("G17 Gemini chats of a secondary account and of a Gem are the same chats as at /app/", () => {
  const id = "40c2b9f5faad0452";
  for (const path of [
    `/app/${id}`,
    `/u/1/app/${id}`,
    `/u/3/app/${id}`,
    `/gem/learning-coach/${id}`,
    `/u/3/gem/1a2b3c4d5e6f/${id}`,
  ])
    assert.deepEqual(
      parseConversationRoute("gemini", path),
      { site: "gemini", conversationId: `c_${id}` },
      path,
    );
  for (const path of [
    "/app",
    `/u/x/app/${id}`,
    `/u/1234/app/${id}`,
    `/u/1/app/${id}/extra`,
    `/gem/${id}`,
    `/gem/bad gem/${id}`,
    `/gem/${"g".repeat(129)}/${id}`,
    `/app/${id.toUpperCase()}`,
    `/x/u/1/app/${id}`,
  ])
    assert.equal(parseConversationRoute("gemini", path), null, path);
  // Every request of a secondary account carries the prefix; one check covers both.
  assert.equal(
    geminiRequestPath(`/u/2${GEMINI_STREAM_PATH}`),
    GEMINI_STREAM_PATH,
  );
  assert.equal(geminiRequestPath(GEMINI_STREAM_PATH), GEMINI_STREAM_PATH);
  for (const path of [
    `/u/x${GEMINI_STREAM_PATH}`,
    `/u/1234${GEMINI_STREAM_PATH}`,
    `/v/1${GEMINI_STREAM_PATH}`,
    `/u/1/u/2${GEMINI_STREAM_PATH}`,
  ])
    assert.notEqual(geminiRequestPath(path), GEMINI_STREAM_PATH, path);
});

test("W9 a NotebookLM notebook is the conversation; its chat stream is one path under the data root", () => {
  const notebook = "f0e1d2c3-b4a5-4697-8a9b-0c1d2e3f4a5b";
  assert.equal(siteForHost("notebook.google.com"), "notebooklm");
  // The old host only redirects, and lookalikes are not the site.
  for (const host of [
    "notebooklm.google.com",
    "notebook.google.com.evil.test",
    "evilnotebook.google.com",
  ])
    assert.equal(siteForHost(host), null, host);
  assert.deepEqual(
    parseConversationRoute("notebooklm", `/notebook/${notebook}`),
    {
      site: "notebooklm",
      conversationId: notebook,
    },
  );
  // A secondary account adds ?authuser=N, which is not part of the path.
  for (const path of [
    "/",
    `/notebook/${notebook}/`,
    `/notebook/${notebook}/extra`,
    "/notebook/not-an-id",
    `/u/1/notebook/${notebook}`,
  ])
    assert.equal(parseConversationRoute("notebooklm", path), null, path);
  assert.equal(isRouteConversationId("notebooklm", notebook), true);
  assert.equal(
    isRouteConversationId("notebooklm", "c_0123456789abcdef"),
    false,
  );
  assert.equal(parseConversationRoute("gemini", `/notebook/${notebook}`), null);
  assert.equal(NOTEBOOKLM_BATCH_PATH, "/_/LabsTailwindUi/data/batchexecute");
  assert.equal(
    isNotebooklmChatPath(
      "/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed",
    ),
    true,
  );
  for (const path of [
    "/_/LabsTailwindUi/data/batchexecute",
    "/_/LabsTailwindUi/data/GenerateFreeFormStreamed",
    "/_/LabsTailwindUi/data/a/b/GenerateFreeFormStreamed",
    "/_/LabsTailwindUi/data/Service/GenerateFreeFormStreamedX",
    "/_/BardChatUi/data/Service/GenerateFreeFormStreamed",
  ])
    assert.equal(isNotebooklmChatPath(path), false, path);
});

test("A Perplexity Computer task is a thread at /computer/tasks/<id> (14 Oct 2026)", () => {
  for (const path of [`/search/${chat}`, `/computer/tasks/${chat}`])
    assert.deepEqual(
      parseConversationRoute("perplexity", path),
      { site: "perplexity", conversationId: chat },
      path,
    );
  for (const path of [
    "/computer",
    "/computer/tasks",
    `/computer/tasks/${chat}/files`,
    `/computer/${chat}`,
    `/computer/tasks/${chat.toUpperCase()}`,
    `/search/new/${chat}`,
  ])
    assert.equal(parseConversationRoute("perplexity", path), null, path);
  // Only Perplexity has Computer tasks.
  assert.equal(parseConversationRoute("chatgpt", `/computer/tasks/${chat}`), null);
});

test("a new ChatGPT chat's local address is provisional and no conversation route", async () => {
  const { isProvisionalChatgptRoute } = await import("../src/index");
  for (const path of [
    `/c/local-chatgpt:${chat}`,
    `/c/local-chatgpt%3A${chat}`,
    `/c/local-chatgpt%3a${chat}`,
    `/g/g-p-67a1b2c3d4e5f60718293a4b5c6d7e8f-energy-study/c/local-chatgpt%3A${chat}`,
  ]) {
    assert.equal(isProvisionalChatgptRoute(path), true, path);
    assert.equal(parseConversationRoute("chatgpt", path), null, path);
  }
  for (const path of [
    "/",
    `/c/${chat}`,
    "/c/local-chatgpt",
    `/c/local-chatgpt:${chat}/`,
    `/x/c/local-chatgpt:${chat}`,
  ])
    assert.equal(isProvisionalChatgptRoute(path), false, path);
});

// Live, 20 Oct 2026: ChatGPT used without an account moves a new chat from / to /uc/<id> once
// the reply's stream names the chat. The chat is not saved: reloading the address opens an
// empty chat at /. It is a conversation of its own, never saved and never read from history.
test("a signed-out ChatGPT chat at /uc/<id> is an unsaved conversation route", async () => {
  const { isUnsavedChatgptRoute } = await import("../src/index");
  assert.equal(typeof isUnsavedChatgptRoute, "function");
  assert.deepEqual(parseConversationRoute("chatgpt", `/uc/${chat}`), {
    site: "chatgpt",
    conversationId: chat,
  });
  assert.equal(isUnsavedChatgptRoute(`/uc/${chat}`), true);
  for (const path of [
    "/",
    `/c/${chat}`,
    `/c/local-chatgpt%3A${chat}`,
    `/uc/${chat}/`,
    `/uc/${chat.toUpperCase()}`,
    "/uc/not-a-chat",
    `/g/g-AbC123xyz/uc/${chat}`,
  ])
    assert.equal(isUnsavedChatgptRoute(path), false, path);
  for (const path of [`/uc/${chat}/`, "/uc/not-a-chat", `/g/g-AbC123xyz/uc/${chat}`])
    assert.equal(parseConversationRoute("chatgpt", path), null, path);
  // Only ChatGPT has unsaved chats.
  assert.equal(parseConversationRoute("claude", `/uc/${chat}`), null);
  assert.equal(parseConversationRoute("perplexity", `/uc/${chat}`), null);
});
