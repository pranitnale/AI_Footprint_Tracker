const MAX_REFERENCES = 100;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,256}$/.test(value);

function reviewedReference(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).sort().join(",") ===
      "id,is_big_paste,library_file_id,mime_type,name,size,source" &&
    identifier(item.id) &&
    identifier(item.library_file_id) &&
    typeof item.name === "string" &&
    item.name.length <= 1024 &&
    typeof item.mime_type === "string" &&
    /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(item.mime_type) &&
    item.mime_type.length <= 128 &&
    Number.isSafeInteger(item.size) &&
    (item.size as number) >= 0 &&
    item.source === "local" &&
    typeof item.is_big_paste === "boolean"
  );
}

/** Counts reviewed current references, not uploads or retained provider processing. Raw metadata stays here. */
export function chatgptAttachments(messages: any[]): {
  count: number | null;
  present: boolean;
} {
  const references = new Map<string, string>();
  let seen = 0,
    ambiguous = false,
    present = false;
  const add = (value: unknown, fromMetadata: boolean) => {
    if (++seen > MAX_REFERENCES) {
      ambiguous = true;
      return;
    }
    if (!reviewedReference(value)) {
      ambiguous = true;
      return;
    }
    if (fromMetadata) present = true;
    const signature = JSON.stringify([
      value.size,
      value.mime_type,
      value.name,
      value.source,
      value.library_file_id,
      value.is_big_paste,
    ]);
    const prior = references.get(value.id);
    if (!fromMetadata && prior === undefined) {
      ambiguous = true;
      return;
    }
    if (prior !== undefined && prior !== signature) ambiguous = true;
    references.set(value.id, signature);
  };
  for (const message of messages) {
    if (message?.author?.role !== "user") continue;
    const metadata = message.metadata;
    if (
      metadata != null &&
      (typeof metadata !== "object" || Array.isArray(metadata))
    )
      ambiguous = true;
    else if (metadata && Object.hasOwn(metadata, "attachments")) {
      if (!Array.isArray(metadata.attachments)) ambiguous = true;
      else
        for (const value of metadata.attachments) {
          add(value, true);
          if (seen > MAX_REFERENCES) break;
        }
    }
    if (seen > MAX_REFERENCES) break;
  }
  // Input-part schemas remain unverified. Resolve only a full duplicate of a reviewed metadata reference.
  for (const message of messages) {
    if (seen > MAX_REFERENCES) break;
    if (message?.author?.role !== "user") continue;
    for (const part of message.content.parts) {
      if (typeof part !== "string") add(part, false);
      if (seen > MAX_REFERENCES) break;
    }
    if (seen > MAX_REFERENCES) break;
  }
  return { count: ambiguous ? null : references.size, present };
}
