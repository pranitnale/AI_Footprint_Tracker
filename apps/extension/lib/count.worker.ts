import {
  BUNDLED_TOKENIZER,
  COUNT_LIMITS,
  countFields,
  unavailableCountResponse,
  validateCountCommand,
  type CountCommand,
  type CountRequest,
  type CountResponse,
  type TokenizerImplementation,
} from "@footprint/tokenizers/worker";
import { PACKAGED_TOKENIZER } from "./counting-worker-config";

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: CountResponse): void;
};

/** A single bounded queue keeps one tokenizer module instance per worker. */
export class CountWorkerRuntime {
  private active: { request: CountRequest; abort: AbortController } | null =
    null;
  private queue: CountRequest[] = [];
  private seen: string[] = [];

  constructor(
    private readonly post: (response: CountResponse) => void,
    private readonly implementation: TokenizerImplementation = BUNDLED_TOKENIZER,
  ) {}

  receive(value: unknown) {
    try {
      validateCountCommand(value);
    } catch {
      return;
    }
    const command = value as CountCommand;
    if (command.type === "cancel") {
      this.cancel(command.jobId, command.revision);
      return;
    }
    const request = command.request;
    const selection = {
      implementationId: request.implementationId,
      profileId: request.profileId,
    };
    if (
      this.seen.includes(request.jobId) ||
      this.active?.request.jobId === request.jobId ||
      this.queue.some((item) => item.jobId === request.jobId)
    ) {
      this.post(unavailableCountResponse(request, "duplicate_job", selection));
      return;
    }
    if (this.queue.length + (this.active ? 1 : 0) >= COUNT_LIMITS.pendingJobs) {
      this.post(unavailableCountResponse(request, "busy", selection));
      return;
    }
    this.seen.push(request.jobId);
    if (this.seen.length > COUNT_LIMITS.pendingJobs * 8) this.seen.shift();
    this.queue.push(request);
    void this.pump();
  }

  private cancel(jobId: string, revision: number) {
    if (
      this.active?.request.jobId === jobId &&
      this.active.request.revision === revision
    ) {
      this.active.abort.abort();
      return;
    }
    const index = this.queue.findIndex(
      (request) => request.jobId === jobId && request.revision === revision,
    );
    if (index < 0) return;
    const [request] = this.queue.splice(index, 1);
    this.post(
      unavailableCountResponse(request, "cancelled", {
        implementationId: request.implementationId,
        profileId: request.profileId,
      }),
    );
  }

  private async pump() {
    if (this.active) return;
    const request = this.queue.shift();
    if (!request) return;
    const abort = new AbortController();
    this.active = { request, abort };
    let response: CountResponse;
    try {
      response = await countFields(request, this.implementation, abort.signal);
    } catch {
      response = unavailableCountResponse(request, "tokenizer_unavailable", {
        implementationId: request.implementationId,
        profileId: request.profileId,
      });
    }
    if (this.active?.request === request) {
      this.active = null;
      this.post(response);
    }
    void this.pump();
  }
}

const scope = self as unknown as WorkerScope;
const runtime = new CountWorkerRuntime(
  (response) => scope.postMessage(response),
  PACKAGED_TOKENIZER,
);
scope.onmessage = (event) => runtime.receive(event.data);
