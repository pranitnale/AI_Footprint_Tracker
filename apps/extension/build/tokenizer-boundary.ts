interface RenderedOutput {
  type: string;
  modules?: Record<string, { renderedLength: number }>;
}

/** Main Vite output only. Dedicated worker builds arrive here as assets, not main chunks. */
export function assertMainThreadTokenizerBoundary(
  output: Record<string, RenderedOutput>,
): void {
  for (const [file, chunk] of Object.entries(output)) {
    if (chunk.type !== "chunk") continue;
    for (const [rawId, module] of Object.entries(chunk.modules ?? {})) {
      if (module.renderedLength === 0) continue;
      const id = rawId.replaceAll("\\", "/").split("?")[0];
      if (
        /\/gpt-tokenizer\//.test(id) ||
        /\/packages\/tokenizers\/src\/(bundled|counting|worker)\.[cm]?[jt]s$/.test(
          id,
        )
      )
        throw new Error(
          `Tokenizer worker code rendered in main-context chunk ${file}: ${id}`,
        );
    }
  }
}
