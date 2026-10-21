import { createRoot } from "react-dom/client";
import { Methodology } from "@footprint/ui/methodology";
import { Icon, LivingGaugeMark, PUBLIC_WEBSITE } from "@footprint/ui/icons";
import "@footprint/ui/living-gauge.css";
import "@footprint/ui/methodology.css";
import "../../lib/ui/methodology-bar.css";
import repository from "../../../../config/source-repository.json";

// Part 2 is the same page with ?part=2, so both parts work as plain links and in a new tab.
const part = new URLSearchParams(location.search).get("part") === "2" ? 2 : 1;
document.title = (part === 2 ? "How EcoLogits calculates" : "Methodology") + " · AI Footprint Tracker";

// The bar from the canvas board: the product mark, which opens the public website, and a
// button back to the dashboard (owner, 12 October 2026). Colours follow the page theme.
const bar = (
  <div className="mt-bar">
    <a className="mt-brand" href={PUBLIC_WEBSITE} target="_blank" rel="noopener noreferrer" aria-label="AI Footprint Tracker website">
      <LivingGaugeMark size={28} />
      <span>AI Footprint Tracker</span>
    </a>
    <a className="mt-back" href="dashboard.html">
      <Icon name="chevronLeft" size={16} />
      Back to dashboard
    </a>
  </div>
);

createRoot(document.getElementById("root")!).render(
  <Methodology
    part={part}
    links={{
      part1: "methodology.html",
      part2: "methodology.html?part=2",
      reference: "methodology-reference.html",
      repository: repository.url,
    }}
    bar={bar}
    credit
  />,
);
