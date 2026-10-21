import { payloadHash } from "@footprint/contracts";
import {
  BUNDLED_PROFILE_ENCODINGS as profileEncodings,
  BUNDLED_TOKENIZER_MANIFEST,
  TOKENIZER_ASSETS as assets,
} from "./manifest";
import {
  COUNT_LIMITS,
  DEFAULT_TOKENIZER_PROFILE_ID,
  unavailableTokenResult,
  type TokenJob,
  type TokenResult,
  type TokenizerImplementation,
} from "./protocol";

type Encoding = "o200k_base" | "cl100k_base";
const modules = new Map<
  Encoding,
  Promise<typeof import("gpt-tokenizer/encoding/o200k_base")>
>();
const encoder = new TextEncoder();

export function verifyAsset(data: unknown, expectedHash: string): void {
  if (payloadHash(data) !== expectedHash)
    throw new Error("tokenizer_unavailable");
}

async function load(encoding: Encoding) {
  let value = modules.get(encoding);
  if (!value) {
    value = (async () => {
      const [mod, bpe] =
        encoding === "o200k_base"
          ? await Promise.all([
              import("gpt-tokenizer/encoding/o200k_base"),
              import("gpt-tokenizer/bpeRanks/o200k_base"),
            ])
          : await Promise.all([
              import("gpt-tokenizer/encoding/cl100k_base"),
              import("gpt-tokenizer/bpeRanks/cl100k_base"),
            ]);
      verifyAsset(bpe.default, assets.profiles[encoding].asset_hash);
      mod.setMergeCacheSize(0);
      return mod;
    })();
    modules.set(encoding, value);
  }
  return value;
}

async function countBundled(job: TokenJob): Promise<TokenResult> {
  if (
    job.text.length > COUNT_LIMITS.fieldTextBytes ||
    encoder.encode(job.text).byteLength > COUNT_LIMITS.fieldTextBytes
  )
    return unavailableTokenResult(job, "capture_limit_exceeded");
  const profileId = job.profileId ?? DEFAULT_TOKENIZER_PROFILE_ID;
  if (!(profileId in profileEncodings))
    return unavailableTokenResult(job, "tokenizer_unavailable");
  const encoding = profileEncodings[profileId as keyof typeof profileEncodings];
  try {
    const mod = await load(encoding);
    const count = mod.countTokens(job.text, { disallowedSpecial: new Set() });
    return {
      jobId: job.jobId,
      revision: job.revision,
      measurement: {
        value: String(count),
        evidence: "heuristic_estimate",
        scope: "observed_text",
        completeness: "complete_for_scope",
        profile_id: profileId as keyof typeof profileEncodings,
        reason: "tokenizer_mapping_unverified",
      },
      assetHash: assets.profiles[encoding].asset_hash,
      profileId,
      encoding,
      modelExactness: "unverified",
      status: "counted",
    };
  } catch {
    return unavailableTokenResult(job, "tokenizer_unavailable");
  }
}

export const BUNDLED_TOKENIZER: TokenizerImplementation = Object.freeze({
  ...BUNDLED_TOKENIZER_MANIFEST,
  count: countBundled,
});

export { TOKENIZER_ASSETS } from "./manifest";
