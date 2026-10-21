/** Release packaging supplies these paths only after the bundled files are verified. */
export type BundledNotices = {
  licensePath: string;
  sourcePath: string;
  release: string;
};

function bundledPath(path: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) &&
    !path.split("/").includes("..")
    ? path
    : null;
}

export function AboutNotices({ notices }: { notices?: BundledNotices }) {
  const license = notices && bundledPath(notices.licensePath);
  const source = notices && bundledPath(notices.sourcePath);
  return (
    <details className="about-notices">
      <summary>About and licenses</summary>
      <p>
        This extension includes the original calculation and an independent
        TypeScript port of EcoLogits, developed by its contributors and part of
        CodeCarbon. EcoLogits-derived files are covered by MPL-2.0. Original
        application code uses MIT. AI Footprint Tracker is not affiliated with or
        endorsed by OpenAI, Anthropic, Google, Perplexity, EcoLogits or
        CodeCarbon.
      </p>
      <p>
        Estimates cover operational use and remain unvalidated references. They
        are not measurements of a provider's electricity or water use.
      </p>
      <a href="methodology.html" target="_blank" rel="noopener noreferrer">
        Read methodology and attribution
      </a>
      {license && source ? (
        <p>
          Release {notices!.release}.{" "}
          <a href={license} target="_blank" rel="noopener noreferrer">
            Bundled licenses and notices
          </a>
          .{" "}
          <a href={source} target="_blank" rel="noopener noreferrer">
            Corresponding source and modifications
          </a>
          .
        </p>
      ) : (
        <p>
          Source and license packaging is still being prepared for this
          development build. A verified corresponding-source route is required
          before distribution.
        </p>
      )}
    </details>
  );
}
