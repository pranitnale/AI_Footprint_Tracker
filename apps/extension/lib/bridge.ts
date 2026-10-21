import {
  LIMITS,
  CAPTURE_TIMES,
  siteForHost,
  type Site,
  type TimingEvidence,
  isTimingEvidence,
} from "@footprint/capture-core";
import type { Dispatch, Snapshot } from "@footprint/adapters";
import {
  generatedTextKeys,
  validGeneratedText,
  validInlineFiles,
  validInputImages,
} from "@footprint/adapters";
import type { ReasonCode } from "@footprint/contracts";
export const CAPTURE_FAILURE_REASONS: Readonly<Record<string, ReasonCode>> =
  Object.freeze({
    malformed_frame: "malformed_frame",
    unsupported_schema: "protocol_unsupported",
    buffer_overflow: "buffer_overflow",
    missing_body: "capture_body_missing",
    ambiguous_candidate: "provider_selection_unverified",
    conflicting_duplicate: "conflicting_duplicate_identity",
    capture_interrupted: "partial_capture",
  });
export const CHANNEL = "ai-footprint-observation-v1";
/**
 * The longest a running capture stays silent: without data the page ends it after the idle
 * limit plus one sweep (W10). A capture silent for longer lost its end frame (X10).
 */
export const CAPTURE_SILENT_MS =
  2 * (CAPTURE_TIMES.idleMs + CAPTURE_TIMES.sweepMs);
/**
 * Captures that add energy to a chat without being a turn of it: ChatGPT read aloud (G1)
 * and NotebookLM's notebook guides (W9). They are never the reply a tab shows, and the
 * shown figures are refreshed when they end.
 */
export const sideCapture = (action: string | null | undefined) =>
  action === "read_aloud" || action === "notebook_guide";
export interface CaptureMessage {
  channel: typeof CHANNEL;
  version: 1;
  id: string;
  revision: number;
  event: "dispatch" | "progress" | "end" | "health";
  site: Site;
  at: string;
  dispatch: Dispatch | null;
  snapshot: Snapshot | null;
  failure: string | null;
  timing: TimingEvidence | null;
}
const keys = [
  "channel",
  "version",
  "id",
  "revision",
  "event",
  "site",
  "at",
  "dispatch",
  "snapshot",
  "failure",
  "timing",
];
const stringOrNull = (v: unknown, max: number) =>
  v === null || (typeof v === "string" && v.length <= max);
export function validateCapture(
  value: unknown,
  host: string,
): value is CaptureMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const m = value as CaptureMessage;
  if (
    Object.keys(m).length !== keys.length ||
    Object.keys(m).some((k) => !keys.includes(k))
  )
    return false;
  if (
    m.channel !== CHANNEL ||
    m.version !== 1 ||
    m.site !== siteForHost(host) ||
    !/^[0-9a-f-]{36}$/.test(m.id) ||
    !Number.isInteger(m.revision) ||
    m.revision < 1 ||
    m.revision > 100000
  )
    return false;
  if (
    !["dispatch", "progress", "end", "health"].includes(m.event) ||
    !Number.isFinite(Date.parse(m.at)) ||
    !stringOrNull(m.failure, 80)
  )
    return false;
  if (
    m.timing !== null &&
    (!isTimingEvidence(m.timing) ||
      m.timing.source !== "browser_request" ||
      m.timing.completeness !== "complete_for_scope" ||
      m.snapshot?.state !== "completed")
  )
    return false;
  if (m.event === "health" && m.timing !== null) return false;
  if (m.dispatch) {
    const d = m.dispatch;
    if (
      Object.keys(d)
        .filter(
          (key) =>
            key !== "inlineFiles" &&
            key !== "attachmentPresence" &&
            key !== "inputImages",
        )
        .sort()
        .join(",") !==
      "action,attachments,conversationId,imageEditParentId,input,model,parentId,requestId,site"
    )
      return false;
    if (Object.hasOwn(d, "inputImages") && !validInputImages(d.inputImages))
      return false;
    if (
      Object.hasOwn(d, "attachmentPresence") &&
      (m.site !== "chatgpt" ||
        d.attachmentPresence !== true ||
        d.attachments === 0)
    )
      return false;
    if (
      Object.hasOwn(d, "inlineFiles") &&
      (m.site !== "claude" || !validInlineFiles(d.inlineFiles))
    )
      return false;
    if (
      d.site !== m.site ||
      ![
        "send",
        "regenerate",
        "continue",
        "edit_and_send",
        // Speech made from a ChatGPT reply already shown (G1).
        ...(m.site === "chatgpt" ? ["read_aloud"] : []),
        // A notebook guide NotebookLM asks for itself (W9).
        ...(m.site === "notebooklm" ? ["notebook_guide"] : []),
      ].includes(d.action) ||
      !stringOrNull(d.input, LIMITS.text)
    )
      return false;
    // Read aloud and notebook guides send no prompt (their input is empty), attach nothing
    // and join no turn (G1, W9), so a side capture that claims any of it is not counted
    // (W9 review). The only request id is the one naming a notebook's guide request.
    if (
      sideCapture(d.action) &&
      (d.input !== "" ||
        d.attachments !== 0 ||
        d.parentId !== null ||
        (d.requestId !== null &&
          (d.action !== "notebook_guide" ||
            typeof d.requestId !== "string" ||
            !/^g_[0-9a-f]{16}$/.test(d.requestId))) ||
        d.model !== null ||
        d.imageEditParentId !== null ||
        Object.hasOwn(d, "inlineFiles") ||
        Object.hasOwn(d, "attachmentPresence") ||
        (Object.hasOwn(d, "inputImages") && d.inputImages?.length !== 0))
    )
      return false;
    if (
      ![
        d.conversationId,
        d.parentId,
        d.requestId,
        d.model,
        d.imageEditParentId,
      ].every((v) => stringOrNull(v, 256))
    )
      return false;
    if (
      d.attachments !== null &&
      (!Number.isInteger(d.attachments) ||
        d.attachments < 0 ||
        d.attachments > 1000)
    )
      return false;
  }
  if (m.snapshot) {
    const s = m.snapshot;
    const generated = generatedTextKeys(s);
    if (
      Object.keys(s)
        .filter(
          (key) =>
            key !== "providerRequestId" &&
            key !== "attemptId" &&
            key !== "contentId" &&
            !generated.includes(key),
        )
        .sort()
        .join(",") !==
      "conversationId,imageOperations,limitations,model,outputId,parentId,searchOperations,started,state,text,thinking,topic"
    )
      return false;
    if (!validGeneratedText(s, m.site, "live")) return false;
    if (
      Object.hasOwn(s, "providerRequestId") &&
      (m.site !== "gemini" ||
        typeof s.providerRequestId !== "string" ||
        !/^r_[0-9a-f]{16}$/.test(s.providerRequestId))
    )
      return false;
    // A NotebookLM reply's link to its saved copy, from its session and answer (16 Oct 2026).
    if (
      Object.hasOwn(s, "contentId") &&
      (m.site !== "notebooklm" ||
        typeof s.contentId !== "string" ||
        !/^n_[0-9a-f]{16}$/.test(s.contentId))
    )
      return false;
    if (
      ![s.text, s.thinking].every((v) => stringOrNull(v, LIMITS.text)) ||
      ![s.outputId, s.conversationId, s.parentId, s.model, s.topic].every((v) =>
        stringOrNull(v, 256),
      ) ||
      (Object.hasOwn(s, "attemptId") && !stringOrNull(s.attemptId, 256))
    )
      return false;
    if (
      ![
        "generating",
        "completed",
        "cancelled",
        "failed",
        "interrupted_unconfirmed",
      ].includes(s.state) ||
      typeof s.started !== "boolean"
    )
      return false;
    if (
      s.searchOperations !== null &&
      (!Number.isInteger(s.searchOperations) ||
        s.searchOperations < 0 ||
        s.searchOperations > 10000)
    )
      return false;
    if (
      !Array.isArray(s.limitations) ||
      s.limitations.length > 32 ||
      !s.limitations.every(
        (v) => typeof v === "string" && /^[a-z_]{1,80}$/.test(v),
      )
    )
      return false;
    if (!Array.isArray(s.imageOperations) || s.imageOperations.length > 100)
      return false;
    let mediaCount = 0;
    for (const operation of s.imageOperations) {
      if (
        !operation ||
        Object.keys(operation)
          .filter((key) => key !== "model")
          .sort()
          .join(",") !== "id,kind,outputs,parentId,requestedCount,state" ||
        (Object.hasOwn(operation, "model") &&
          !stringOrNull(operation.model, 256)) ||
        !stringOrNull(operation.id, 512) ||
        operation.id === null ||
        !stringOrNull(operation.parentId, 512) ||
        !["text_to_image", "image_edit", "unknown"].includes(operation.kind) ||
        ![
          "completed",
          "generating",
          "cancelled",
          "failed",
          "interrupted_unconfirmed",
        ].includes(operation.state) ||
        (operation.requestedCount !== null &&
          (!Number.isInteger(operation.requestedCount) ||
            operation.requestedCount < 0 ||
            operation.requestedCount > 100))
      )
        return false;
      if (!Array.isArray(operation.outputs)) return false;
      mediaCount += operation.outputs.length + 1;
      if (mediaCount > 100) return false;
      for (const output of operation.outputs) {
        if (
          !output ||
          Object.keys(output).sort().join(",") !== "height,id,width" ||
          !stringOrNull(output.id, 512) ||
          output.id === null ||
          ![output.width, output.height].every(
            (value) =>
              value === null ||
              (Number.isInteger(value) && value > 0 && value <= 65536),
          )
        )
          return false;
      }
    }
  }
  return m.event !== "dispatch" || m.dispatch !== null;
}
