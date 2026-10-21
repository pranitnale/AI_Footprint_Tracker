import { initialSnapshot, type ProtocolSession, type Snapshot } from "./types";

/** ChatGPT's read-aloud route: `GET /backend-api/synthesize` (G1, seen 3 Oct). */
export const isChatgptReadAloud = (url: URL, method: string) =>
  method.toUpperCase() === "GET" && url.pathname === "/backend-api/synthesize";

const SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];
const tag = (bytes: Uint8Array, a: number, b: number, c: number) =>
  bytes[0] === a && bytes[1] === b && bytes[2] === c;

/**
 * Counts AAC audio in ADTS frames as it streams, without keeping the audio. Each frame
 * names its sample rate and holds 1,024 samples per raw block, so the length follows from
 * the frames alone (3 Oct: 24 kHz mono, frames x 1,024 / 24,000 s). Data that is not an
 * ADTS frame stops the count: the length is then unknown, never guessed from bytes.
 */
export class AdtsCounter {
  frames = 0;
  failed = false;
  private skip = 0;
  /** The frame being received; it counts once its last byte arrives. */
  private pending: { rate: number; blocks: number } | null = null;
  private header = new Uint8Array(10);
  private have = 0;
  private started = false;
  private trailer = false;
  /** Samples per sample rate, divided once so long audio does not gather rounding error. */
  private samples = new Map<number, number>();

  get seconds() {
    let seconds = 0;
    for (const [rate, samples] of this.samples) seconds += samples / rate;
    return seconds;
  }

  push(chunk: Uint8Array) {
    let i = 0;
    while (i < chunk.length && !this.failed && !this.trailer) {
      if (this.skip > 0) {
        const step = Math.min(this.skip, chunk.length - i);
        this.skip -= step;
        i += step;
        if (this.skip === 0) this.commit();
        continue;
      }
      // Every ADTS header starts with seven bytes; an ID3 tag needs ten.
      while (this.have < 7 && i < chunk.length)
        this.header[this.have++] = chunk[i++]!;
      if (this.have < 7) break;
      if (!this.started && tag(this.header, 0x49, 0x44, 0x33)) {
        while (this.have < 10 && i < chunk.length)
          this.header[this.have++] = chunk[i++]!;
        if (this.have < 10) break;
        const h = this.header;
        const size =
          ((h[6]! & 0x7f) << 21) |
          ((h[7]! & 0x7f) << 14) |
          ((h[8]! & 0x7f) << 7) |
          (h[9]! & 0x7f);
        // A footer repeats the tag's ten header bytes after it.
        this.skip = size + (h[5]! & 0x10 ? 10 : 0);
        this.have = 0;
        this.started = true;
        continue;
      }
      // An ID3v1 tag can close the stream; it holds no audio.
      if (this.frames > 0 && tag(this.header, 0x54, 0x41, 0x47)) {
        this.trailer = true;
        this.have = 0;
        break;
      }
      this.frame();
    }
  }

  private frame() {
    const h = this.header;
    const rate = SAMPLE_RATES[(h[2]! >> 2) & 0x0f];
    const length = ((h[3]! & 0x03) << 11) | (h[4]! << 3) | (h[5]! >> 5);
    if (
      h[0] !== 0xff ||
      (h[1]! & 0xf0) !== 0xf0 ||
      (h[1]! & 0x06) !== 0 ||
      rate === undefined ||
      length < (h[1]! & 0x01 ? 7 : 9)
    ) {
      this.failed = true;
      return;
    }
    // A stop can cut a frame short; only a frame received whole is counted.
    this.pending = { rate, blocks: (h[6]! & 0x03) + 1 };
    this.skip = length - this.have;
    this.have = 0;
    this.started = true;
    if (this.skip === 0) this.commit();
  }

  private commit() {
    if (!this.pending) return;
    const { rate, blocks } = this.pending;
    this.pending = null;
    this.frames += blocks;
    this.samples.set(rate, (this.samples.get(rate) ?? 0) + 1024 * blocks);
  }
}

/**
 * One ChatGPT read-aloud request (owner, 3 Oct): the speech the page receives is generated
 * speech, timed by its AAC frames. When the audio cannot be read, the read message's
 * characters give its length at 17 characters per second, if the page showed them.
 */
export class ChatgptReadAloudSession implements ProtocolSession {
  readonly readMessageId: string | null;
  private conversationId: string | null;
  private counter = new AdtsCounter();
  private received = 0;
  private ended = false;
  private stop = false;
  private characters: number | null = null;

  constructor(url: URL) {
    const id = (name: string) => {
      const value = url.searchParams.get(name);
      return value && value.length <= 256 ? value : null;
    };
    this.readMessageId = id("message_id");
    this.conversationId = id("conversation_id");
  }

  bytes(chunk: Uint8Array) {
    this.received += chunk.length;
    this.counter.push(chunk);
  }

  bytesEnded() {
    this.ended = true;
  }

  readCharacters(characters: number) {
    if (Number.isSafeInteger(characters) && characters > 0)
      this.characters = characters;
  }

  stopped() {
    this.stop = true;
  }

  completionVerified() {
    return this.ended && !this.stop;
  }

  snapshot(): Snapshot {
    const state = initialSnapshot();
    // Each whole frame received is speech the provider generated, up to a stop.
    const timed = this.counter.frames > 0 && !this.counter.failed;
    const counted = !timed && this.received > 0 && this.characters !== null;
    const started = this.received > 0;
    return {
      ...state,
      conversationId: this.conversationId,
      state: this.stop ? "cancelled" : this.ended ? "completed" : "generating",
      started,
      // Read aloud writes no text: every text part is zero once audio arrives.
      text: started ? "" : null,
      thinking: started ? "" : null,
      ...(started ? { toolInput: "", intermediate: "", toolOutput: "" } : {}),
      ...(timed
        ? {
            media: [
              {
                kind: "speech" as const,
                basis: "audio_frames" as const,
                seconds: this.counter.seconds,
                characters: null,
              },
            ],
          }
        : counted
          ? {
              media: [
                {
                  kind: "speech" as const,
                  basis: "characters" as const,
                  seconds: null,
                  characters: this.characters!,
                },
              ],
            }
          : {}),
      limitations: [
        ...state.limitations,
        // Audio the reader could not time leaves the speech unknown. Only an ended read
        // says so: a reason, once given, stays with the reply.
        ...((this.ended || this.stop) && started && !timed && !counted
          ? ["unknown_event_observed"]
          : []),
      ],
    };
  }
}
