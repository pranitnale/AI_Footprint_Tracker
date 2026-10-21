/**
 * How the content script reads the background's answer to a live capture frame (16 Oct 2026).
 *
 * Right after an extension reload a Perplexity reply showed No figures yet: its frames reached
 * the background while it was starting (on a large profile it upgrades its database first), the
 * answers were failures, and each frame was dropped. A full page load later counted the chat
 * correctly from saved history. A frame is therefore sent again, twice at most and after a short
 * wait, when the answer says the background was not ready; a refusal is never sent again.
 *
 * Sending a frame again cannot count it twice. The background keeps, per capture (tab, document
 * and capture id), the newest revision it has processed (`captureRevision` in the capture
 * checkpoint, written in the same database transaction as the frame's observations), and skips
 * a frame whose revision it already has (`Coordinator.process`). A frame whose answer was lost
 * after it was saved is therefore skipped, and one that was not saved left nothing behind.
 */

/** Waits before the second and the third try. */
export const CAPTURE_RETRY_DELAYS_MS: readonly number[] = [1000, 3000];

/**
 * Answers that mean "not now". The background answers storage_write_failed for any database
 * failure (a database still opening or upgrading, one closed for a newer version, an aborted
 * transaction; a full disk fails again and is then reported as before), buffer_overflow when its
 * capture queue is full, aggregate_inconsistent when saved totals changed during the work, and
 * ledger_integrity_failed for an unexpected error, which includes a worker that is starting.
 *
 * Every other code is a refusal that a person, a policy or the frame itself decides, for example
 * capture_hook_missing (site access removed), payload_rejected, request_identity_ambiguous,
 * policy_unavailable, deletion_in_progress or record_erased. Paused tracking and a superseded
 * frame are answered as delivered.
 */
const NOT_READY_CODES: ReadonlySet<string> = new Set([
  "storage_write_failed",
  "buffer_overflow",
  "aggregate_inconsistent",
  "ledger_integrity_failed",
]);

/** The code a send that threw is reported with, as before retries existed. */
export const CAPTURE_SEND_FAILED = "ledger_integrity_failed";

export type CaptureAnswer =
  | { kind: "delivered"; superseded: boolean }
  /** Worth another try; `code` is reported if the last try fails too. */
  | { kind: "not_ready"; code: unknown }
  | { kind: "refused"; code: unknown };

export function captureAnswer(result: unknown): CaptureAnswer {
  // No answer at all: the background's listener was not there or its worker stopped.
  if (result === undefined || result === null)
    return { kind: "not_ready", code: undefined };
  if (typeof result !== "object") return { kind: "refused", code: undefined };
  const answer = result as { ok?: unknown; code?: unknown; superseded?: unknown };
  if (answer.ok === true)
    return { kind: "delivered", superseded: answer.superseded === true };
  return typeof answer.code === "string" && NOT_READY_CODES.has(answer.code)
    ? { kind: "not_ready", code: answer.code }
    : { kind: "refused", code: answer.code };
}

/** A send that threw never reached the background, or lost its answer on the way back. */
export const captureSendThrew = (): CaptureAnswer => ({
  kind: "not_ready",
  code: CAPTURE_SEND_FAILED,
});
