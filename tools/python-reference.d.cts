import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";

export function pythonExecutable(projectRoot?: string): string;
export function pythonReference(
  args: string[],
  options?: Omit<SpawnSyncOptions, "env" | "cwd" | "encoding">,
): SpawnSyncReturns<string>;
