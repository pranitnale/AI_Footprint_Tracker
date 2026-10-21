import { createRoot } from "react-dom/client";
import { startTheme } from "../../lib/ui/theme";
import Welcome from "../../lib/welcome/Welcome";
import "@footprint/ui/living-gauge.css";
import "../../lib/ui/surfaces.css";
import "../../lib/welcome/welcome.css";
// The theme chosen in Settings applies before the first paint, as on the other extension pages.
startTheme();
createRoot(document.getElementById("root")!).render(<Welcome />);
