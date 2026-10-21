import assert from "node:assert/strict";
import test from "node:test";
import { RouteAuthorities } from "../lib/route-authority";

test(
  "native update proof cannot expand the 128-tab remembered-route limit",
  { timeout: 5000 },
  async () => {
    const conversationId = crypto.randomUUID();
    const url = "https://claude.ai/chat/" + conversationId;
    const routes = new RouteAuthorities({
      extensionId: "synthetic-extension",
      getTab: async (id) => ({ id, url }),
      hasPermission: async () => true,
      confirm: async () => ({ current: true }),
    });
    let entered = 0,
      ready!: () => void,
      release!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = Array.from({ length: 129 }, (_, index) =>
      routes.run(
        { id: "synthetic-extension", frameId: 0, tab: { id: index + 1 }, url },
        {
          documentNonce: crypto.randomUUID(),
          navigationNonce: crypto.randomUUID(),
          captureId: null,
        },
        "claude",
        conversationId,
        async () => {
          if (++entered === 129) ready();
          await gate;
        },
      ),
    );
    try {
      await started;
      let invalidated = 0;
      await routes.updated(129, { status: "loading" }, () => {
        invalidated++;
      });
      assert.equal(
        invalidated,
        0,
        "an active unremembered lease can still prove its current document",
      );
      release();
      await Promise.all(work);
      await routes.updated(129, { status: "loading" }, () => {
        invalidated++;
      });
      assert.equal(
        invalidated,
        1,
        "the 129th tab must not acquire a remembered route through its update proof",
      );
    } finally {
      release();
      await Promise.allSettled(work);
    }
  },
);
