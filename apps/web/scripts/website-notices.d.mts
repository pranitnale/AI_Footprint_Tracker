import type { Plugin } from "vite";

export type WebsiteComponent = {
  name: string;
  version: string;
  license: string;
  notices: { file: string; text: string }[];
};

export const GENERATED_NOTICES: string;
export function websiteComponents(root?: string): WebsiteComponent[];
export function renderNoticesModule(components: WebsiteComponent[]): string;
export function writeNoticesModule(root?: string, target?: string): boolean;
export function shippedPackages(
  bundle: Record<string, unknown>,
  root?: string,
  helpers?: Array<[RegExp, string]>,
): { packages: string[]; unknownVirtual: string[] };
export function websiteNoticesPlugin(root?: string): Plugin;
