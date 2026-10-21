import { FILE_LIMITS, type FileKind } from "@footprint/file-text/types";
export const FILE_RELAY_PATH = "/file-relay.html";
export const FILE_RELAY_LIMITS = Object.freeze({
  inputBytes: FILE_LIMITS.inputBytes,
  timeoutMs: 30000,
  results: 16,
  resultTtlMs: 300000,
});
export type FileBinding = {
  documentNonce: string;
  navigationNonce: string;
  captureId: null;
};
export type FileSpec = { fileHandle: string; kind: FileKind; size: number };
export type FileOffer = FileSpec & {
  observedAt: number;
  channel: "ai-footprint-file-offer-v1";
  offerId: string;
};
export type FileOfferReply = {
  channel: "ai-footprint-file-port-v1";
  offerId: string;
  fileHandle: string;
  status: "ready" | "unavailable";
};
export type FileGrantRequest = FileSpec & {
  observedAt: number;
  target: "file-grant";
  binding: FileBinding;
};
export type FileGrantReply =
  | { status: "granted"; grant: string; expiresAt: number }
  | { status: "unavailable"; code: "file_unavailable" | "file_busy" };
export type FileRelayBind = { target: "file-relay-bind"; grant: string };
export type FileRelayStatus = {
  target: "file-relay-status";
  status: "ready" | "complete" | "unavailable";
};
export type FileRelayBytes = { target: "file-relay-bytes"; bytes: ArrayBuffer };
export type FileGrantCheck = {
  captureId: string | null;
  target: "file-grant-check";
  binding: FileBinding;
  fileHandle: string;
};
export type FileGrantCancel = {
  target: "file-grant-cancel";
  binding: FileBinding;
  fileHandle: string;
};
export const FILE_PROVIDER_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://www.perplexity.ai",
  "https://perplexity.ai",
] as const;
export function fileUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  );
}
export function fileKeys(
  value: unknown,
  keys: string[],
): value is Record<string, any> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}
export function validFileBinding(value: unknown): value is FileBinding {
  return (
    fileKeys(value, ["documentNonce", "navigationNonce", "captureId"]) &&
    fileUuid(value.documentNonce) &&
    fileUuid(value.navigationNonce) &&
    value.captureId === null
  );
}
export function validFileSpec(value: Record<string, any>): boolean {
  return (
    fileUuid(value.fileHandle) &&
    ["text", "pdf", "docx", "xlsx", "pptx"].includes(value.kind) &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    value.size <= FILE_RELAY_LIMITS.inputBytes
  );
}
export function validFileOffer(value: unknown): value is FileOffer {
  return (
    fileKeys(value, [
      "channel",
      "offerId",
      "fileHandle",
      "kind",
      "size",
      "observedAt",
    ]) &&
    value.channel === "ai-footprint-file-offer-v1" &&
    fileUuid(value.offerId) &&
    Number.isSafeInteger(value.observedAt) &&
    value.observedAt >= 0 &&
    validFileSpec(value)
  );
}
export function validFileGrantRequest(
  value: unknown,
): value is FileGrantRequest {
  return (
    fileKeys(value, [
      "target",
      "binding",
      "fileHandle",
      "kind",
      "size",
      "observedAt",
    ]) &&
    value.target === "file-grant" &&
    validFileBinding(value.binding) &&
    Number.isSafeInteger(value.observedAt) &&
    value.observedAt >= 0 &&
    validFileSpec(value)
  );
}
export function validFileRelayBind(value: unknown): value is FileRelayBind {
  return (
    fileKeys(value, ["target", "grant"]) &&
    value.target === "file-relay-bind" &&
    fileUuid(value.grant)
  );
}
export function validFileRelayBytes(
  value: unknown,
  size: number,
): value is FileRelayBytes {
  return (
    fileKeys(value, ["target", "bytes"]) &&
    value.target === "file-relay-bytes" &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength === size &&
    size <= FILE_RELAY_LIMITS.inputBytes
  );
}

export type UploadAssociationMessage = {
  channel: "ai-footprint-upload-association-v1";
  captureId: string;
  status: "matched" | "partial" | "unavailable" | "observed_empty";
  unmatchedReferenceCount: number;
  files: Array<{ fileHandle: string; origin: "new_upload" }>;
};
export function validUploadAssociation(
  value: unknown,
): value is UploadAssociationMessage {
  if (
    !fileKeys(value, [
      "channel",
      "captureId",
      "status",
      "unmatchedReferenceCount",
      "files",
    ]) ||
    value.channel !== "ai-footprint-upload-association-v1" ||
    !fileUuid(value.captureId) ||
    !Number.isSafeInteger(value.unmatchedReferenceCount) ||
    value.unmatchedReferenceCount < 0 ||
    !Array.isArray(value.files) ||
    value.files.length > 16 ||
    Object.keys(value.files).length !== value.files.length ||
    value.files.some(
      (file: unknown) =>
        !fileKeys(file, ["fileHandle", "origin"]) ||
        !fileUuid(file.fileHandle) ||
        file.origin !== "new_upload",
    ) ||
    new Set(value.files.map((file: any) => file.fileHandle)).size !==
      value.files.length ||
    value.files.length + value.unmatchedReferenceCount > 16
  )
    return false;
  return value.status === "observed_empty"
    ? value.files.length === 0 && value.unmatchedReferenceCount === 0
    : value.status === "matched"
      ? value.files.length > 0 && value.unmatchedReferenceCount === 0
      : value.status === "partial"
        ? value.files.length > 0 && value.unmatchedReferenceCount > 0
        : value.status === "unavailable" &&
          value.files.length === 0 &&
          value.unmatchedReferenceCount > 0;
}

export type FileUploadReset = { channel: "ai-footprint-file-reset-v1" };
export type FileReceiptBind = {
  target: "file-receipt-bind";
  binding: FileBinding;
  fileHandle: string;
  captureId: string;
};
export function validFileGrantReply(value: unknown): value is FileGrantReply {
  return fileKeys(value, ["status", "grant", "expiresAt"])
    ? value.status === "granted" &&
        fileUuid(value.grant) &&
        Number.isSafeInteger(value.expiresAt) &&
        value.expiresAt >= 0
    : fileKeys(value, ["status", "code"]) &&
        value.status === "unavailable" &&
        ["file_unavailable", "file_busy"].includes(value.code);
}
export function validFileRelayStatus(value: unknown): value is FileRelayStatus {
  return (
    fileKeys(value, ["target", "status"]) &&
    value.target === "file-relay-status" &&
    ["ready", "complete", "unavailable"].includes(value.status)
  );
}
export function validFileOfferReply(value: unknown): value is FileOfferReply {
  return (
    fileKeys(value, ["channel", "offerId", "fileHandle", "status"]) &&
    value.channel === "ai-footprint-file-port-v1" &&
    fileUuid(value.offerId) &&
    fileUuid(value.fileHandle) &&
    ["ready", "unavailable"].includes(value.status)
  );
}
export function validFileGrantCheck(value: unknown): value is FileGrantCheck {
  return (
    fileKeys(value, ["target", "binding", "fileHandle", "captureId"]) &&
    value.target === "file-grant-check" &&
    validFileBinding(value.binding) &&
    fileUuid(value.fileHandle) &&
    (value.captureId === null || fileUuid(value.captureId))
  );
}
export function validFileGrantCancel(value: unknown): value is FileGrantCancel {
  return (
    fileKeys(value, ["target", "binding", "fileHandle"]) &&
    value.target === "file-grant-cancel" &&
    validFileBinding(value.binding) &&
    fileUuid(value.fileHandle)
  );
}
export function validFileReceiptBind(value: unknown): value is FileReceiptBind {
  return (
    fileKeys(value, ["target", "binding", "fileHandle", "captureId"]) &&
    value.target === "file-receipt-bind" &&
    validFileBinding(value.binding) &&
    fileUuid(value.fileHandle) &&
    fileUuid(value.captureId)
  );
}
export function validFileUploadReset(value: unknown): value is FileUploadReset {
  return (
    fileKeys(value, ["channel"]) &&
    value.channel === "ai-footprint-file-reset-v1"
  );
}
export type FileUploadPromote = {
  channel: "ai-footprint-file-promote-v1";
  captureId: string;
};
export function validFileUploadPromote(
  value: unknown,
): value is FileUploadPromote {
  return (
    fileKeys(value, ["channel", "captureId"]) &&
    value.channel === "ai-footprint-file-promote-v1" &&
    fileUuid(value.captureId)
  );
}
export type FileOfferComplete = {
  channel: "ai-footprint-file-complete-v1";
  offerId: string;
  fileHandle: string;
  status: "complete" | "unavailable";
};
export function validFileOfferComplete(
  value: unknown,
): value is FileOfferComplete {
  return (
    fileKeys(value, ["channel", "offerId", "fileHandle", "status"]) &&
    value.channel === "ai-footprint-file-complete-v1" &&
    fileUuid(value.offerId) &&
    fileUuid(value.fileHandle) &&
    ["complete", "unavailable"].includes(value.status)
  );
}
