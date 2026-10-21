import test from "node:test";
import assert from "node:assert/strict";
import { NotebooklmChatSession, parseHistoryText } from "../src";
import {
  notebooklmChatSessions,
  notebooklmHistoryFrames,
  type NotebooklmHistoryRead,
} from "../src/history";

// Saved NotebookLM chats, shapes as seen on 14 Oct 2026; ids and text are synthetic.
const NOTEBOOK = "f0000000-0000-4000-8000-0000000000a1";
const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "11111111-1111-4111-8111-1111111111b2";
const at = "2026-10-14T12:00:00.000Z";
const id = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = (n: number): [number, number] => [1791975600 + n, 250000000];

const question = (n: number, text: unknown = `Question ${n}?`) => [
  id(n),
  time(n),
  1,
  text,
  null,
  2,
];
/** An answer as the page saves it: the answer row, quoted passages, then follow-ups. */
const answer = (
  n: number,
  text: unknown = `Answer ${n}.`,
  suggestions: unknown = [["One?", "Two?"]],
) => [
  id(n),
  time(n),
  2,
  null,
  [
    [text, null, [id(90), id(91)], null, [null, null, null, null, 1]],
    [[["a quoted source passage"]]],
    null,
    suggestions,
  ],
  2,
];
/** Turns as the page lists them: newest first. */
const newestFirst = (...turns: unknown[][]) => [...turns].reverse();
function read(
  value: unknown,
  options: { session?: unknown; sessions?: readonly string[] | null } = {},
) {
  let failure: string | undefined;
  const chatRead = {
    rpc: "khqZz",
    value,
    session: "session" in options ? options.session : SESSION,
    sessions: "sessions" in options ? options.sessions : [SESSION],
  } as NotebooklmHistoryRead;
  const page = parseHistoryText("notebooklm", chatRead, NOTEBOOK, at, (r) => {
    failure = r;
  });
  return { page, failure };
}

test("NB1 a saved chat page is read oldest first, each answer after its question", () => {
  const { page } = read([
    newestFirst(question(1), answer(2), question(3), answer(4)),
  ]);
  assert.equal(page.status, "partial");
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.sourceId]),
    [
      ["prompt", id(1)],
      ["response", id(2)],
      ["prompt", id(3)],
      ["response", id(4)],
    ],
  );
  const [q1, a2, q3, a4] = page.messages;
  assert.equal(q1!.text, "Question 1?");
  assert.equal(q1!.complete, true);
  assert.equal(q1!.parentSourceId, null);
  assert.equal(a2!.text, "Answer 2.");
  assert.equal(a2!.intermediate, "One?\nTwo?");
  assert.equal(a2!.toolInput, "");
  assert.equal(a2!.toolOutput, "");
  assert.equal(a2!.thinking, undefined);
  assert.equal(a2!.complete, true);
  assert.equal(a2!.coverageReasons, undefined);
  // A question links through its answer; the answer keeps its own turn id and names its
  // live reply by content (NB5).
  assert.equal(a2!.promptSourceId, id(1));
  assert.equal(a2!.parentSourceId, id(1));
  assert.equal(a2!.parentRole, "prompt");
  assert.equal(a2!.liveAttemptId, id(2));
  assert.equal(a2!.requestId, null);
  assert.equal(q1!.requestId, null);
  assert.equal(q1!.liveAttemptId, null);
  assert.match(a2!.contentId!, /^n_[0-9a-f]{16}$/);
  assert.equal(q1!.contentId, undefined);
  assert.equal(q3!.parentSourceId, id(2));
  assert.equal(q3!.parentRole, "response");
  assert.equal(a4!.promptSourceId, id(3));
  // One time per turn, no latency; no model is named anywhere.
  assert.equal(q1!.occurredAt, "2026-10-14T11:00:01.250000Z");
  assert.equal(q1!.dateBasis, "message_created");
  assert.equal(a2!.occurredAt, "2026-10-14T11:00:02.250000Z");
  assert.equal(a2!.timing, null);
  assert.equal(a2!.modelId, null);
  // Saved chats are not Studio items: they wait for a live match like other sites.
  assert.ok(page.messages.every((m) => !m.coverageReasons?.includes("no_live_request")));
});

test("NB2 only the oldest page of the notebook's one session proves the first request", () => {
  const turns = newestFirst(question(1), answer(2), question(3), answer(4));
  const proven = read([turns]).page;
  assert.equal(proven.firstRequestVerified, true);
  assert.equal(proven.rootSourceId, id(1));
  assert.equal(proven.hasEarlier, false);
  // A continuation means older turns exist.
  const newest = read([turns, "older-page-token"]).page;
  assert.equal(newest.firstRequestVerified, false);
  assert.equal(newest.rootSourceId, null);
  assert.equal(newest.hasEarlier, true);
  // Without the session list, or with another session in it, the start is not proven.
  for (const sessions of [null, [], [SESSION, OTHER_SESSION], [OTHER_SESSION]]) {
    const page = read([turns], { sessions }).page;
    assert.equal(page.firstRequestVerified, false, JSON.stringify(sessions));
    assert.equal(page.hasEarlier, null);
    assert.equal(page.messages.length, 4);
  }
  // A page that starts with an answer has lost its question: no proof.
  const answerFirst = read([newestFirst(answer(2), question(3), answer(4))]).page;
  assert.equal(answerFirst.firstRequestVerified, false);
  // A notebook without saved turns sends no list at all; nothing is counted.
  for (const value of [[], [null], [[]]]) {
    const empty = read(value).page;
    assert.equal(empty.status, "partial");
    assert.equal(empty.messages.length, 0);
    assert.equal(empty.firstRequestVerified, false);
  }
});

test("NB3 an older page may start with an answer whose question is on the next page", () => {
  // Pages hold 20 turns; a question without an answer can shift a page boundary.
  const { page } = read([
    newestFirst(answer(2), question(3), answer(4), question(5)),
    "next-older-page",
  ]);
  assert.deepEqual(
    page.messages.map((m) => [m.role, m.sourceId]),
    [
      ["response", id(2)],
      ["prompt", id(3)],
      ["response", id(4)],
      ["prompt", id(5)],
    ],
  );
  assert.equal(page.messages[0]!.promptSourceId, null);
  assert.equal(page.messages[0]!.parentSourceId, null);
  // An unanswered question, for example a stopped send, still counts as a request.
  assert.equal(page.messages[3]!.parentSourceId, id(4));
});

test("NB4 malformed rows fail closed; unreadable content leaves only that message partial", () => {
  const bad: unknown[] = [
    "not a page",
    ["rows"],
    [[["not-an-id", time(1), 1, "Q?", null, 2]]],
    [[[id(1), time(1), 3, "Q?", null, 2]]],
    [[["x"]]],
    [["row"]],
    [newestFirst(question(1), question(1))],
    // Two answers in a row were never seen.
    [newestFirst(question(1), answer(2), answer(3))],
    [Array.from({ length: 1001 }, (_, i) => question(i))],
  ];
  for (const value of bad) {
    const { page, failure } = read(value);
    assert.equal(page.status, "unsupported", JSON.stringify(value).slice(0, 80));
    assert.equal(page.messages.length, 0);
    assert.equal(failure, "history_unsupported");
  }
  // A read without its session is not a chat page.
  for (const session of [null, undefined, "x"])
    assert.equal(
      read([newestFirst(question(1), answer(2))], { session }).page.status,
      "unsupported",
    );
  // A question whose text is not a string, an answer without its text, follow-ups of
  // another shape: counted as far as read, partial, never zero.
  const { page } = read([
    newestFirst(
      question(1, 42),
      answer(2, { text: "x" }),
      question(3),
      answer(4, "Answer 4.", [[1, 2]]),
      question(5),
      answer(6, "Answer 6.", null),
    ),
  ]);
  const [q1, a2, , a4, , a6] = page.messages;
  assert.equal(q1!.text, null);
  assert.equal(q1!.complete, false);
  assert.equal(a2!.text, null);
  assert.equal(a2!.complete, false);
  // Without its text an answer cannot be named by content, so it links to no live reply.
  assert.equal(a2!.contentId, undefined);
  assert.deepEqual(a2!.coverageReasons, ["unknown_event_observed"]);
  assert.equal(a2!.toolInput, undefined);
  assert.equal(a4!.text, "Answer 4.");
  assert.equal(a4!.intermediate, undefined);
  assert.deepEqual(a4!.coverageReasons, ["unknown_event_observed"]);
  // An answer saved without follow-ups has none.
  assert.equal(a6!.intermediate, undefined);
  assert.equal(a6!.coverageReasons, undefined);
  // A time of another shape leaves the date unknown.
  const undated = read([[[id(1), "yesterday", 1, "Q?", null, 2]]]).page;
  assert.equal(undated.messages[0]!.occurredAt, null);
  assert.equal(undated.messages[0]!.dateBasis, "unknown");
});

test("NB5 a saved answer counts the same text and follow-ups as its live reply, and both name it by content", () => {
  // Seen live on 16 Oct 2026: the stream names its reply `[session, turn, <number>]` from
  // the first frame, and the saved answer keeps another turn id and number, never the live
  // turn id. Only the session and the final answer text are the same.
  const liveTurn = "39a01db2-0000-4000-8000-000000000001";
  const suggestions = ["One?", "Two?"];
  const frame = (text: string, final: boolean) => [
    "wrb.fr",
    null,
    JSON.stringify([
      [text, null, [SESSION, liveTurn, 2748674754], null, [null, null, null, null, 1]],
      [[["a quoted source passage"]]],
      null,
      final ? [suggestions] : null,
      final ? true : null,
      final ? [suggestions.map((q) => [q, 1])] : null,
    ]),
  ];
  const live = new NotebooklmChatSession();
  live.gemini([frame("Answer", false)]);
  // The answer is not final yet, so nothing names it by content.
  assert.equal(live.snapshot().contentId, undefined);
  live.gemini([frame("Answer 2.", true)]);
  const snapshot = live.snapshot();
  const savedAnswer = [
    id(2),
    time(2),
    2,
    null,
    [
      ["Answer 2.", null, [SESSION, SESSION, 543618897], null, [null, null, null, null, 1]],
      [[["a quoted source passage"]]],
      null,
      [suggestions],
    ],
    2,
  ];
  const saved = read([newestFirst(question(1), savedAnswer)]).page.messages[1]!;
  assert.equal(saved.text, snapshot.text);
  assert.equal(saved.intermediate, snapshot.intermediate);
  // The live reply keeps its turn id; the saved answer keeps its own.
  assert.equal(snapshot.outputId, liveTurn);
  assert.equal(saved.liveAttemptId, id(2));
  assert.match(snapshot.contentId!, /^n_[0-9a-f]{16}$/);
  assert.equal(saved.contentId, snapshot.contentId);
  // Another answer, or the same answer in another session, is another reply.
  assert.notEqual(
    read([newestFirst(question(1), answer(2, "Answer 2!"))]).page.messages[1]!
      .contentId,
    snapshot.contentId,
  );
  assert.notEqual(
    read([newestFirst(question(1), savedAnswer)], {
      session: OTHER_SESSION,
      sessions: [OTHER_SESSION],
    }).page.messages[1]!.contentId,
    snapshot.contentId,
  );
});

test("NB6 the chat page and session list come from their own batch rows", () => {
  const line = (rows: unknown[]) => {
    const text = JSON.stringify(rows);
    return `${text.length + 2}\n${text}\n`;
  };
  const body = (...lines: string[]) => ")]}'\n\n" + lines.join("");
  const turns = JSON.stringify([newestFirst(question(1), answer(2))]);
  const chat = notebooklmHistoryFrames(
    body(
      line([["wrb.fr", "khqZz", turns, null, null, null, "generic"]]),
      line([["di", 40], ["af.httprm", 39, "x", 7]]),
    ),
  );
  assert.equal(chat.rpc, "khqZz");
  assert.deepEqual(chat.value, JSON.parse(turns));
  const sessions = (payload: unknown) =>
    notebooklmChatSessions(
      body(line([["wrb.fr", "hPTbtc", JSON.stringify(payload)]])),
    );
  assert.deepEqual(
    sessions([[[SESSION, time(1), time(2)]]]),
    [SESSION],
  );
  assert.deepEqual(
    sessions([[[SESSION, time(1), time(2)], [OTHER_SESSION, time(3), time(4)]]]),
    [SESSION, OTHER_SESSION],
  );
  // A notebook without a chat may send no list at all.
  assert.deepEqual(sessions([]), []);
  // Another shape names no sessions, so it can prove nothing.
  for (const payload of [
    [[["not-an-id"]]],
    [[[SESSION], [SESSION]]],
    ["rows"],
    "x",
  ])
    assert.equal(sessions(payload), null, JSON.stringify(payload));
  assert.equal(
    notebooklmChatSessions(body(line([["wrb.fr", "khqZz", "[]"]]))),
    null,
  );
  assert.equal(notebooklmChatSessions("[[]]"), null);
  // A session list is never read as a page of history.
  assert.throws(
    () => notebooklmHistoryFrames(body(line([["wrb.fr", "hPTbtc", "[]"]]))),
    /history_unsupported/,
  );
});
