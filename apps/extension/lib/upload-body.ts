import { FILE_RELAY_LIMITS } from "./file-relay-protocol";
import type { FileKind } from "@footprint/file-text/types";

export type AccessibleUpload = { blob: Blob; size: number; kind: FileKind };
const types: Record<string, FileKind> = {
  "text/plain": "text",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};

/** Capture intrinsics once. Own accessors and instance overrides must not be invoked by observation. */
export function uploadBodyReader() {
  const descriptor = Object.getOwnPropertyDescriptor;
  const blobSize = descriptor(Blob.prototype, "size")!.get!;
  const blobType = descriptor(Blob.prototype, "type")!.get!;
  const arrayBuffer = Blob.prototype.arrayBuffer;
  const fileBrand =
    typeof File === "undefined"
      ? undefined
      : descriptor(File.prototype, "lastModified")?.get;
  const entries = FormData.prototype.entries;
  const next = Object.getPrototypeOf(
    Reflect.apply(entries, new FormData(), []),
  ).next;
  const requestURL = descriptor(Request.prototype, "url")!.get!;
  const requestMethod = descriptor(Request.prototype, "method")!.get!;
  const urlHref = descriptor(URL.prototype, "href")!.get!;
  const prototype = Object.getPrototypeOf;
  const urlString = descriptor(URL.prototype, "toString")?.value;
  const optionKeys = [
    "method",
    "body",
    "headers",
    "signal",
    "mode",
    "credentials",
    "cache",
    "redirect",
    "referrer",
    "referrerPolicy",
    "integrity",
    "keepalive",
    "duplex",
    "priority",
  ];
  const headerEntries = Headers.prototype.entries;
  const headerIterator = descriptor(Headers.prototype, Symbol.iterator)?.value;
  const headerNext = prototype(
    Reflect.apply(headerEntries, new Headers(), []),
  ).next;
  const signalBrand = descriptor(AbortSignal.prototype, "aborted")!.get!;
  const safeHeaders = (value: unknown): boolean => {
    if (value == null) return true;
    if (typeof value !== "object") return false;
    const proto = prototype(value);
    if (proto === Headers.prototype) {
      try {
        return (
          !descriptor(value, Symbol.iterator) &&
          descriptor(Headers.prototype, Symbol.iterator)?.value ===
            headerIterator &&
          prototype(Reflect.apply(headerEntries, value, [])).next === headerNext
        );
      } catch {
        return false;
      }
    }
    // Iterable header sequences can execute page callbacks before FormData serialization.
    if (Array.isArray(value)) return false;
    return (
      (proto === Object.prototype || proto === null) &&
      !descriptor(Object.prototype, Symbol.iterator) &&
      Reflect.ownKeys(value).every((key) => typeof key === "string") &&
      Reflect.ownKeys(value).length <= 128 &&
      Object.values(Object.getOwnPropertyDescriptors(value)).every(
        (d) => Object.hasOwn(d, "value") && typeof d.value === "string",
      )
    );
  };
  const data = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== "object") return undefined;
    const field = descriptor(value, key);
    return field && Object.hasOwn(field, "value") ? field.value : undefined;
  };
  const blob = (
    value: unknown,
    requireFile = false,
  ): AccessibleUpload | null => {
    try {
      if (requireFile) {
        if (!fileBrand) return null;
        Reflect.apply(fileBrand, value, []);
      }
      const size = Reflect.apply(blobSize, value, []);
      const type = Reflect.apply(blobType, value, []);
      const kind = Object.hasOwn(types, type) ? types[type] : undefined;
      if (
        !kind ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > FILE_RELAY_LIMITS.inputBytes
      )
        return null;
      return { blob: value as Blob, size, kind };
    } catch {
      return null;
    }
  };
  return {
    data,
    blob,
    request(
      input: unknown,
      init: unknown,
      base: string,
    ): {
      url: URL;
      method: string;
      body: unknown;
      nativeRequest: Request | null;
    } | null {
      try {
        if (init != null) {
          if (
            typeof init !== "object" ||
            ![Object.prototype, null].includes(prototype(init))
          )
            return null;
          for (const field of Object.values(
            Object.getOwnPropertyDescriptors(init),
          ))
            if (!Object.hasOwn(field, "value")) return null;
          for (const key of optionKeys)
            if (!descriptor(init, key) && descriptor(Object.prototype, key))
              return null;
        }
        let value: string,
          method = "GET",
          nativeRequest: Request | null = null;
        if (typeof input === "string") value = input;
        else {
          try {
            value = Reflect.apply(requestURL, input, []);
            method = Reflect.apply(requestMethod, input, []);
            nativeRequest = input as Request;
          } catch {
            if (
              prototype(input) !== URL.prototype ||
              descriptor(input as object, "toString") ||
              descriptor(input as object, Symbol.toPrimitive) ||
              descriptor(URL.prototype, Symbol.toPrimitive) ||
              descriptor(Object.prototype, Symbol.toPrimitive) ||
              descriptor(URL.prototype, "toString")?.value !== urlString
            )
              return null;
            value = Reflect.apply(urlHref, input, []);
          }
        }
        if (value.length > 8192) return null;
        const actual = data(init, "method") ?? method,
          url = new URL(value, base);
        if (
          typeof actual !== "string" ||
          url.protocol !== "https:" ||
          url.username ||
          url.password
        )
          return null;
        const body = data(init, "body");
        let form = false;
        try {
          Reflect.apply(entries, body, []);
          form = true;
        } catch {}
        if (form) {
          if (!safeHeaders(data(init, "headers"))) return null;
          for (const key of optionKeys) {
            if (["body", "headers"].includes(key)) continue;
            const value = data(init, key);
            if (typeof value === "function") return null;
            if (value !== null && typeof value === "object") {
              if (key !== "signal") return null;
              try {
                Reflect.apply(signalBrand, value, []);
                if (
                  prototype(value) !== AbortSignal.prototype ||
                  descriptor(AbortSignal.prototype, "aborted")?.get !==
                    signalBrand ||
                  descriptor(value, "addEventListener") ||
                  descriptor(value, "aborted")
                )
                  return null;
              } catch {
                return null;
              }
            }
          }
        }
        return {
          url,
          method: actual.toUpperCase(),
          body,
          nativeRequest,
        };
      } catch {
        return null;
      }
    },
    multipart(value: unknown): { file: AccessibleUpload; key: string } | null {
      try {
        const iterator = Reflect.apply(entries, value, []);
        let file: AccessibleUpload | null = null,
          key: unknown;
        for (let count = 0; ; count++) {
          const item = Reflect.apply(next, iterator, []) as IteratorResult<
            [string, FormDataEntryValue]
          >;
          if (item.done) break;
          if (count >= 32) return null;
          if (item.value[0] === "file") {
            if (file) return null;
            file = blob(item.value[1], true);
            if (!file) return null;
          }
          if (item.value[0] === "key") {
            if (key !== undefined) return null;
            key = item.value[1];
          }
        }
        if (
          !file ||
          typeof key !== "string" ||
          !key.length ||
          key.length > 2048
        )
          return null;
        return { file, key };
      } catch {
        return null;
      }
    },
    read(value: AccessibleUpload): Promise<ArrayBuffer> {
      // Native Blob.arrayBuffer returns a private copy. No host-owned buffer is transferred or detached.
      return Reflect.apply(arrayBuffer, value.blob, []);
    },
  };
}
