import type { Site } from "@footprint/capture-core";
import { ClaudeSession } from "./claude";
import { ClaudeProxySession, isClaudeProxy } from "./claude-proxy";
import { ChatgptSession } from "./chatgpt";
import { ChatgptReadAloudSession, isChatgptReadAloud } from "./chatgpt-speech";
import {
  ChatgptSignedOutSession,
  isChatgptSignedOutSend,
} from "./chatgpt-signed-out";
import { GeminiSession } from "./gemini";
import { PerplexitySession } from "./perplexity";
import {
  isNotebooklmGuide,
  NotebooklmChatSession,
  NotebooklmGuideSession,
} from "./notebooklm";
import { generationRoute, parseDispatch } from "./dispatch";
import type { ProviderAdapter, ProviderAdapterRegistry } from "./types";

const sites: readonly Site[] = [
  "claude",
  "chatgpt",
  "gemini",
  "perplexity",
  "notebooklm",
];

/** Copies trusted local entries so later registration-object edits cannot replace an installed adapter. */
export function createProviderAdapterRegistry(
  adapters: readonly ProviderAdapter[],
): ProviderAdapterRegistry {
  const entries: Partial<Record<Site, Readonly<ProviderAdapter>>> = {};
  for (const adapter of adapters) {
    if (
      !adapter ||
      !sites.includes(adapter.site) ||
      entries[adapter.site] ||
      !["sse", "gemini"].includes(adapter.responseFormat) ||
      typeof adapter.generationRoute !== "function" ||
      typeof adapter.parseDispatch !== "function" ||
      typeof adapter.createSession !== "function"
    )
      throw new Error("invalid_provider_adapter");
    entries[adapter.site] = Object.freeze({
      site: adapter.site,
      responseFormat: adapter.responseFormat,
      generationRoute: adapter.generationRoute,
      parseDispatch: adapter.parseDispatch,
      createSession: adapter.createSession,
    });
  }
  Object.freeze(entries);
  return Object.freeze({ get: (site: Site) => entries[site] });
}

export const PACKAGED_PROVIDER_ADAPTERS = createProviderAdapterRegistry([
  {
    site: "claude",
    responseFormat: "sse",
    generationRoute: (url, method) => generationRoute("claude", url, method),
    parseDispatch: (url, body) => parseDispatch("claude", url, body),
    createSession: (url) =>
      url && isClaudeProxy(url)
        ? new ClaudeProxySession()
        : new ClaudeSession(),
  },
  {
    site: "chatgpt",
    responseFormat: "sse",
    generationRoute: (url, method) => generationRoute("chatgpt", url, method),
    parseDispatch: (url, body) => parseDispatch("chatgpt", url, body),
    createSession: (url) =>
      url && isChatgptReadAloud(url, "GET")
        ? new ChatgptReadAloudSession(url)
        : url && isChatgptSignedOutSend(url, "POST")
          ? new ChatgptSignedOutSession()
          : new ChatgptSession(),
  },
  {
    site: "gemini",
    responseFormat: "gemini",
    generationRoute: (url, method) => generationRoute("gemini", url, method),
    parseDispatch: (url, body) => parseDispatch("gemini", url, body),
    createSession: () => new GeminiSession(),
  },
  {
    site: "perplexity",
    responseFormat: "sse",
    generationRoute: (url, method) =>
      generationRoute("perplexity", url, method),
    parseDispatch: (url, body) => parseDispatch("perplexity", url, body),
    createSession: () => new PerplexitySession(),
  },
  {
    // NotebookLM streams with Gemini's framing (W9).
    site: "notebooklm",
    responseFormat: "gemini",
    generationRoute: (url, method) =>
      generationRoute("notebooklm", url, method),
    parseDispatch: (url, body) => parseDispatch("notebooklm", url, body),
    createSession: (url) =>
      url && isNotebooklmGuide(url)
        ? new NotebooklmGuideSession(url)
        : new NotebooklmChatSession(),
  },
]);

export function createSession(site: Site) {
  return PACKAGED_PROVIDER_ADAPTERS.get(site)!.createSession();
}
