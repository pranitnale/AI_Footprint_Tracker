// The default React import keeps this module working under the classic JSX transform, as in icons.tsx.
import React, { type ReactNode } from "react";
import type { MethodologyLinks } from "./links";
import { MethodologyEcoLogits } from "./MethodologyEcoLogits";
import { MethodologyTracker } from "./MethodologyTracker";

export type { MethodologyLinks } from "./links";

/**
 * The two-part methodology. Part 1 explains what the tracker adds to EcoLogits, part 2 how EcoLogits
 * calculates. The extension passes a bar with its way back to the dashboard and shows the credit;
 * the website shows both in its own header and footer. Both link to the full technical reference,
 * which keeps the checked model inventory and every detailed rule.
 */
export function Methodology({
  part,
  links,
  bar = null,
  credit = false,
}: {
  part: 1 | 2;
  links: MethodologyLinks;
  bar?: ReactNode;
  credit?: boolean;
}) {
  const Part = part === 1 ? MethodologyTracker : MethodologyEcoLogits;
  const reference = (
    <p className="mth-p mth-muted" style={{ fontSize: "15px", lineHeight: "24px" }}>
      Every rule in full, with the checked list of models and modes:{" "}
      <a href={links.reference}>Technical reference</a>.
    </p>
  );
  return (
    <div className="mth">
      <Part links={links} bar={bar} credit={credit} reference={reference} />
    </div>
  );
}
