/**
 * Passive proof that the page's chat requests reach the tracker's fetch wrapper.
 *
 * Another script, such as the site's own monitoring SDK, can wrap fetch after the tracker.
 * The wrapper's identity then no longer shows coverage, and the tracker must never send a
 * test request (handover section 3). The browser's own Resource Timing list still records
 * every request the page finished, so each finished generation request there must match one
 * the wrapper forwarded. The check only reads that list; it never sends, delays or changes a
 * request.
 */
export type FetchCoverage = "monitored" | "missed" | "unavailable";

// Distinct addresses waiting for their timing entry. Past this the check stops instead of
// forgetting one, because a forgotten request would later read as missed.
export const COVERAGE_PENDING_LIMIT = 1000;

interface TimingEntry {
  name: string;
  initiatorType?: string;
}
type ObserverConstructor = new (
  callback: (list: { getEntries(): TimingEntry[] }) => void,
) => { observe(options: { type: string; buffered: boolean }): void };

export class FetchCoverageCheck {
  private readonly requestURL = Object.getOwnPropertyDescriptor(
    Request.prototype,
    "url",
  )!.get!;
  private readonly urlHref = Object.getOwnPropertyDescriptor(
    URL.prototype,
    "href",
  )!.get!;
  private readonly pending = new Map<string, number>();
  private missed = false;
  private observing = false;
  // A forwarded request whose address could not be read, or too many pending addresses.
  private blind = false;

  constructor(
    private readonly origin: string,
    private readonly route: (url: URL) => boolean,
  ) {}

  private key(url: URL): string | null {
    if (url.origin !== this.origin || !this.route(url)) return null;
    return url.origin + url.pathname + url.search;
  }

  /**
   * Reads a fetch input's address with the intrinsics captured at install, so a page
   * object's own toString or getters never run. Other inputs return null.
   */
  private address(input: unknown, base: string): URL | null {
    try {
      if (typeof input === "string") return new URL(input, base);
      try {
        return new URL(Reflect.apply(this.requestURL, input, []) as string);
      } catch {}
      return new URL(Reflect.apply(this.urlHref, input, []) as string);
    } catch {
      return null;
    }
  }

  /**
   * The wrapper is forwarding this request to the network. `base` must be the document's
   * base address, which fetch resolves relative addresses against.
   */
  passed(input: unknown, base: string) {
    const url = this.address(input, base);
    if (!url) {
      this.blind = true;
      return;
    }
    const key = this.key(url);
    if (!key) return;
    const count = this.pending.get(key) ?? 0;
    if (!count && this.pending.size >= COVERAGE_PENDING_LIMIT) {
      this.blind = true;
      return;
    }
    this.pending.set(key, count + 1);
  }

  /**
   * The browser finished a request. A timing entry appears only after the request was sent,
   * so a request that passed the wrapper is always counted before its entry arrives.
   * Returns true for the first miss.
   */
  recorded(entry: TimingEntry): boolean {
    if (entry.initiatorType !== "fetch" || this.blind) return false;
    let url: URL;
    try {
      url = new URL(entry.name);
    } catch {
      return false;
    }
    const key = this.key(url);
    if (!key) return false;
    const count = this.pending.get(key) ?? 0;
    if (count > 1) this.pending.set(key, count - 1);
    else if (count === 1) this.pending.delete(key);
    else if (!this.missed) return (this.missed = true);
    return false;
  }

  /**
   * Listens to the browser's timing entries. An observer, not the stored list, because the
   * stored list stops at 250 entries and busy chat pages reach that (seen on claude.ai,
   * 12 October 2026).
   */
  observe(Observer: unknown, onMiss: () => void) {
    if (typeof Observer !== "function") return;
    try {
      new (Observer as ObserverConstructor)((list) => {
        for (const entry of list.getEntries())
          if (this.recorded(entry)) onMiss();
      }).observe({ type: "resource", buffered: true });
      this.observing = true;
    } catch {}
  }

  state(): FetchCoverage {
    if (this.missed) return "missed";
    return this.observing && !this.blind ? "monitored" : "unavailable";
  }
}
