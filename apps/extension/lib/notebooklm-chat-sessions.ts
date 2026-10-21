import {
  HISTORY_LIMITS,
  NOTEBOOKLM_SESSIONS_RPC,
  notebooklmChatSessions,
} from "@footprint/adapters";
import { NOTEBOOKLM_BATCH_PATH } from "@footprint/capture-core";
import { historyRequestConversation } from "./history-route";

/** Notebooks whose session lists are kept; one page rarely opens more. */
const NOTEBOOKS = 16;

/**
 * The chat sessions each notebook lists, from the list the page itself reads the first time
 * a notebook opens in a document (14 Oct 2026). Nothing is fetched here. A page of saved
 * turns proves a notebook's first message only when this list names its session alone, so
 * a list that is missing, unreadable or names other sessions simply proves nothing.
 */
export function createNotebooklmChatSessions() {
  const cloneResponse = Response.prototype.clone;
  const getReader = ReadableStream.prototype.getReader;
  const read = ReadableStreamDefaultReader.prototype.read;
  const cancel = ReadableStreamDefaultReader.prototype.cancel;
  const cancelStream = ReadableStream.prototype.cancel;
  const lists = new Map<string, { sessions: string[] | null; order: number }>();
  let reads = 0;
  /** The body as text, or null past the history response limit. */
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
      if (text.length > HISTORY_LIMITS.responseBytes) {
        void Reflect.apply(cancel, reader, []).catch(() => {});
        return null;
      }
    }
  };
  return {
    /** Whether the request is the session list; true tells the caller it is handled. */
    observe(
      url: URL,
      method: string,
      promise: Promise<Response> | null,
      body?: unknown,
      /** The response is already a private clone (a request read after it was sent). */
      cloned = false,
    ): boolean {
      const rpcs = url.searchParams.getAll("rpcids");
      if (
        url.pathname !== NOTEBOOKLM_BATCH_PATH ||
        rpcs.length !== 1 ||
        rpcs[0] !== NOTEBOOKLM_SESSIONS_RPC
      )
        return false;
      const notebook = historyRequestConversation(
        "notebooklm",
        url,
        method,
        body,
      );
      if (!notebook || !promise) {
        // A private clone left unread would hold the whole response.
        if (cloned && promise)
          void promise.then(
            (response) =>
              response.body &&
              Reflect.apply(cancelStream, response.body, []).catch(() => {}),
            () => {},
          );
        return true;
      }
      const order = ++reads;
      void promise
        .then((response) =>
          bounded(
            cloned
              ? response
              : (Reflect.apply(cloneResponse, response, []) as Response),
          ),
        )
        .then((text) => {
          // A slower older list never replaces a newer one.
          if ((lists.get(notebook)?.order ?? 0) > order) return;
          lists.delete(notebook);
          lists.set(notebook, {
            sessions: text === null ? null : notebooklmChatSessions(text),
            order,
          });
          while (lists.size > NOTEBOOKS)
            lists.delete(lists.keys().next().value!);
        })
        .catch(() => {});
      return true;
    },
    /** The notebook's sessions as last listed, or null when no readable list was seen. */
    sessions(notebook: string): readonly string[] | null {
      return lists.get(notebook)?.sessions ?? null;
    },
  };
}
