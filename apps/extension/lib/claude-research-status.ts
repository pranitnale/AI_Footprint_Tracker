import {
  claudeResearchTask,
  type ClaudeResearchTask,
} from "@footprint/adapters";

// claude.ai polls each Research run's status while it works (E1). Only the latest body
// of each run is kept, and it is parsed when the page reloads the conversation, so long
// runs with hundreds of polls are not parsed hundreds of times.
const STATUS_PATH =
  /^\/api\/organizations\/[0-9a-f-]{36}\/chat_conversations\/([0-9a-f-]{36})\/task\/(wf-[A-Za-z0-9_-]{1,96})\/status$/;
const BODY_LIMIT = 4_194_304;
const RUNS = 8;
const KEEP_MS = 2 * 60 * 60 * 1000;

// `order` is when the page sent the poll; a slower older response never replaces a newer one.
type Run = { conversationId: string; body: string; at: number; order: number };

/**
 * Research status polls the page itself makes. Nothing is fetched here; a run whose
 * status body is too large or unreadable simply has no facts.
 */
export function createClaudeResearchStatus() {
  const cloneResponse = Response.prototype.clone;
  const getReader = ReadableStream.prototype.getReader;
  const read = ReadableStreamDefaultReader.prototype.read;
  const cancel = ReadableStreamDefaultReader.prototype.cancel;
  const runs = new Map<string, Run>();
  let polls = 0;
  const evict = (now: number) => {
    for (const [id, run] of runs) if (now - run.at > KEEP_MS) runs.delete(id);
    while (runs.size > RUNS) runs.delete(runs.keys().next().value!);
  };
  /** The body as text, or null past the limit; the read stops as soon as it is too long. */
  const bounded = async (response: Response) => {
    if (!response.ok || !response.body) return null;
    const reader = Reflect.apply(
      getReader,
      response.body,
      [],
    ) as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    for (;;) {
      const part = (await Reflect.apply(
        read,
        reader,
        [],
      )) as ReadableStreamReadResult<Uint8Array>;
      if (part.done) return text + decoder.decode();
      text += decoder.decode(part.value, { stream: true });
      if (text.length > BODY_LIMIT) {
        void Reflect.apply(cancel, reader, []).catch(() => {});
        return null;
      }
    }
  };
  return {
    /** Keeps the poll when it is one; true tells the caller the request is handled. */
    observe(url: URL, method: string, promise: Promise<Response> | null) {
      const match = method === "GET" ? STATUS_PATH.exec(url.pathname) : null;
      if (!match || !promise) return !!match;
      const [, conversationId, id] = match;
      const order = ++polls;
      // Cloned when the response arrives, before the page reads its own body.
      void promise
        .then((response) =>
          bounded(Reflect.apply(cloneResponse, response, []) as Response),
        )
        .then((body) => {
          if (body === null || (runs.get(id!)?.order ?? 0) > order) return;
          runs.delete(id!);
          runs.set(id!, {
            conversationId: conversationId!,
            body,
            at: Date.now(),
            order,
          });
          evict(Date.now());
        })
        .catch(() => {});
      return true;
    },
    /** Finished runs of one conversation, read from their latest polls. */
    tasks(conversationId: string): ClaudeResearchTask[] {
      evict(Date.now());
      const tasks: ClaudeResearchTask[] = [];
      for (const [id, run] of runs) {
        if (run.conversationId !== conversationId) continue;
        try {
          const task = claudeResearchTask(JSON.parse(run.body), id);
          if (task) tasks.push(task);
        } catch {
          // A body in another format gives no facts.
        }
      }
      return tasks;
    },
  };
}
