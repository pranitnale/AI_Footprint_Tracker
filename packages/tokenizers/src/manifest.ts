import assets from "./assets.json";
import {
  DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  type TokenizerManifest,
} from "./protocol";

export const BUNDLED_PROFILE_ENCODINGS = Object.freeze({
  "o200k-base-4.0.0-reference": "o200k_base",
  "cl100k-base-4.0.0-reference": "cl100k_base",
} as const);

/** Metadata consumers must not import the worker's encoder or vocabulary graph. */
export const BUNDLED_TOKENIZER_MANIFEST: TokenizerManifest = Object.freeze({
  id: DEFAULT_TOKENIZER_IMPLEMENTATION_ID,
  profiles: Object.freeze(
    Object.entries(BUNDLED_PROFILE_ENCODINGS).map(([profileId, encoding]) =>
      Object.freeze({
        profileId,
        encoding,
        assetHash: assets.profiles[encoding].asset_hash,
      }),
    ),
  ),
});

export { assets as TOKENIZER_ASSETS };
