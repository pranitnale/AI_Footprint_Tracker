import { Component, Suspense, lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Button, Notice } from "@footprint/ui";
import { Loading } from "./status";

/** A route group's code could not be downloaded, usually because a redeploy removed the old files. */
export class RouteLoadError extends Error {
  constructor(cause: unknown) {
    super("A part of the website could not be loaded.", { cause });
    this.name = "RouteLoadError";
  }
}

/**
 * Loads a route group's code once, so that App can start the download while it still checks the
 * session and the lazy pages reuse that download. A failure is kept, because the browser would only
 * ask for the same missing file again; reloading the page fetches the current file names.
 */
export function routeChunk<M>(load: () => Promise<M>): () => Promise<M> {
  let flight: Promise<M> | undefined;
  return () =>
    (flight ??= load().catch((cause) => {
      throw new RouteLoadError(cause);
    }));
}

/** One named component of a route group, rendered once its group's code has arrived. */
export function lazyPage<M, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K] & ComponentType<any>> {
  return lazy(() => load().then((module) => ({ default: module[name] as M[K] & ComponentType<any> })));
}

/**
 * Shows `label` with the usual loading spinner while a route group's code downloads, and a reload
 * action if it cannot be downloaded. Give each route group its own key, so a failure in one group
 * does not stay on screen after moving to another.
 */
export function RouteGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RouteBoundary>
      <Suspense fallback={<Loading label={label} />}>{children}</Suspense>
    </RouteBoundary>
  );
}

class RouteBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Other render errors keep their earlier behavior: they are not hidden behind a reload message.
    if (!(error instanceof RouteLoadError)) throw error;
    return (
      <div className="loading">
        <Notice tone="danger" title="This page could not be loaded">
          <p>
            The website may have been updated since this tab opened it. Reload the page to get the
            latest version. Your data is not affected.
          </p>
          <Button variant="primary" onClick={() => location.reload()}>
            Reload page
          </Button>
        </Notice>
      </div>
    );
  }
}
