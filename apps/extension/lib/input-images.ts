import type { InputImage } from "@footprint/adapters";
import type {
  ModelId,
  RequestObservation,
  Site,
  TokenMeasurement,
} from "@footprint/contracts";
import {
  imageInputMeasurement,
  imageInputRule,
  imageInputTotal,
} from "@footprint/tokenizers/metadata";

type InputImageEntry = RequestObservation["media"]["input_images"][number];

/** Request entries for images uploaded with a prompt (A7). Only sizes are kept. */
export function uploadedImages(
  site: Site,
  model: ModelId | null,
  images: readonly InputImage[],
): InputImageEntry[] {
  const rule = imageInputRule(site, model);
  return images.map((image) => {
    const tokens = imageInputMeasurement(rule, image);
    return {
      count: "1",
      origin: "new_upload",
      width: image.width,
      height: image.height,
      // The page shows the stored upload; whether the site resized it first is unknown.
      dimension_source: "unknown",
      detail: "unknown",
      token_profile_id: tokens.profile_id,
      tokens,
    };
  });
}

/** Prices new uploads again once the reply names the model that answered. */
export function repriceUploads(
  site: Site,
  model: ModelId | null,
  entries: readonly InputImageEntry[],
): InputImageEntry[] {
  const rule = imageInputRule(site, model);
  return entries.map((entry) => {
    if (entry.origin !== "new_upload") return entry;
    const tokens = imageInputMeasurement(rule, entry);
    return { ...entry, token_profile_id: tokens.profile_id, tokens };
  });
}

/**
 * Image input of one request: its new uploads. Images kept from earlier turns are context,
 * like earlier text, and are not new input.
 */
export function uploadTotal(
  entries: readonly InputImageEntry[],
): TokenMeasurement {
  return imageInputTotal(
    entries
      .filter((entry) => entry.origin === "new_upload")
      .map((entry) => entry.tokens),
  );
}
