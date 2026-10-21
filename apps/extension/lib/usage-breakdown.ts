import {
  compareHistoricalInstants,
  type AttemptObservation,
  type HistoryMessage,
  type HistorySummary,
  type RequestObservation,
} from "@footprint/contracts";
import { HistoryAccumulator } from "@footprint/estimator";
import type { HistoryRouter } from "./history-service";
import { PACKAGED_CLAUDE_TOKEN_FACTOR } from "./claude-token-factor";
import {
  replyFiguresModel,
  SummaryAccumulator,
  type OriginalSource,
  type SummaryObserver,
} from "./summary-scan";
import type { Filters, PresentedEstimate } from "./summary";
import type { RecordHashes, ReplySelection } from "./estimate-presentation";

export type BreakdownBucket = "hour" | "day";
export type BreakdownOptions = {
  /** IANA time zone that decides where hours and days begin. */
  timezone: string;
  bucket: BreakdownBucket;
  /**
   * When tracking was last turned off (ms since 1970), or null. Turning it off ends a reply still
   * arriving as `interrupted_unconfirmed` (Coordinator.setTrackingConsent); that reply was cut off
   * by the person, not missed by the tracker, so it does not count as not read.
   */
  withdrawnAt?: number | null;
};

type Accumulated = ReturnType<SummaryAccumulator["result"]>;
/** The part of a summary the breakdown views read. Figures are untouched accumulator results. */
export type BreakdownSummary = Pick<
  Accumulated,
  "requests" | "attempts" | "tokens" | "metrics" | "tools" | "models"
>;
/** A model's part also says how its replies were matched to estimation records. */
export type ModelBreakdownSummary = BreakdownSummary & {
  selections: ReplySelection[];
};
export type ChatSummary = {
  /** Opaque conversation key, the same key saved history uses, so both sides of a chat can join. */
  key: string;
  requests: number;
  site: string;
  metrics: Pick<Accumulated["metrics"], "energy" | "carbon" | "water">;
};
export type UsageBreakdown = {
  /** Keys are "YYYY-MM-DD" for days and "00" to "23" for hours, in the breakdown's time zone. */
  buckets: Record<string, BreakdownSummary>;
  sites: Record<string, BreakdownSummary>;
  /**
   * Keyed by the model that answered, as each reply's figures are (replyFiguresModel: a reply
   * linked to its saved copy takes the model its estimate uses). A request counts for the
   * model of its first reply that names one, or for the model it asked for when no reply in the
   * window names one.
   */
  models: Record<string, ModelBreakdownSummary>;
  chats: ChatSummary[];
  /** The tool each model answered on; a model seen on two tools keeps the first. */
  modelSites: Record<string, string>;
  /** Start of the latest reply per tool in the window, as an ISO time. */
  siteLastAt: Record<string, string>;
  /**
   * Start of the latest live reply per tool, only for tools whose latest live reply could not be
   * read to its end (`interrupted_unconfirmed`). The Tracking page shows such a tool as missing
   * replies instead of Working (live QA, 19 Oct 2026).
   */
  siteLastMissed: Record<string, string>;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
/** One formatter per zone: building Intl formatters per row is the slow part of a long scan. */
function localKey(at: string, options: BreakdownOptions) {
  let format = formatters.get(options.timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: options.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(options.timezone, format);
  }
  const parts = Object.fromEntries(
    format
      .formatToParts(new Date(at))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return options.bucket === "hour"
    ? parts.hour!
    : `${parts.year}-${parts.month}-${parts.day}`;
}

function compact(result: Accumulated): BreakdownSummary {
  return {
    requests: result.requests,
    attempts: result.attempts,
    tokens: result.tokens,
    metrics: result.metrics,
    tools: result.tools,
    models: result.models,
  };
}

/**
 * Splits one summary scan into time buckets, tools, models and chats. Every split uses
 * SummaryAccumulator with the scan's own filters, so each part is calculated exactly like
 * the totals and the parts of one split add up to them.
 */
export class BreakdownObserver implements SummaryObserver {
  private buckets = new Map<string, SummaryAccumulator>();
  private sites = new Map<string, SummaryAccumulator>();
  private models = new Map<string, SummaryAccumulator>();
  private chats = new Map<string, { site: string; totals: SummaryAccumulator }>();
  private modelSites = new Map<string, string>();
  private siteLastAt = new Map<string, string>();
  private siteLastLive = new Map<string, { at: string; missed: boolean }>();
  /** Requests in the window, each with its first reply that names a model (attributeRequests). */
  private requestModels = new Map<
    string,
    { request: RequestObservation; reply: { model: string; at: string; attempt: string } | null }
  >();
  /** Models in the order the scan first met them, so the models split keeps its order. */
  private modelOrder = new Set<string>();

  constructor(
    private filters: Filters,
    private options: BreakdownOptions,
  ) {}

  reset() {
    this.buckets.clear();
    this.sites.clear();
    this.models.clear();
    this.chats.clear();
    this.modelSites.clear();
    this.siteLastAt.clear();
    this.siteLastLive.clear();
    this.requestModels.clear();
    this.modelOrder.clear();
  }

  /**
   * Whether turning tracking off ended this reply: it started before the latest withdrawal and
   * ended at it or later. A reply that ended unread before the withdrawal stays not read.
   */
  private endedByWithdrawal(attempt: AttemptObservation) {
    const withdrawnAt = this.options.withdrawnAt;
    if (typeof withdrawnAt !== "number" || attempt.ended_at === null) return false;
    return (
      Date.parse(attempt.started_at) <= withdrawnAt &&
      Date.parse(attempt.ended_at) >= withdrawnAt
    );
  }

  private take(map: Map<string, SummaryAccumulator>, key: string) {
    let totals = map.get(key);
    if (!totals) {
      totals = new SummaryAccumulator(this.filters);
      map.set(key, totals);
    }
    return totals;
  }

  private chat(request: RequestObservation) {
    const key = request.conversation_key ?? `request:${request.request_id}`;
    let chat = this.chats.get(key);
    if (!chat) {
      chat = { site: request.site, totals: new SummaryAccumulator(this.filters) };
      this.chats.set(key, chat);
    }
    return chat.totals;
  }

  // Rows outside the scan window would only create empty buckets; the accumulators skip them anyway.
  private inRange(at: string) {
    return (!this.filters.start || at >= this.filters.start) && (!this.filters.end || at < this.filters.end);
  }

  request(request: RequestObservation) {
    if (!this.inRange(request.dispatched_at)) return;
    this.take(this.buckets, localKey(request.dispatched_at, this.options)).request(request);
    this.take(this.sites, request.site).request(request);
    if (request.model_id) this.modelOrder.add(request.model_id);
    this.requestModels.set(request.request_id, { request, reply: null });
    this.chat(request).request(request);
  }

  attempt(
    attempt: AttemptObservation,
    parent: RequestObservation,
    estimate: PresentedEstimate | undefined,
    originalSource?: OriginalSource,
    history?: HistoryMessage,
    hashes?: RecordHashes,
  ) {
    if (!this.inRange(attempt.started_at)) return;
    const args = [attempt, parent, estimate, originalSource, history, hashes] as const;
    this.take(this.buckets, localKey(attempt.started_at, this.options)).attempt(...args);
    this.take(this.sites, parent.site).attempt(...args);
    // The model the reply's figures are estimated for. ChatGPT replies captured in early
    // October 2026 ended unread and name no model, while their saved copies do: keyed by the
    // live model alone they counted as "without a named model" and their figures sat in no
    // model, though the estimate used the saved model (live QA, 19 Oct 2026).
    const model = replyFiguresModel(this.filters, attempt, history) ?? parent.model_id;
    if (model) {
      this.modelOrder.add(model);
      this.take(this.models, model).attempt(...args);
      if (!this.modelSites.has(model)) this.modelSites.set(model, parent.site);
      const counted = this.requestModels.get(parent.request_id);
      const first = counted?.reply;
      if (
        counted &&
        (!first ||
          attempt.started_at < first.at ||
          (attempt.started_at === first.at && attempt.attempt_id < first.attempt))
      )
        counted.reply = { model, at: attempt.started_at, attempt: attempt.attempt_id };
    }
    const last = this.siteLastAt.get(parent.site);
    if (!last || attempt.started_at > last) this.siteLastAt.set(parent.site, attempt.started_at);
    const live = this.siteLastLive.get(parent.site);
    if (!live || attempt.started_at > live.at)
      this.siteLastLive.set(parent.site, {
        at: attempt.started_at,
        missed:
          attempt.state === "interrupted_unconfirmed" && !this.endedByWithdrawal(attempt),
      });
    this.chat(parent).attempt(...args);
  }

  /**
   * Counts each request for the model that answered it, the key its reply's figures use. A
   * ChatGPT request sent with "auto" names no model and only its reply does (live QA, 19 Oct
   * 2026), and a reply can come from another model than the one asked for. Counted under the
   * requested model only, such a request showed as "without a named model" and its model's
   * figures per request were inflated. A request answered by several models counts once, for
   * its earliest reply, as saved prompts do (attributePrompts). Runs once all rows are in,
   * because the scan reads a period's requests before their attempts.
   */
  private attributeRequests() {
    for (const { request, reply } of this.requestModels.values()) {
      const model = reply?.model ?? request.model_id;
      if (model) this.take(this.models, model).request(request);
    }
    this.requestModels.clear();
  }

  result(): UsageBreakdown {
    this.attributeRequests();
    const map = (source: Map<string, SummaryAccumulator>) =>
      Object.fromEntries([...source].map(([key, totals]) => [key, compact(totals.result())]));
    const models = [...this.modelOrder].flatMap((model) => {
      const totals = this.models.get(model);
      return totals ? [[model, { ...compact(totals.result()), selections: totals.selections() }] as const] : [];
    });
    return {
      buckets: map(this.buckets),
      sites: map(this.sites),
      models: Object.fromEntries(models),
      chats: [...this.chats].flatMap(([key, { site, totals }]) => {
        const result = totals.result();
        if (!result.requests) return [];
        const { energy, carbon, water } = result.metrics;
        return [{ key, requests: result.requests, site, metrics: { energy, carbon, water } }];
      }),
      modelSites: Object.fromEntries(this.modelSites),
      siteLastAt: Object.fromEntries(this.siteLastAt),
      siteLastMissed: Object.fromEntries(
        [...this.siteLastLive].flatMap(([site, live]) => (live.missed ? [[site, live.at]] : [])),
      ),
    };
  }
}

/**
 * Whether a reply comes before another under the same prompt: the earliest `occurred_at`, undated
 * replies last, then the lower `message_key`, the order regeneratedHistoryReplies uses. A prompt
 * answered by several models (a regeneration with another model) counts once, for its first reply.
 * The server's model splits use the same rule (`reply_models` in historical_usage.py).
 */
function replyFirst(reply: HistoryMessage, other: HistoryMessage) {
  if (reply.occurred_at !== null && other.occurred_at !== null) {
    const order = compareHistoricalInstants(reply.occurred_at, other.occurred_at);
    if (order) return order < 0;
  } else if (reply.occurred_at !== other.occurred_at) return reply.occurred_at !== null;
  return reply.message_key < other.message_key;
}

/**
 * The key of the saved prompt a saved reply answers, or null. ChatGPT names a reply's prompt
 * (prompt_key) only when both carry the same request id in one read, while the reply still
 * sits under its prompt in the chat's tree (parent_key). Left with no prompt, such a prompt
 * counted under no model ("without a named model", live QA of 19 Oct 2026). A parent that is
 * a reply never equals a prompt's key, so it matches nothing. The server's model splits use
 * the same rule (`answered_prompt` in historical_usage.py).
 */
function answeredPrompt(reply: HistoryMessage) {
  return reply.role === "response" ? (reply.prompt_key ?? reply.parent_key) : null;
}

export type HistoryBreakdownResult = {
  buckets: Record<string, HistorySummary>;
  sites: Record<string, HistorySummary>;
  models: Record<string, HistorySummary>;
  chats: Record<string, HistorySummary>;
  modelSites: Record<string, string>;
  siteLastAt: Record<string, string>;
};

/**
 * The saved-history side of the breakdown. The history service hands it every row its own
 * totals add, so each bucket is a HistorySummary built by the same accumulator. When the
 * totals come back unavailable, the whole breakdown is unavailable instead of partial.
 */
export class HistoryBreakdown implements HistoryRouter {
  private buckets = new Map<string, HistoryAccumulator>();
  private sites = new Map<string, HistoryAccumulator>();
  private models = new Map<string, HistoryAccumulator>();
  private chats = new Map<string, HistoryAccumulator>();
  private modelSites = new Map<string, string>();
  private siteLastAt = new Map<string, string>();
  /** Saved prompts without a model, waiting for the model of their reply (attributePrompts). */
  private unnamedPrompts: Array<{ source: HistoryMessage; record: HistoryMessage; options: Parameters<HistoryAccumulator["add"]>[1] }> = [];
  /** Per prompt key, its first reply that names a model (replyFirst). */
  private replyModels = new Map<string, HistoryMessage>();
  private failed = false;

  constructor(private options: BreakdownOptions) {}

  reset() {
    for (const map of [this.buckets, this.sites, this.models, this.chats]) map.clear();
    this.modelSites.clear();
    this.siteLastAt.clear();
    this.unnamedPrompts = [];
    this.replyModels.clear();
    this.failed = false;
  }

  fail() {
    this.failed = true;
  }

  private take(map: Map<string, HistoryAccumulator>, key: string) {
    let accumulator = map.get(key);
    if (!accumulator) {
      accumulator = new HistoryAccumulator(PACKAGED_CLAUDE_TOKEN_FACTOR);
      map.set(key, accumulator);
    }
    return accumulator;
  }

  add(source: HistoryMessage, record: HistoryMessage, options: Parameters<HistoryAccumulator["add"]>[1]) {
    // Saved messages without a time only count in all-time totals; they belong to no day.
    if (source.occurred_at)
      this.take(this.buckets, localKey(source.occurred_at.replace(/(\.\d{3})\d*Z$/, "$1Z"), this.options)).add(record, options);
    this.take(this.sites, source.site).add(record, options);
    if (source.model_id) this.addModel(source.model_id, source.site, record, options);
    else if (source.role === "prompt") this.unnamedPrompts.push({ source, record, options });
    const prompt = answeredPrompt(source);
    if (source.model_id && prompt) {
      const earlier = this.replyModels.get(prompt);
      if (!earlier || replyFirst(source, earlier)) this.replyModels.set(prompt, source);
    }
    const last = this.siteLastAt.get(source.site);
    if (source.occurred_at && (!last || source.occurred_at > last)) this.siteLastAt.set(source.site, source.occurred_at);
    this.take(this.chats, source.conversation_key).add(record, options);
  }

  private addModel(model: string, site: string, record: HistoryMessage, options: Parameters<HistoryAccumulator["add"]>[1]) {
    this.take(this.models, model).add(record, options);
    if (!this.modelSites.has(model)) this.modelSites.set(model, site);
  }

  /**
   * Saved prompts often name no model while their replies do. Left out of every model, a model's
   * saved replies would have no request and its figures per request would be inflated, so a
   * prompt that names no model counts for the model of its reply (replyModels). Runs once every
   * row is in, because a prompt is usually read before its reply.
   */
  private attributePrompts() {
    for (const { source, record, options } of this.unnamedPrompts.splice(0)) {
      const reply = this.replyModels.get(source.message_key);
      if (reply?.model_id) this.addModel(reply.model_id, source.site, record, options);
    }
  }

  result(): HistoryBreakdownResult | null {
    if (this.failed) return null;
    this.attributePrompts();
    const map = (source: Map<string, HistoryAccumulator>) =>
      Object.fromEntries([...source].map(([key, accumulator]) => [key, accumulator.summary]));
    return {
      buckets: map(this.buckets),
      sites: map(this.sites),
      models: map(this.models),
      chats: map(this.chats),
      modelSites: Object.fromEntries(this.modelSites),
      siteLastAt: Object.fromEntries(this.siteLastAt),
    };
  }
}
