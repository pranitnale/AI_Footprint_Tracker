import {
  countAccessibleFile,
  unavailable,
  validateFileJob,
  type AccessibleFileJob,
  type FileCountResult,
} from "@footprint/file-text";
import type { TokenizerImplementation } from "@footprint/tokenizers/metadata";
import pdfWorkerSrc from "@footprint/file-text/pdf-worker?worker&url";
import { PACKAGED_TOKENIZER } from "./counting-worker-config";

export class FileWorkerRuntime {
  private active: { job: AccessibleFileJob; abort: AbortController } | null =
    null;
  private disposed = false;
  constructor(
    private readonly post: (result: FileCountResult) => void,
    private readonly tokenizer: TokenizerImplementation = PACKAGED_TOKENIZER,
    private readonly pdfSource: string | undefined = pdfWorkerSrc,
  ) {}

  async receive(value: unknown): Promise<void> {
    if (this.disposed) return;
    if (value && typeof value === "object" && "cancel" in value) {
      const command = value as { cancel: unknown; revision?: unknown };
      const keys = Object.keys(command).sort().join(",");
      if (
        (keys === "cancel" || keys === "cancel,revision") &&
        typeof command.cancel === "string" &&
        (command.revision === undefined ||
          (Number.isSafeInteger(command.revision) &&
            command.revision === this.active?.job.revision)) &&
        this.active &&
        command.cancel === this.active.job.jobId
      )
        this.active.abort.abort();
      return;
    }
    const job = value;
    try {
      validateFileJob(job);
    } catch {
      return;
    }
    if (this.active) {
      this.post(unavailable(job, "busy"));
      return;
    }
    const abort = new AbortController();
    const active = { job, abort };
    this.active = active;
    try {
      const result = await countAccessibleFile(job, {
        signal: abort.signal,
        pdfWorkerSrc: this.pdfSource,
        tokenizer: this.tokenizer,
      });
      if (!this.disposed && this.active === active) this.post(result);
    } finally {
      if (this.active === active) this.active = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.active?.abort.abort();
  }
}

const runtime = new FileWorkerRuntime((result) => self.postMessage(result));
self.onmessage = (event: MessageEvent) => runtime.receive(event.data);
