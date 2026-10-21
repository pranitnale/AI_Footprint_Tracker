import {
  resolveApplicationRepository,
  type RepositorySource,
  type Scope,
} from "@footprint/ledger";

/** Coalesce committed routing changes without broadcasting any identity or credential. */
export async function observeScopeChanges(
  repository: RepositorySource,
  currentScope: () => Promise<Scope>,
  notify: () => Promise<void>,
) {
  const ledger = resolveApplicationRepository(repository);
  const signature = async () => {
    const scope = await currentScope();
    const state = await ledger.publicationSnapshot(scope.namespace);
    return JSON.stringify([
      scope,
      state.ownership?.start,
      state.ownership?.end,
      state.credentials?.device_id,
      state.credentials?.enrollment_state,
      state.credentials?.policy?.deletion_epoch,
      state.erasureVersion,
      state.erasing,
    ]);
  };
  let previous = await signature(),
    active = true,
    dirty = false;
  let work: Promise<void> | null = null;
  const changed = () => {
    dirty = true;
    if (work || !active) return;
    work = (async () => {
      for (let turn = 0; turn < 4 && dirty && active; turn++) {
        dirty = false;
        const next = await signature();
        if (next !== previous) {
          previous = next;
          await notify();
        }
      }
    })()
      .catch(async () => {
        if (active) await notify().catch(() => {});
      })
      .finally(() => {
        work = null;
        if (dirty && active) queueMicrotask(changed);
      });
  };
  const unsubscribe = ledger.onRoutingChange(changed);
  return {
    async settled() {
      while (work) await work;
    },
    stop() {
      active = false;
      dirty = false;
      unsubscribe();
    },
    check: changed,
  };
}

/** Only committed association rejections notify recorded-thread views; ordinary progress is silent. */
export async function observeThreadInvalidations(
  repository: RepositorySource,
  currentScope: () => Promise<Scope>,
  notify: (
    stillCurrent: () => Promise<boolean>,
    deliveryId: string,
  ) => Promise<void>,
  onFailure?: (code: "sync_delayed") => void | Promise<void>,
) {
  const ledger = resolveApplicationRepository(repository);
  const read = async () => {
    for (let retry = 0; retry < 3; retry++) {
      const scope = await currentScope(),
        snapshot = await ledger.publicationSnapshot(scope.namespace),
        after = await currentScope();
      if (
        JSON.stringify(scope) === JSON.stringify(after) &&
        snapshot.ownership?.scope?.namespace === scope.namespace &&
        snapshot.ownership?.scope?.era === scope.era
      )
        return {
          scope,
          erasure: snapshot.erasureVersion,
          rejection: snapshot.threadRejectionVersion,
          erasing: snapshot.erasing,
        };
    }
    throw new Error("policy_unavailable");
  };
  let previous: Awaited<ReturnType<typeof read>> | null = null,
    active = true,
    dirty = false,
    reportedFailure = false,
    retryStep = 0;
  let work: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delays = [250, 1000, 5000, 15000, 30000];
  const schedule = (delay: number) => {
    if (!active || timer) return;
    timer = setTimeout(() => {
      timer = null;
      changed();
    }, delay);
    (timer as unknown as { unref?: () => void }).unref?.();
  };
  const changed = () => {
    dirty = true;
    if (work || timer || !active) return;
    work = (async () => {
      for (let turn = 0; turn < 4 && dirty && active; turn++) {
        dirty = false;
        const next = await read(),
          before = previous;
        if (!active) return;
        if (
          next.erasing ||
          (before &&
            (JSON.stringify(before.scope) !== JSON.stringify(next.scope) ||
              before.erasure !== next.erasure)) ||
          next.rejection <= (before?.rejection ?? 0)
        ) {
          previous = next;
          retryStep = 0;
          reportedFailure = false;
          continue;
        }
        await notify(
          async () => {
            if (!active) return false;
            const current = await read();
            return (
              !current.erasing &&
              JSON.stringify(current.scope) === JSON.stringify(next.scope) &&
              current.erasure === next.erasure &&
              current.rejection >= next.rejection
            );
          },
          JSON.stringify([
            next.scope.namespace,
            next.scope.era,
            next.erasure,
            next.rejection,
          ]),
        );
        // Advance only after delivery succeeds or its scope guard explicitly supersedes the delivery.
        previous = next;
        retryStep = 0;
        reportedFailure = false;
      }
    })()
      .catch(async () => {
        if (!active) return;
        dirty = true;
        if (!reportedFailure) {
          reportedFailure = true;
          try {
            await onFailure?.("sync_delayed");
          } catch {}
        }
        schedule(delays[Math.min(retryStep++, delays.length - 1)]!);
      })
      .finally(() => {
        work = null;
        if (dirty && active && !timer) schedule(0);
      });
  };
  const unsubscribe = ledger.onRoutingChange(changed);
  changed();
  if (work) await work;
  return {
    async settled() {
      while (work) await work;
    },
    stop() {
      active = false;
      dirty = false;
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribe();
    },
  };
}
