export type BrowserInputContract = {
  fixed_files: string[];
  source_roots: string[];
  excluded_parts: string[];
  excluded_suffixes: string[];
  targets: Record<string, { target: string; folder?: string }>;
};

export const contractPath: string;
export function loadBrowserInputContract(
  path?: string,
): Promise<BrowserInputContract>;
export function browserInputFiles(
  root: string,
  contract: BrowserInputContract,
): Promise<Array<{ path: string; file: string }>>;
export function browserInputFingerprint(
  root: string,
  contract: BrowserInputContract,
): Promise<{ algorithm: "sha256"; files: number; sha256: string }>;
