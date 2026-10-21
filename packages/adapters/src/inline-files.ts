export const INLINE_FILE_LIMITS = Object.freeze({
  count: 16,
  textUnits: 262144,
});

export function validInlineFiles(value: unknown): value is string[] | null {
  if (value === null) return true;
  if (
    !Array.isArray(value) ||
    value.length > INLINE_FILE_LIMITS.count ||
    Object.keys(value).length !== value.length
  )
    return false;
  let units = 0;
  for (let index = 0; index < value.length; index++) {
    const text = value[index];
    if (
      typeof text !== "string" ||
      (units += text.length) > INLINE_FILE_LIMITS.textUnits
    )
      return false;
  }
  return true;
}

/** Only the observed inline text survives this projection, never file identity or storage metadata. */
export function claudeInlineFiles(
  value: Record<string, unknown>,
): string[] | null {
  if (
    !Array.isArray(value.attachments) ||
    !Array.isArray(value.files) ||
    value.files.length !== 0 ||
    value.attachments.length > INLINE_FILE_LIMITS.count
  )
    return null;
  const texts: string[] = [];
  for (const item of value.attachments) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).sort().join(",") !==
        "extracted_content,file_name,file_size,file_type,kind,origin" ||
      item.file_type !== "text/plain" ||
      item.kind !== "file" ||
      item.origin !== "user_upload" ||
      typeof item.file_name !== "string" ||
      item.file_name.length > 1024 ||
      !Number.isSafeInteger(item.file_size) ||
      item.file_size < 0 ||
      item.file_size > 25 * 1024 * 1024 ||
      typeof item.extracted_content !== "string"
    )
      return null;
    texts.push(item.extracted_content);
  }
  return validInlineFiles(texts) ? texts : null;
}
