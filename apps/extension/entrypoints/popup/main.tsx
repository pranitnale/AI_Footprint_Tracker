import { createRoot } from "react-dom/client";
import { startTheme } from "../../lib/ui/theme";
import Popup from "../../lib/popup/Popup";
import "@footprint/ui/living-gauge.css";
import "../../lib/ui/surfaces.css";
import "../../lib/popup/popup.css";
// The theme chosen in Settings applies before the first paint (owner, 12 October 2026).
startTheme();
createRoot(document.getElementById("root")!).render(<Popup />);
