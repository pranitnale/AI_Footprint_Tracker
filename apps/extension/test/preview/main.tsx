// Visual preview of the redesigned extension surfaces with fixture data. Test-only, never packaged.
//   ?surface=popup&state=personal|org|org-offline|org-error|paused|connect|pending|confirm|problem|problem-hook|first|consent
//   ?surface=welcome&state=consent|agreed|agreed-paused&step=0..5 (the welcome page, 18 October 2026, and its tour, 21 October 2026)
//   ?surface=dashboard&state=...&route=overview|models|recap|settings|tracking|licences|connect&scope=me|org&metric=energy
import { createRoot } from "react-dom/client";
import "@footprint/ui/living-gauge.css";
import "../../lib/ui/surfaces.css";
import { fakeTransport, type Scenario } from "../ui-fixtures";

const params = new URLSearchParams(location.search);
const surface = params.get("surface") ?? "popup";
const state = params.get("state") ?? "personal";
const scenarios: Record<string, Scenario> = {
  personal: {},
  first: { dashboard: { empty: true } },
  paused: { dashboard: { paused: true } },
  problem: { dashboard: { health: [{ code: "protocol_unsupported" }] } },
  "problem-hook": { dashboard: { health: [{ code: "capture_hook_missing" }] } },
  connect: {},
  pending: { dashboard: { pending: true } },
  confirm: { dashboard: { pending: "verified" } },
  org: { dashboard: { mode: "company" } },
  "org-offline": { dashboard: { mode: "company", queueCount: 12 }, orgOffline: true },
  "org-error": { dashboard: { mode: "company", queueCount: 12 }, orgFails: true },
  // Before the person agreed to tracking, and after (lib/tracking-consent.ts).
  consent: { dashboard: { consent: false } },
  agreed: { dashboard: { consent: true } },
  "agreed-paused": { dashboard: { consent: true, paused: true } },
};
const stub = (await import("./browser-stub")).browser;

if (surface === "welcome") {
  await import("../../lib/welcome/welcome.css");
  const { default: Welcome } = await import("../../lib/welcome/Welcome");
  createRoot(document.getElementById("root")!).render(
    <Welcome transport={fakeTransport(scenarios[state] ?? scenarios.consent!)} close={() => console.info("close")} tourStep={Number(params.get("step") ?? 0)} />,
  );
} else if (surface === "details") {
  (await import("./details")).renderDetails(params);
} else if (surface === "popup") {
  const scope = ["connect", "pending", "confirm", "org", "org-offline", "org-error"].includes(state) ? "org" : "me";
  await stub.storage.local.set({
    "ui:popup": { scope, period: params.get("period") ?? "30d" },
    ...(state === "paused" ? { "ui:paused": { at: Date.now() - 2 * 3600_000 } } : {}),
  });
  await import("../../lib/popup/popup.css");
  const { default: Popup } = await import("../../lib/popup/Popup");
  createRoot(document.getElementById("root")!).render(<Popup transport={fakeTransport(scenarios[state] ?? {})} />);
} else {
  await stub.storage.local.set({
    "ui:dashboard": { scope: params.get("scope") ?? "me", period: params.get("period") ?? "30d", metric: params.get("metric") ?? "energy" },
  });
  if (params.get("route")) location.hash = params.get("route")!;
  await import("../../lib/dash/dash.css");
  const { default: Dashboard } = await import("../../lib/dash/Dashboard");
  createRoot(document.getElementById("root")!).render(
    <Dashboard transport={fakeTransport(scenarios[state] ?? {})} requestPermission={async () => true} notices={{ licensePath: "licenses.html", sourcePath: "source/index.html", release: "preview" }} />,
  );
}
