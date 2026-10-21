import { Notice } from "@footprint/ui";
import { methodologyHtml } from "./generated/methodology";

// The other public pages follow the canvas boards in src/site/pages. The methodology keeps its
// canonical text, built from docs/methodology/content.html, inside the same site layout.
export function MethodologyPage() {
  return (
    <article className="reading wrap">
      <div className="reading-intro">
        <h1>How we estimate your AI footprint</h1>
        <p>
          We count available work, apply a versioned operational energy
          method, then calculate carbon and separate cooling and
          electricity-supply water components.
        </p>
        <Notice tone="warning">
          A precise visible-text count does not prove complete request usage.
          These figures are estimates, not readings from an AI provider’s
          meter.
        </Notice>
      </div>
      <div
        className="canonical-methodology"
        dangerouslySetInnerHTML={{ __html: methodologyHtml }}
      />
    </article>
  );
}
