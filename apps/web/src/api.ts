import type { ApiProblem } from "./types";

export class ApiError extends Error implements ApiProblem {
  code: string;
  retryable: boolean;
  correlation_id?: string;
  status: number;
  safe_message: string;
  constructor(problem: ApiProblem) {
    super(problem.safe_message);
    this.name = "ApiError";
    Object.assign(this, problem);
    this.code = problem.code;
    this.retryable = problem.retryable;
    this.status = problem.status;
    this.safe_message = problem.safe_message;
  }
}

/**
 * The words for a refused limit, with when to try again. The server sends the wait in whole
 * seconds (`retry_after_seconds`, also the Retry-After header). Five action codes in 15 minutes
 * ended in the generic error before (QA of 19 Oct 2026). Null for any other error.
 */
export function rateLimitMessage(code: string, retryAfterSeconds: number | null, now = new Date()): string | null {
  if (code !== "otp_rate_limited" && code !== "rate_limited") return null;
  const what =
    code === "otp_rate_limited"
      ? "Too many email codes were requested in a short time."
      : "Too many requests were made in a short time.";
  const action = code === "otp_rate_limited" ? "request a new code" : "try again";
  if (!retryAfterSeconds || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0)
    return `${what} Wait a few minutes, then ${action}.`;
  const at = new Date(now.getTime() + Math.ceil(retryAfterSeconds) * 1000);
  const sameDay = at.toDateString() === now.toDateString();
  const time = new Intl.DateTimeFormat(undefined, {
    ...(sameDay ? {} : { weekday: "long" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const wait =
    retryAfterSeconds <= 60
      ? "in under a minute"
      : minutes < 90
        ? `in about ${minutes} minutes`
        : `in about ${Math.round(minutes / 60)} hours`;
  return `${what} You can ${action} at ${time}, ${wait}.`;
}

/** Whole seconds from the error body, or else from a Retry-After header in seconds. */
function retryAfterSeconds(error: { retry_after_seconds?: unknown } | undefined, header: string | null) {
  const value = Number(error?.retry_after_seconds ?? (header && /^\d+$/.test(header.trim()) ? header : NaN));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// The summaries and the Activity page, which is the admin summary with its day and model splits.
const SUMMARY_PATH = /^\/v1\/(?:(?:admin|company|me)\/summary|admin\/activity)$/;

/**
 * How long a request may take before the page reports the service as unreachable. An organization
 * summary with its day, tool and model splits took 5 to 37 s on production on 14 October 2026, so
 * a 15 s limit showed a working server as offline. Every other request keeps the short limit.
 */
export function requestTimeoutMs(path: string): number {
  const { pathname } = new URL(path, "https://example.invalid");
  return SUMMARY_PATH.test(pathname) ? 90_000 : 15_000;
}

/**
 * Largest answer read, in bytes. A summary with its day, tool and model splits measured 2.3 MB
 * for one organization's 30 days on 15 October 2026 and the 2 MiB limit refused it, so the
 * overview showed "The server did not answer" (response_too_large). Summaries may be up to
 * 16 MiB; every other answer keeps 2 MiB.
 */
export function responseLimitBytes(path: string): number {
  const { pathname } = new URL(path, "https://example.invalid");
  return SUMMARY_PATH.test(pathname) ? 16 * 1_048_576 : 2_097_152;
}

export class ApiClient {
  private csrf = "";
  private problemListener: ((problem: ApiError) => void) | null = null;
  constructor(readonly origin = window.location.origin) {}
  setCsrf(value: string) {
    this.csrf = value;
  }
  /** Hears every error answer, so the app can react to one that changes the whole session. */
  setProblemListener(listener: ((problem: ApiError) => void) | null) {
    this.problemListener = listener;
  }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith("/v1/"))
      throw new ApiError({
        code: "invalid_api_path",
        retryable: false,
        safe_message: "The application refused an invalid API destination.",
        status: 0,
      });
    const method = init.method ?? "GET";
    const write = !["GET", "HEAD"].includes(method.toUpperCase());
    // Any change can alter figures shown earlier, also one that fails after reaching the server, so
    // kept figures go both before and after it (a read finishing in between is not kept).
    if (write) forgetFigures(this);
    try {
      return await this.send<T>(url, write, init);
    } finally {
      if (write) forgetFigures(this);
    }
  }
  private async send<T>(url: URL, write: boolean, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (write && this.csrf) headers.set("X-CSRF-Token", this.csrf);
    const timeout = AbortSignal.timeout(requestTimeoutMs(url.pathname));
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        credentials: "include",
        redirect: "error",
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch {
      throw new ApiError({
        code: "offline",
        retryable: true,
        safe_message:
          "The service could not be reached. Check your connection and try again.",
        status: 0,
      });
    }
    if (response.status === 204) return undefined as T;
    const limit = responseLimitBytes(url.pathname);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > limit)
      throw new ApiError({
        code: "response_too_large",
        retryable: true,
        safe_message:
          "The service returned more data than this page can safely display.",
        status: response.status,
      });
    const isJson = response.headers
      .get("content-type")
      ?.includes("application/json");
    if (!isJson)
      throw new ApiError({
        code: "invalid_response",
        retryable: true,
        safe_message:
          "The service returned an unexpected response. No change is shown as completed.",
        status: response.status,
      });
    let payload: any;
    try {
      payload = JSON.parse(await readBounded(response, limit));
    } catch (caught) {
      if (caught instanceof ApiError) throw caught;
      throw new ApiError({
        code: "invalid_response",
        retryable: true,
        safe_message:
          "The service response could not be read. No change is shown as completed.",
        status: response.status,
      });
    }
    if (!response.ok) {
      const error = payload?.error;
      const code = error?.code ?? "request_failed";
      const problem = new ApiError({
        code,
        retryable: Boolean(error?.retryable),
        correlation_id: error?.correlation_id,
        safe_message:
          rateLimitMessage(code, retryAfterSeconds(error, response.headers.get("retry-after"))) ??
          error?.safe_message ??
          "The request could not be completed.",
        status: response.status,
      });
      this.problemListener?.(problem);
      throw problem;
    }
    return payload as T;
  }
  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  }
  delete<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: "DELETE",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

async function readBounded(
  response: Response,
  maximum: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ApiError({
        code: "response_too_large",
        retryable: true,
        safe_message:
          "The service returned more data than this page can safely display.",
        status: response.status,
      });
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder().decode(output);
}

export function queryString(input: Record<string, string | undefined>) {
  const values = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value && !key.startsWith("_")) values.set(key, value);
  });
  const output = values.toString();
  return output ? `?${output}` : "";
}

export const idempotencyKey = () => crypto.randomUUID();

type Reader = Pick<ApiClient, "get">;
/** One /v1/config read per client, which lives as long as the signed-in page (App's ApiClient). */
const configs = new WeakMap<Reader, Promise<unknown>>();
/**
 * The organization's settings (/v1/config), read once per session and shared by every admin page,
 * which all need its time zone before they can ask for figures. A failed read is not kept.
 * forgetCompanyConfig drops it on sign-out, a role change, a session reload and a policy save.
 */
export function companyConfig<T>(api: Reader): Promise<T> {
  let flight = configs.get(api);
  if (!flight) {
    const read = api.get<T>("/v1/config");
    flight = read;
    configs.set(api, read);
    read.catch(() => {
      if (configs.get(api) === read) configs.delete(api);
    });
  }
  return flight as Promise<T>;
}
export function forgetCompanyConfig(api: Reader) {
  configs.delete(api);
}

/**
 * Admin figures already read on this signed-in page, so that going back to a page or period shows
 * them at once while the page reads them again. One store per client (App's ApiClient), keyed by
 * the exact request path and query, so an answer is only ever shown again for the identical
 * request. Every write through the client, a change of signed-in account and forgetSessionReads
 * drop the whole store: a deletion, erasure, role change or policy save can change any figure.
 */
type FigureStore = {
  scope: string;
  /** Raised by every forget, so a read that started before it cannot store its older answer. */
  generation: number;
  entries: Map<string, { value: unknown; at: number }>;
};
const figureStores = new WeakMap<object, FigureStore>();
// A large organization's summary can be several MiB (up to the 16 MiB answer limit), so only the
// answers of a few pages and periods are kept: enough to go back and forth between them.
const REMEMBERED_FIGURES = 12;

function figureStore(api: object): FigureStore {
  let store = figureStores.get(api);
  if (!store) {
    store = { scope: "", generation: 0, entries: new Map() };
    figureStores.set(api, store);
  }
  return store;
}

/** The answer last read for exactly this request on this client, with when it arrived (ms). */
export function rememberedFigures<T>(api: object, key: string): { value: T; at: number } | undefined {
  return figureStores.get(api)?.entries.get(key) as { value: T; at: number } | undefined;
}

/**
 * Reads figures and keeps the answer for rememberedFigures. A failed read also drops the kept
 * answer, so a page never goes back to showing figures that its last refresh could not confirm.
 */
export async function readFigures<T>(api: object, key: string, read: () => Promise<T>): Promise<T> {
  const store = figureStore(api);
  const generation = store.generation;
  try {
    const value = await read();
    if (store.generation === generation) {
      store.entries.delete(key);
      store.entries.set(key, { value, at: Date.now() });
      // A Map keeps insertion order, so the first key is the answer read longest ago.
      if (store.entries.size > REMEMBERED_FIGURES) store.entries.delete(store.entries.keys().next().value!);
    }
    return value;
  } catch (caught) {
    if (store.generation === generation) store.entries.delete(key);
    throw caught;
  }
}

export function forgetFigures(api: object) {
  const store = figureStores.get(api);
  if (!store) return;
  store.entries.clear();
  store.generation++;
}

/**
 * Names the signed-in account the kept figures belong to. Another account (signed in from another
 * tab, for example) starts with none, even before any write through this client.
 */
export function setFigureScope(api: object, scope: string) {
  const store = figureStore(api);
  if (store.scope === scope) return;
  forgetFigures(api);
  store.scope = scope;
}

/** What sign-out, a role change, a session reload and a policy save make stale. */
export function forgetSessionReads(api: Reader) {
  forgetCompanyConfig(api);
  forgetFigures(api);
}

/** Clients whose server refused splits=none (servers from before 15 October 2026). */
const fullSummariesOnly = new WeakSet<Reader>();
/**
 * A summary read only for its totals, asked for without the day, tool and model splits
 * (splits=none), which are most of a large organization's summary. A server that does not know the
 * parameter answers 422 unsupported_filter; the summary is then read in full, which holds the same
 * totals, and later reads from this client skip the parameter.
 */
export async function summaryTotals<T>(api: Reader, path: string): Promise<T> {
  if (fullSummariesOnly.has(api)) return api.get<T>(path);
  const url = new URL(path, "https://example.invalid");
  url.searchParams.set("splits", "none");
  try {
    return await api.get<T>(url.pathname + url.search);
  } catch (caught) {
    if (
      !(caught instanceof ApiError) ||
      caught.status !== 422 ||
      caught.code !== "unsupported_filter"
    )
      throw caught;
    fullSummariesOnly.add(api);
    return api.get<T>(path);
  }
}
