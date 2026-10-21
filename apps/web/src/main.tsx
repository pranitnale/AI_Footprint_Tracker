import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import "@footprint/ui/living-gauge.css";
import "./styles.css";
// The admin pages' components; every class starts with ad-.
import "./admin/admin.css";
// Each of these is scoped (.au, .site, .mth), so none of them reaches the admin or developer pages.
import "./auth.css";
import "./site/site.css";
import "@footprint/ui/methodology.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
