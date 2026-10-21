import type { BrowserInputContract } from "../../../tools/browser-inputs.mjs";

export type DownloadPreparationOptions = {
  repository?: string;
  publicOutput?: string;
  artifactOutput?: string;
  generated?: string;
  contract?: BrowserInputContract;
  contractPath?: string;
  allowUnavailable?: boolean;
  forceUnavailable?: boolean;
  quiet?: boolean;
};

export function validateDownloadManifest(
  options?: DownloadPreparationOptions,
): Promise<Record<"chrome" | "edge" | "firefox", string>>;
export function prepareDownloads(
  options?: DownloadPreparationOptions,
): Promise<Partial<Record<"chrome" | "edge" | "firefox", string>>>;
