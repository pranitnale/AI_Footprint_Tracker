import {
  isDisplayBinding,
  isRouteConversationId,
  parseConversationRoute,
  siteForHost,
  type DisplayBinding,
  type RouteSite,
} from "@footprint/capture-core";

type Sender = {
  id?: string;
  url?: string;
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
  tab?: { id?: number };
};
export interface RouteGuard {
  check(): void;
  checkActivity?(): void;
  verify(): Promise<void>;
}
type RememberedRoute = {
  binding: DisplayBinding;
  site: RouteSite;
  conversationId: string;
  url: string;
  origin: string;
  expires: number;
};
type RememberedCapture = Omit<RememberedRoute, "conversationId"> & {
  conversationId: string | null;
};
export class RouteAuthorities {
  private remembered = new Map<number, RememberedRoute>();
  private captures = new Map<number, RememberedCapture>();
  private pending = new Map<number, { settled: Promise<void> }>();
  private updateFlights = new Map<number, number>();
  private waiting = new Map<number, number>();
  private active = new Set<{
    tabId: number;
    valid: boolean;
    expires: number;
    route: RememberedRoute;
  }>();
  constructor(
    private dependencies: {
      extensionId: string;
      getTab(tabId: number): Promise<{
        id?: number;
        url?: string;
        pendingUrl?: string;
        status?: string;
      }>;
      hasPermission(origin: string): Promise<boolean>;
      confirm(
        tabId: number,
        message: {
          target: "footprint-route-current";
          binding: DisplayBinding;
          site: RouteSite;
          conversationId: string;
        },
        documentId?: string,
      ): Promise<unknown>;
      confirmCapture?(
        tabId: number,
        message: {
          target: "footprint-capture-current";
          binding: DisplayBinding;
          site: RouteSite;
          conversationId: string | null;
          path: string;
        },
      ): Promise<unknown>;
    },
  ) {}
  invalidate(tabId: number) {
    this.remembered.delete(tabId);
    this.captures.delete(tabId);
    this.pending.delete(tabId);
    for (const lease of this.active)
      if (lease.tabId === tabId) lease.valid = false;
  }
  invalidateAll() {
    this.remembered.clear();
    this.captures.clear();
    this.pending.clear();
    for (const lease of this.active) lease.valid = false;
  }
  rememberCapture(
    sender: Sender,
    binding: DisplayBinding,
    site: RouteSite,
    conversationId: string | null,
    event: "dispatch" | "progress" | "end",
  ) {
    if (
      sender.tab?.id == null ||
      sender.id !== this.dependencies.extensionId ||
      sender.frameId !== 0 ||
      !binding.captureId ||
      !isDisplayBinding(binding, binding.captureId) ||
      (sender.documentLifecycle !== undefined &&
        sender.documentLifecycle !== "active")
    )
      return;
    let url: URL;
    try {
      url = new URL(sender.url ?? "");
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      siteForHost(url.hostname) !== site ||
      (conversationId !== null && !isRouteConversationId(site, conversationId))
    )
      return;
    this.trim();
    if (this.captures.size >= 128 && !this.captures.has(sender.tab.id)) return;
    const previous = this.captures.get(sender.tab.id);
    if (
      previous &&
      previous.binding.captureId !== binding.captureId &&
      event !== "dispatch"
    )
      return;
    if (
      previous?.binding.captureId === binding.captureId &&
      previous.conversationId &&
      conversationId &&
      previous.conversationId !== conversationId
    ) {
      this.captures.delete(sender.tab.id);
      return;
    }
    this.captures.set(sender.tab.id, {
      binding: { ...binding },
      site,
      url: url.href,
      origin: url.origin,
      expires: Date.now() + 600000,
      conversationId:
        conversationId ??
        (previous?.binding.captureId === binding.captureId
          ? previous.conversationId
          : null),
    });
  }
  private trim() {
    for (const map of [this.remembered, this.captures])
      for (const [tabId, value] of map)
        if (value.expires <= Date.now()) map.delete(tabId);
  }
  private rememberRoute(tabId: number, route: RememberedRoute) {
    this.trim();
    if (this.remembered.size < 128 || this.remembered.has(tabId))
      this.remembered.set(tabId, route);
  }
  /** Native update notifications are hints; only the current top frame can confirm a retained binding. */
  updated(
    tabId: number,
    change: { url?: string; status?: string },
    invalidate: (documentNonce?: string, preserveCapture?: boolean) => void,
  ): Promise<void> {
    this.trim();
    if (
      (this.updateFlights.get(tabId) ?? 0) >= 4 ||
      (!this.updateFlights.has(tabId) && this.updateFlights.size >= 256)
    ) {
      this.invalidate(tabId);
      invalidate();
      return Promise.resolve();
    }
    const previous = this.remembered.get(tabId);
    const candidates = [...this.active]
      .filter((lease) => lease.tabId === tabId && lease.valid)
      .map((lease) => lease.route);
    if (previous) candidates.push(previous);
    const unique = new Map(
      candidates.map((candidate) => [
        JSON.stringify([
          candidate.binding,
          candidate.site,
          candidate.conversationId,
        ]),
        candidate,
      ]),
    );
    const routes = [...unique.values()],
      capture = this.captures.get(tabId);
    if (change.url !== undefined) {
      for (const lease of this.active)
        if (lease.tabId === tabId) {
          try {
            const url = new URL(change.url);
            if (
              url.origin !== lease.route.origin ||
              parseConversationRoute(lease.route.site, url.pathname)
                ?.conversationId !== lease.route.conversationId
            )
              lease.valid = false;
          } catch {
            lease.valid = false;
          }
        }
    }
    if (!routes.length && !capture) {
      this.invalidate(tabId);
      invalidate();
      return Promise.resolve();
    }
    const ticket = { settled: Promise.resolve() };
    this.pending.set(tabId, ticket);
    this.updateFlights.set(tabId, (this.updateFlights.get(tabId) ?? 0) + 1);
    const current = (reply: unknown) =>
      !!reply &&
      typeof reply === "object" &&
      Object.keys(reply).length === 1 &&
      (reply as { current?: unknown }).current === true;
    const operation = (async () => {
      const tab = await this.dependencies.getTab(tabId);
      if (
        tab.id !== tabId ||
        !tab.url ||
        tab.pendingUrl ||
        (change.url !== undefined && change.url !== tab.url)
      )
        return null;
      const url = new URL(tab.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !(await this.dependencies.hasPermission(url.origin))
      )
        return null;
      const matches = (
        await Promise.all(
          routes.map(async (route) => {
            if (
              route.origin !== url.origin ||
              parseConversationRoute(route.site, url.pathname)
                ?.conversationId !== route.conversationId
            )
              return null;
            return current(
              await this.dependencies.confirm(tabId, {
                target: "footprint-route-current",
                binding: { ...route.binding },
                site: route.site,
                conversationId: route.conversationId,
              }),
            )
              ? route
              : null;
          }),
        )
      ).filter((value): value is RememberedRoute => value !== null);
      if (matches.length > 1) return null;
      const routeCurrent = matches[0] ?? null;
      const captureCurrent =
        !!capture &&
        new URL(capture.url).origin === url.origin &&
        !!this.dependencies.confirmCapture &&
        current(
          await this.dependencies.confirmCapture(tabId, {
            target: "footprint-capture-current",
            binding: { ...capture.binding },
            site: capture.site,
            conversationId: capture.conversationId,
            path: new URL(capture.url).pathname,
          }),
        );
      const after = await this.dependencies.getTab(tabId);
      if (
        after.id !== tabId ||
        after.url !== tab.url ||
        after.pendingUrl ||
        !(await this.dependencies.hasPermission(url.origin))
      )
        return null;
      return { routeCurrent, captureCurrent };
    })().finally(() => {
      const remaining = (this.updateFlights.get(tabId) ?? 1) - 1;
      if (remaining) this.updateFlights.set(tabId, remaining);
      else this.updateFlights.delete(tabId);
    });
    let timeout: ReturnType<typeof setTimeout>;
    const bounded = Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 2000);
      }),
    ])
      .catch(() => null)
      .finally(() => clearTimeout(timeout));
    ticket.settled = bounded.then((proof) => {
      if (this.pending.get(tabId) !== ticket) return;
      this.pending.delete(tabId);
      if (proof?.routeCurrent) {
        const validBinding = proof.routeCurrent.binding;
        for (const lease of this.active)
          if (
            lease.tabId === tabId &&
            (lease.route.binding.documentNonce !== validBinding.documentNonce ||
              lease.route.binding.navigationNonce !==
                validBinding.navigationNonce)
          )
            lease.valid = false;
        this.rememberRoute(tabId, proof.routeCurrent);
        if (
          previous &&
          previous.binding.documentNonce !== validBinding.documentNonce
        )
          invalidate(previous.binding.documentNonce, false);
        if (capture && !proof.captureCurrent) this.captures.delete(tabId);
        return;
      }
      for (const lease of this.active)
        if (lease.tabId === tabId) lease.valid = false;
      this.remembered.delete(tabId);
      if (!proof?.captureCurrent) this.captures.delete(tabId);
      const nonce =
        routes.length === 1
          ? routes[0]!.binding.documentNonce
          : capture?.binding.documentNonce;
      invalidate(nonce, proof?.captureCurrent === true);
    });
    return ticket.settled;
  }
  async run<T>(
    sender: Sender,
    binding: DisplayBinding,
    site: RouteSite,
    conversationId: string,
    work: (guard: RouteGuard, currentSender: Sender) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const origin = new URL(sender.url ?? "invalid:");
    if (
      sender.id !== this.dependencies.extensionId ||
      sender.frameId !== 0 ||
      sender.tab?.id == null ||
      !isDisplayBinding(binding, null) ||
      !isRouteConversationId(site, conversationId) ||
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.port ||
      siteForHost(origin.hostname) !== site ||
      (sender.documentLifecycle !== undefined &&
        sender.documentLifecycle !== "active")
    )
      throw new Error("payload_rejected");
    if (this.pending.has(sender.tab.id)) {
      if (
        (this.waiting.get(sender.tab.id) ?? 0) >= 8 ||
        [...this.waiting.values()].reduce((sum, count) => sum + count, 0) >= 256
      )
        throw new Error("capture_limit_exceeded");
      this.waiting.set(
        sender.tab.id,
        (this.waiting.get(sender.tab.id) ?? 0) + 1,
      );
      try {
        while (this.pending.has(sender.tab.id)) {
          await this.pending.get(sender.tab.id)!.settled;
          if (Date.now() - startedAt >= 30000)
            throw new Error("partial_capture");
        }
      } finally {
        const remaining = this.waiting.get(sender.tab.id)! - 1;
        if (remaining) this.waiting.set(sender.tab.id, remaining);
        else this.waiting.delete(sender.tab.id);
      }
    }
    if (
      this.active.size >= 256 ||
      [...this.active].filter((lease) => lease.tabId === sender.tab!.id)
        .length >= 8
    )
      throw new Error("capture_limit_exceeded");
    const tabId = sender.tab.id,
      lease = {
        tabId,
        valid: true,
        expires: startedAt + 30000,
        route: {
          binding: { ...binding },
          site,
          conversationId,
          origin: origin.origin,
          url: "",
          expires: startedAt + 30000,
        },
      };
    this.active.add(lease);
    let committedUrl = "";
    const checkActivity = () => {
      if (!lease.valid || Date.now() >= lease.expires)
        throw new Error("partial_capture");
    };
    const check = () => {
      checkActivity();
      if (this.pending.has(tabId)) throw new Error("route_pending");
    };
    const settle = async () => {
      while (this.pending.has(tabId)) {
        await this.pending.get(tabId)!.settled;
        checkActivity();
      }
    };
    const readTab = async () => {
      const tab = await this.dependencies.getTab(tabId);
      checkActivity();
      const url = new URL(tab.url ?? "invalid:");
      if (
        tab.id !== tabId ||
        tab.pendingUrl ||
        url.origin !== origin.origin ||
        url.username ||
        url.password ||
        url.port ||
        parseConversationRoute(site, url.pathname)?.conversationId !==
          conversationId
      )
        throw new Error("partial_capture");
      committedUrl = url.href;
      lease.route.url = url.href;
    };
    const verify = async () => {
      await settle();
      checkActivity();
      await readTab();
      if (!(await this.dependencies.hasPermission(origin.origin)))
        throw new Error("capture_hook_missing");
      await settle();
      checkActivity();
      const response = await this.dependencies.confirm(
        tabId,
        {
          target: "footprint-route-current",
          binding: { ...binding },
          site,
          conversationId,
        },
        // A document-targeted reply can come from a cached document. Confirm the current top frame instead.
        undefined,
      );
      await settle();
      checkActivity();
      if (
        !response ||
        typeof response !== "object" ||
        Object.keys(response).length !== 1 ||
        (response as { current?: unknown }).current !== true
      )
        throw new Error("partial_capture");
      await readTab();
      await settle();
      checkActivity();
      this.rememberRoute(tabId, {
        binding: { ...binding },
        site,
        conversationId,
        url: committedUrl,
        origin: origin.origin,
        expires: Date.now() + 30000,
      });
    };
    try {
      await verify();
      // MessageSender.url can retain the document's initial path across SPA navigation.
      const result = await work(
        { check, checkActivity, verify },
        { ...sender, tab: { id: tabId }, url: committedUrl },
      );
      await verify();
      return result;
    } finally {
      lease.valid = false;
      this.active.delete(lease);
    }
  }
}
