/**
 * A synthetic browser profile for the popup and dashboard benchmark and the summary parity
 * tests. It writes through the same ledger operations a capture, a history import, a
 * recalculation and an erasure use, so the background reads it exactly as it reads a real
 * profile. Records are random but repeatable for a given seed.
 */
import "fake-indexeddb/auto";
import {
  Ledger,
  historyAuthority,
  type Scope,
  type StoredCredentials,
} from "@footprint/ledger";
import {
  composeOutputTotal,
  emptyAttemptMedia,
  emptyGeneration,
  emptyRequestMedia,
  emptyTokenFields,
  historyResponseParts,
  HistoryMessageSchema,
  HistoryPageSchema,
  unknownMediaSettings,
  type AttemptObservation,
  type HistoryMessage,
  type RequestObservation,
  type Site,
  type TokenMeasurement,
} from "@footprint/contracts";
import { estimateHistoricalText } from "@footprint/estimator";
import { Coordinator } from "../../lib/coordinator";
import {
  createLocalExecutor,
  packagedMethods,
} from "../../lib/estimation/config";
import { countByTextLength } from "../counting-fixture";

export type ProfileSize = {
  chats: number;
  /** Live requests, each with one reply attempt. */
  requests: number;
  /** Chats that also have saved history; the first half of them link to live replies. */
  historyChats: number;
  /** Saved prompt and reply pairs per history chat. */
  historyTurns: number;
  days: number;
  /** Single requests erased by the person, and whether one day is erased as a range. */
  erasedRequests: number;
  erasedDay: boolean;
};

export const BENCHMARK_PROFILE: ProfileSize = {
  chats: 3000,
  requests: 20000,
  historyChats: 1000,
  historyTurns: 4,
  days: 120,
  erasedRequests: 20,
  erasedDay: true,
};

const SITES: Array<{ site: Site; share: number; models: Array<string | null> }> = [
  { site: "chatgpt", share: 0.35, models: ["chatgpt-gpt-5-5", "chatgpt-gpt-4o", "chatgpt-gpt-5-4-mini"] },
  { site: "claude", share: 0.3, models: ["claude-opus-4-7", "claude-haiku-4-5", null] },
  { site: "gemini", share: 0.15, models: ["gemini-2-5-pro", "gemini-3-5-flash"] },
  { site: "perplexity", share: 0.12, models: ["perplexity-claude-opus-4-7", null] },
  { site: "notebooklm", share: 0.08, models: [null] },
];

/** mulberry32: small, fast and repeatable. */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (next: () => number, length = 64) => {
  let value = "";
  while (value.length < length)
    value += Math.floor(next() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  return value.slice(0, length);
};
const uuid = (next: () => number) => {
  const h = hex(next, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const counted = (value: number, profile: TokenMeasurement["profile_id"] = "observed-text-v1"): TokenMeasurement => ({
  value: String(value),
  evidence: "heuristic_estimate",
  scope: "observed_text",
  completeness: "complete_for_scope",
  profile_id: profile,
  reason: "tokenizer_mapping_unverified",
});

function credentials(next: () => number): StoredCredentials {
  const companyId = uuid(next),
    userId = uuid(next);
  return {
    origin: "https://benchmark.example",
    namespace: `company:${companyId}:${userId}`,
    company_id: companyId,
    user_id: userId,
    device_id: uuid(next),
    access_token: "synthetic-benchmark-access",
    refresh_token: "synthetic-benchmark-refresh",
    access_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_expires_at: "2099-01-01T00:00:00.000Z",
    installation_reconnect_secret: "synthetic-benchmark-reconnect",
    deletion_receipt_credential: "synthetic-benchmark-receipt",
    deletion_public_key: "synthetic-benchmark-public-key",
    user_hmac_key: "b".repeat(64),
    key_version: "1",
    policy: {
      policy_version: "1.0.0",
      disclosure_version: "1.0.0",
      pause_mode: "user_controlled",
      timezone: "UTC",
      usage_retention_months: null,
      ip_retention_days: 0,
      deletion_epoch: 0,
    },
    enrollment_era: { id: uuid(next), start: "2026-01-01T00:00:00.000Z", end: null },
  };
}

type Chat = { key: string; site: Site; models: Array<string | null> };
export type LiveRecord = { request: RequestObservation; attempt: AttemptObservation; chat: Chat };

/** One live request and its reply, shaped like a finished capture of that site. */
function livePair(next: () => number, chat: Chat, at: Date): LiveRecord {
  const model = chat.models[Math.floor(next() * chat.models.length)] ?? null;
  const roll = next();
  const state: AttemptObservation["state"] = roll < 0.02 ? "cancelled" : roll < 0.04 ? "failed" : "completed";
  const image = chat.site === "chatgpt" && next() < 0.03;
  const video = chat.site === "gemini" && next() < 0.02;
  const dispatched = at.toISOString();
  const ended = new Date(at.getTime() + 2000 + Math.floor(next() * 60000)).toISOString();
  const request: RequestObservation = {
    schema_version: "3.0.0",
    kind: "request",
    request_id: uuid(next),
    revision: 1,
    conversation_key: chat.key,
    key_version: "1",
    provider_request_key: hex(next),
    site: chat.site,
    adapter_version: "0.1.0",
    action: "send",
    dispatched_at: dispatched,
    ended_at: ended,
    state,
    model_id: model as RequestObservation["model_id"],
    model_evidence: model ? "request_field" : "unknown",
    features: image ? ["text", "image_generation"] : ["text"],
    observed_search_operations: null,
    documents: { upload_count: "0", types: [], processing: "none", extracted_text: [] },
    media: emptyRequestMedia(),
    coverage_reasons: ["context_unobserved"],
    policy_version: "1.0.0",
    company_dedup_key: null,
  };
  const tokens = emptyTokenFields();
  tokens.new_input_text = counted(5 + Math.floor(next() * 400), "o200k-base-4.0.0-reference");
  tokens.answer_output = counted(20 + Math.floor(next() * 1500), "o200k-base-4.0.0-reference");
  if (next() < 0.3) tokens.visible_thinking = counted(50 + Math.floor(next() * 3000), "o200k-base-4.0.0-reference");
  tokens.output_total = composeOutputTotal(tokens);
  const media = emptyAttemptMedia();
  const generation = emptyGeneration();
  if (image) {
    const key = hex(next);
    media.image_operations.push({
      operation_key: key,
      kind: "text_to_image",
      requested_count: "1",
      returned_count: state === "completed" ? "1" : null,
      state,
      execution_evidence: "content_observed",
      settings: unknownMediaSettings(),
      model_id: null,
      model_evidence: "unknown",
    });
  }
  if (video && state === "completed")
    generation.media.push({
      kind: "video",
      model_id: null,
      width: 1280,
      height: 720,
      duration_seconds: "8",
      with_audio: true,
    });
  const attempt: AttemptObservation = {
    schema_version: "3.0.0",
    kind: "attempt",
    timing: null,
    attempt_id: uuid(next),
    request_id: request.request_id,
    revision: 1,
    provider_attempt_key: hex(next),
    key_version: "1",
    started_at: dispatched,
    ended_at: ended,
    state,
    execution_evidence: "content_observed",
    model_id: model as AttemptObservation["model_id"],
    model_evidence: model ? "response_field" : "unknown",
    tokens,
    media,
    generation,
    coverage_reasons: ["hidden_reasoning_unobserved"],
    tokenizer_profile_id: "o200k-base-4.0.0-reference",
    tokenizer_asset_hash: null,
    proposed_method_id: packagedMethods.original.method_id,
    company_dedup_key: null,
  };
  return { request, attempt, chat };
}

function historyRecord(
  next: () => number,
  chat: Chat,
  role: "prompt" | "response",
  at: Date,
  link: LiveRecord | null,
  promptKey: string | null,
  parentKey: string | null,
  observedAt: string,
): HistoryMessage {
  const value = role === "prompt" ? 5 + Math.floor(next() * 300) : 20 + Math.floor(next() * 1200);
  const model = role === "response" ? (link?.attempt.model_id ?? chat.models[0] ?? null) : null;
  const tokens = counted(value);
  const messageKey = hex(next);
  return HistoryMessageSchema.parse({
    schema_version: "3.0.0",
    kind: "history_message",
    timing: null,
    message_key: messageKey,
    role,
    conversation_key: chat.key,
    key_version: "1",
    site: chat.site,
    parent_key: parentKey,
    prompt_key: role === "prompt" ? null : promptKey,
    provider_request_key: role === "prompt" ? (link?.request.provider_request_key ?? null) : null,
    provider_attempt_key: role === "response" ? (link?.attempt.provider_attempt_key ?? null) : null,
    occurred_at: at.toISOString(),
    date_basis: "message_created",
    observed_at: observedAt,
    model_id: model,
    proposed_method_id: packagedMethods.original.method_id,
    company_dedup_key: null,
    proposed_method_hash: packagedMethods.original.method_hash,
    tokens,
    inline_file_text: null,
    parts: role === "response" ? historyResponseParts(tokens) : null,
    generation: emptyGeneration(),
    text_complete: true,
    coverage_reasons: ["history_only"],
  });
}

export type LargeProfile = Awaited<ReturnType<typeof largeProfile>>;

/**
 * One maintainLocal pass handles at most 128 inputs and schedules the next, so a seeded
 * profile is recalculated pass by pass until nothing is pending. Measuring while passes
 * still run in the background would time the recalculation, not the reads.
 */
export async function settleRecalculation(coordinator: Coordinator) {
  for (let pass = 0; pass < 100000; pass++) {
    await coordinator.engines.maintainLocal();
    const status = await coordinator.engines.status();
    if (status.local.status === "complete" || status.local.status === "failed") return status.local.status;
  }
  throw new Error("recalculation did not settle");
}

/**
 * Builds the profile. `now` fixes "today" so period windows are repeatable; records fall in
 * the `days` before it. The coordinator uses the packaged estimation build (EcoLogits by
 * default) and runs its recalculation to completion, as a long-used browser has.
 */
export async function largeProfile(options: {
  size: ProfileSize;
  mode: "personal" | "company";
  seed?: number;
  now?: Date;
  /** Extra live requests at exact times, for example on period boundaries. */
  extraTimes?: string[];
  /** The engine preference saved before the recalculation, as the person chose it in Settings. */
  preference?: "build_default" | "original" | "ecologits";
  log?: (line: string) => void;
}) {
  const next = random(options.seed ?? 20261015);
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const db = await Ledger.open(`large-profile-${crypto.randomUUID()}`);
  const repository = db.application;
  const company = options.mode === "company" ? credentials(next) : undefined;
  const personal = { namespace: `personal:${uuid(next)}`, secret: "a".repeat(64) };
  const scope: Scope = company
    ? { namespace: company.namespace, mode: "company", era: company.enrollment_era.id }
    : { namespace: personal.namespace, mode: "personal", era: null };
  await repository.applySessionChanges({
    personal,
    installation: { routingSecret: "c".repeat(64) },
    settings: { paused: false, budget: null, timezone: "UTC" },
    ...(company ? { credentials: company } : {}),
    ownershipHistory: {
      eras: [{ scope, secret: company?.user_hmac_key ?? personal.secret, policyVersion: "1.0.0", start: 0, end: null }],
    },
  });
  const coordinator = new Coordinator(repository, {
    count: countByTextLength,
    hasConsent: async () => true,
    hasSiteConsent: async () => true,
    sendDisplay: async () => {},
    // The organization server is unreachable, so uploads wait in the queue as when offline.
    transport: async () => {
      throw new TypeError("synthetic offline");
    },
  });
  await coordinator.whenReady();
  const executor = createLocalExecutor();

  const chats: Chat[] = [];
  for (let i = 0; i < options.size.chats; i++) {
    const roll = next();
    let sum = 0;
    const entry = SITES.find((s) => (sum += s.share) > roll) ?? SITES[0]!;
    chats.push({ key: hex(next), site: entry.site, models: entry.models });
  }
  // Saved as a finished capture is: the request, its reply and the original estimate.
  const capture = async (pair: LiveRecord) => {
    const envelope = await executor.estimate({ family: "live", request: pair.request, attempt: pair.attempt });
    const estimate =
      envelope.requested_method.engine_id === "original" && envelope.raw?.engine_id === "original" && !Array.isArray(envelope.raw.result)
        ? envelope.raw.result
        : envelope;
    await repository.commitCapture({
      scope,
      observations: [pair.request, pair.attempt],
      originals: [envelope],
      archivedEstimates: [estimate as any],
      currentEstimate: { attemptId: pair.attempt.attempt_id, estimate: estimate as any },
    });
  };
  const span = options.size.days * 86_400_000;
  const live: LiveRecord[] = [];
  let started = Date.now();
  for (let i = 0; i < options.size.requests; i++) {
    const chat = chats[Math.floor(next() * chats.length)]!;
    const pair = livePair(next, chat, new Date(now.getTime() - 60_000 - Math.floor(next() * span)));
    await capture(pair);
    live.push(pair);
    if ((i + 1) % 2000 === 0) log(`live ${i + 1}/${options.size.requests} ${Date.now() - started} ms`);
  }
  for (const at of options.extraTimes ?? []) {
    const chat = chats[Math.floor(next() * chats.length)]!;
    const pair = livePair(next, chat, new Date(at));
    await capture(pair);
    live.push(pair);
  }
  started = Date.now();
  let historyRows = 0;
  // Saved at the profile's "now", so a fixed `now` gives the same records on every run.
  const observedAt = now.toISOString();
  // The extra times also get saved prompts, in chats of their own after the others.
  const extraHistory = options.extraTimes ?? [];
  const extraChats = Math.ceil(extraHistory.length / options.size.historyTurns);
  for (let i = 0; i < options.size.historyChats + extraChats; i++) {
    const extra = i >= options.size.historyChats;
    const linked = !extra && i < options.size.historyChats / 2;
    const chat = linked ? live[i]!.chat : chats[Math.floor(next() * chats.length)]!;
    const links = linked ? live.filter((pair) => pair.chat === chat).slice(0, options.size.historyTurns) : [];
    const messages: HistoryMessage[] = [];
    let parent: string | null = null;
    for (let turn = 0; turn < options.size.historyTurns; turn++) {
      const link = links[turn] ?? null;
      const fixed = extra ? extraHistory[(i - options.size.historyChats) * options.size.historyTurns + turn] : undefined;
      if (extra && !fixed) break;
      const at = link
        ? new Date(link.request.dispatched_at)
        : fixed
          ? new Date(fixed)
          : new Date(now.getTime() - 120_000 - Math.floor(next() * span));
      const prompt = historyRecord(next, chat, "prompt", at, link, null, parent, observedAt);
      const reply = historyRecord(next, chat, "response", new Date(at.getTime() + 1000), link, prompt.message_key, prompt.message_key, observedAt);
      parent = reply.message_key;
      messages.push(prompt, reply);
    }
    const page = HistoryPageSchema.parse({
      schema_version: "3.0.0",
      site: chat.site,
      conversation_key: chat.key,
      observed_at: observedAt,
      deletion_epoch: 0,
      branch_scope: "loaded_messages",
      selected_leaf_key: null,
      branch_message_keys: null,
      root_message_key: messages[0]!.message_key,
      first_request_verified: true,
      has_earlier: false,
      has_later: false,
      messages,
    });
    const envelopes: Record<string, any> = {};
    const estimates: Record<string, any> = {};
    for (const record of messages) {
      estimates[record.message_key] = estimateHistoricalText(record);
      if (record.role === "response") envelopes[record.message_key] = await executor.estimate({ family: "history", record });
    }
    const snapshot = await db.publicationSnapshot(scope.namespace);
    await db.commitHistory(
      scope,
      page,
      { authority: historyAuthority(snapshot), erasureVersion: snapshot.erasureVersion, estimates, envelopes },
      () => true,
    );
    historyRows += messages.length;
  }
  log(`history ${historyRows} rows ${Date.now() - started} ms`);
  started = Date.now();
  for (let i = 0; i < options.size.erasedRequests; i++)
    await db.eraseFamily(scope.namespace, live[Math.floor(next() * live.length)]!.request.request_id);
  if (options.size.erasedDay) {
    const day = new Date(now.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
    await db.applyRange(scope, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`, 0);
  }
  log(`erasures ${Date.now() - started} ms`);
  if (options.preference && options.preference !== "build_default") {
    const state = await repository.estimation.readPreferenceState();
    if (state.status === "invalid") throw new Error("engine preference invalid");
    const revision = state.status === "valid" ? state.revision : null;
    await repository.estimation.compareAndSetPreference(revision, {
      schema_version: "1.0.0",
      preference: options.preference,
      selection_revision: (revision ?? 0) + 1,
      updated_at: now.toISOString(),
    });
  }
  started = Date.now();
  await settleRecalculation(coordinator);
  log(`recalculation ${Date.now() - started} ms`);
  return {
    db,
    repository,
    coordinator,
    scope,
    now,
    live,
    chats,
    historyRows,
    close: () => {
      coordinator.engines.dispose();
      coordinator.history.invalidate();
      db.close();
    },
  };
}
