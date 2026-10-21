import { createRoot } from "react-dom/client";
import { startTheme } from "../../lib/ui/theme";
import Dashboard from "../../lib/dash/Dashboard";
import { bundledNotices } from "../../build/release-metadata";
import "@footprint/ui/living-gauge.css";
import "../../lib/ui/surfaces.css";
import "../../lib/dash/dash.css";
// The theme chosen in Settings applies before the first paint (owner, 12 October 2026).
startTheme();
createRoot(document.getElementById("root")!).render(<Dashboard notices={bundledNotices} />);
