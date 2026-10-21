// Preview of the Details overlay with fixture figures, built by the same module the content script uses.
//   ?surface=details&open=compared,counted,estimated,context&state=problem&site=chatgpt
// state=problem shows an actionable bar status; state=notcounted the Details-only warning section;
// state=sync the organization sync icon (owner, 13 Oct 2026).
import {
  comparisonLine,
  comparisonNodes,
  countedDots,
  countedNodes,
  countedParts,
  countedSummary,
  DETAILS_STYLES,
  detailsStatusGroups,
  detailsSyncState,
  disclosure,
  notCountedHeading,
  notCountedNodes,
  syncNodes,
  estimatedNodes,
  estimatedSummary,
  headerLine,
  icon,
  overviewNodes,
  smallerModelCard,
  smallerModelNodes,
  statusNodes,
  type ComparisonState,
  type DetailsInput,
} from "../../lib/details-overview";

const SITE_NAMES: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini", perplexity: "Perplexity", notebooklm: "NotebookLM", cowork: "Claude" };

export function renderDetails(params: URLSearchParams) {
  const surface = params.get("site") ?? "chatgpt";
  const open = new Set((params.get("open") ?? "").split(",").filter(Boolean));
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.body.style.cssText = `margin:0;padding:24px;background:${dark ? "#0b1c13" : "#f4f5ef"};font-family:"Segoe UI",system-ui,sans-serif`;
  const host = document.createElement("div");
  host.dataset.aftTheme = dark ? "dark" : "light";
  // The content script sets these warning tokens on the host for each theme.
  host.style.setProperty("--aft-warning", dark ? "#4c3b19" : "#fff0c4");
  host.style.setProperty("--aft-warning-ink", dark ? "#fff0c4" : "#53380b");
  document.getElementById("root")!.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // The overlay's base rules from the content script, without its page anchoring.
  style.textContent = `*{box-sizing:border-box}h3{font-size:14px;margin:16px 0 6px}p{margin:8px 0}.panel{position:relative;overflow:auto}` + DETAILS_STYLES;
  shadow.append(style);
  const input: DetailsInput = {
    surface,
    siteName: SITE_NAMES[surface] ?? "ChatGPT",
    scenario: "minimum",
    requests: "4",
    requestsApproximate: false,
    tokensIn: "9860",
    tokensOut: "2150",
    energy: { value: "0.013", unit: "kWh", value_kind: "midpoint_sum", scenario_low: "0.00899", scenario_high: "0.0171" },
    carbon: { value: "5", unit: "gCO2e", value_kind: "midpoint_sum", scenario_low: "3.46", scenario_high: "6.55" },
    water: { value: "0.048", unit: "L", value_kind: "midpoint_sum", scenario_low: "0.0292", scenario_high: "0.0683" },
    models: ["chatgpt-gpt-5-6-sol"],
    earlierLoaded: true,
  };
  const panel = document.createElement("section");
  panel.className = "panel";
  panel.innerHTML = '<div class="dt-head"><div><h2>This chat</h2><p class="dt-sub" data-sub></p></div><button type="button" class="close" aria-label="Close details"></button></div><div data-body></div><p class="dt-local" data-local-line><b>Calculated on your computer.</b> Nothing from this chat was sent to us.</p><p class="dt-credit">Designed and built by <a href="#">Pranit Nale</a></p>';
  panel.querySelector(".close")!.append(icon(document, "close", 16));
  panel.querySelector("[data-sub]")!.textContent = headerLine(input);
  const body = panel.querySelector<HTMLElement>("[data-body]")!;
  const state = params.get("state");
  const groups = detailsStatusGroups(state === "problem" ? "Tracking problem (reload page)" : "", state === "notcounted" ? "Matching incomplete · Earlier activity unavailable" : "");
  body.append(...statusNodes(document, groups.bar, () => undefined));
  body.append(...overviewNodes(document, input));
  const section = (id: string, title: string, summary: string, extra?: Node) => {
    const made = disclosure(document, { id, title, summary, extra, open: open.has(id), onToggle: () => undefined });
    body.append(made.box);
    return made;
  };
  const comparison: ComparisonState = { state: "ready", result: { chats: 31, thisChat: 8.99, smallerShare: 0.72, averageWh: 5.62, todayShare: 0.24, bins: [2, 4, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1], thisBin: 6, smallerModel: { minimum: -2.1, midpoint: -7.1, maximum: -12.2, records: ["gpt-6-luna"], replies: 6, unchanged: 0 } } };
  // As in the content script: the smaller-model card comes with the comparison reply.
  const smaller = comparison.state === "ready" ? smallerModelCard(input, comparison.result.smallerModel) : null;
  if (smaller) body.append(smallerModelNodes(document, smaller));
  section("compared", "Compared with your chats", comparisonLine(comparison)).body.append(...comparisonNodes(document, comparison));
  const parts = countedParts(surface, input.siteName, input.earlierLoaded);
  section("counted", "What was counted", countedSummary(parts, input.siteName), countedDots(document, parts)).body.append(...countedNodes(document, parts, input.siteName));
  const estimated = section("estimated", "How this was estimated", estimatedSummary(input));
  estimated.body.append(...estimatedNodes(document, input));
  const more = document.createElement("div");
  more.className = "dt-more";
  more.innerHTML = "<h3>Not included</h3><p>Hidden input such as system prompts, memory, project knowledge and retrieved sources is not shown by the site and is not counted.</p>";
  estimated.body.append(more);
  if (groups.notCounted.length) {
    const heading = notCountedHeading(groups.notCounted);
    const made = disclosure(document, { id: "not-counted", title: heading.title, summary: heading.summary, tone: "warn", open: open.has("not-counted"), onToggle: () => undefined });
    made.body.append(...notCountedNodes(document, groups.notCounted, "Req 4 · In/Out tokens - ≈ 9,860/2,150"));
    body.append(made.box);
  }
  const syncState = detailsSyncState({ mode: state === "sync" ? "company" : "personal", offline: false, pending: true, current: true });
  const syncRow = document.createElement("div");
  syncRow.className = "dt-sync-row";
  if (syncState) syncRow.append(syncNodes(document, syncState));
  panel.querySelector(".dt-local")!.before(syncRow);
  shadow.append(panel);
}
