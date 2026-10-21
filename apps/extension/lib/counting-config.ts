import {
  BUNDLED_TOKENIZER_MANIFEST,
  createCountingRuntime,
  DEFAULT_TOKENIZER_PROFILE_ID,
} from "@footprint/tokenizers/metadata";

/** Pair trusted metadata with counting-worker-config when replacing packaged counting. */
export const PACKAGED_TOKENIZER_MANIFEST = BUNDLED_TOKENIZER_MANIFEST;
export const PACKAGED_COUNTING_RUNTIME = createCountingRuntime(
  PACKAGED_TOKENIZER_MANIFEST,
  DEFAULT_TOKENIZER_PROFILE_ID,
);
