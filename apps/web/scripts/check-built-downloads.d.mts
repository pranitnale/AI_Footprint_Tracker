export type FileDigest = { bytes: number; sha256: string };

export function fileDigest(path: string): Promise<FileDigest>;
export function assertFileDigest(
  path: string,
  expected: FileDigest,
  label: string,
): Promise<void>;
export function checkBuiltDownloads(
  dist?: string,
): Promise<Record<"chrome" | "edge" | "firefox", string>>;
