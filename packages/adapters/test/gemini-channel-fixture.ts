/**
 * A small protobuf encoder for synthetic fixtures of Gemini's session channel: numbers are
 * varints, strings and nested field lists are length-delimited, `{ f32 }` is a float.
 */
export type ProtoValue = number | string | Uint8Array | { f32: number } | Proto;
export type Proto = Array<[number, ProtoValue]>;

function varint(value: number, out: number[]) {
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
}

export function pb(fields: Proto): Uint8Array {
  const out: number[] = [];
  for (const [field, value] of fields) {
    if (typeof value === "number") {
      varint(field * 8, out);
      varint(value, out);
    } else if (!Array.isArray(value) && !(value instanceof Uint8Array) && typeof value === "object") {
      varint(field * 8 + 5, out);
      const bytes = new Uint8Array(new Float32Array([value.f32]).buffer);
      out.push(...bytes);
    } else {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : pb(value);
      varint(field * 8 + 2, out);
      varint(bytes.length, out);
      out.push(...bytes);
    }
  }
  return new Uint8Array(out);
}

export const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * A back-channel message of Gemini's session channel as seen on 19 Oct 2026:
 * `.2 {1 seq, 7 {1 {1 last-frame flag, 2 {1 turn id}, 4 {4 reply frame}}}}`.
 */
export const channelMessage = (
  seq: number,
  frame: Proto,
  final = false,
  turn = "r_00000000000000b1",
) =>
  pb([
    [
      2,
      [
        [1, seq],
        [7, [[1, [[1, final ? 1 : 0], [2, [[1, turn]]], [4, [[4, frame]]]]]]],
      ],
    ],
  ]);
