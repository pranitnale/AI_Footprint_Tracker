// The welcome page (canvas WelcomeNew, owner decisions of 17 and 18 October 2026), driven through
// the real dashboard client with fixture replies.
import assert from "node:assert/strict";
import test, { afterEach, before } from "node:test";
import { dom } from "./dom-env";
import React from "react";
import { cleanup, configure, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeTransport, type Scenario } from "./ui-fixtures";

dom.reconfigure({ url: "chrome-extension://aift/welcome.html" });
configure({ asyncUtilTimeout: 5000 });

before(async () => {
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: "aift", getURL: (path: string) => `chrome-extension://aift${path}` },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { create: async () => {}, getCurrent: async () => undefined, remove: async () => {} },
    },
  });
  await import("../lib/welcome/Welcome");
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const view = () => within(document.body);
const user = () => userEvent.setup({ document: dom.window.document });

async function show(scenario: Scenario) {
  const { default: Welcome } = await import("../lib/welcome/Welcome");
  let closed = 0;
  const calls = (scenario.calls ??= []);
  render(<Welcome transport={fakeTransport(scenario)} close={() => void closed++} />);
  return { calls, closed: () => closed };
}

test("welcome: the page says how it works, with Everything runs on your computer as its strongest message", async () => {
  await show({ dashboard: { consent: false } });
  assert.ok(await view().findByRole("heading", { level: 1, name: "See the footprint of your AI chats" }));
  const local = view().getByRole("region", { name: "Everything runs on your computer." });
  assert.ok(local.classList.contains("lg-local"), "the highlighted box");
  assert.match(local.textContent!, /Counting and the estimates are calculated in this browser\. Your chats and your figures are not sent to us or to any other server\./);
  assert.deepEqual(
    within(local).getAllByRole("listitem").map((item) => item.textContent),
    ["Open source, MIT License", "No account", "No analytics or advertising"],
  );
  assert.equal(within(local).getByRole("link", { name: "Read the code" }).getAttribute("href"), "https://aifootprinttracker.com/open-source");
  const how = view().getByRole("region", { name: "How it works" });
  const points = within(how).getAllByRole("listitem").map((item) => item.textContent!);
  assert.equal(points.length, 3);
  assert.match(points[0]!, /ChatGPT, Claude, Gemini, Perplexity and NotebookLM/);
  assert.match(points[1]!, /It keeps numbers, not text/);
  assert.match(points[2]!, /connect to an organization, which asks for its own agreement first/);
  assert.equal(view().getByRole("link", { name: "Privacy policy" }).getAttribute("href"), "https://aifootprinttracker.com/privacy-policy");
  assert.ok(view().getByText(/Nothing is counted until you agree\. "Not now" keeps the tracker off; open the popup to start later\./));
  const history = await waitFor(() => {
    const box = view().getByRole("checkbox", { name: /Load full chat history automatically/ }) as HTMLInputElement;
    assert.equal(box.disabled, false);
    return box;
  });
  assert.equal(history.checked, true, "on by default");
  assert.match(history.getAttribute("aria-describedby") ? document.getElementById(history.getAttribute("aria-describedby")!)!.textContent! : "", /It only reads/);
});

test("welcome: Agree and start saves the agreement with the full history choice, and Tracking is on follows", async () => {
  const { calls } = await show({ dashboard: { consent: false } });
  const agree = await view().findByRole("button", { name: "Agree and start" });
  await waitFor(() => assert.equal((agree as HTMLButtonElement).disabled, false));
  await user().click(view().getByRole("checkbox", { name: /Load full chat history automatically/ }));
  await user().click(agree);
  await view().findByText("Tracking is on.");
  assert.deepEqual(calls.find((c) => c.action === "consent")!.payload, { agreed: true, version: "2026-10-18", ownRead: false });
  assert.equal(view().queryByRole("button", { name: "Agree and start" }), null);
});

// Live QA of 19 Oct 2026: after agreeing in one welcome tab, the others still offered Agree
// and start. An open page now follows an agreement made elsewhere, and Turn off tracking too.
test("welcome: an agreement made in another tab or the popup shows on an open welcome page", async () => {
  const scenario: Scenario = { dashboard: { consent: false } };
  const transport = fakeTransport(scenario);
  const { default: Welcome } = await import("../lib/welcome/Welcome");
  let changed: () => void = () => assert.fail("the page must follow the agreement");
  let stopped = 0;
  render(
    <Welcome
      transport={transport}
      close={() => {}}
      follow={(callback) => {
        changed = callback;
        return () => void stopped++;
      }}
    />,
  );
  await view().findByRole("button", { name: "Agree and start" });
  await transport("consent", { agreed: true, version: "2026-10-18" });
  changed();
  await view().findByText("Tracking is on.");
  assert.equal(view().queryByRole("button", { name: "Agree and start" }), null);
  await transport("consent", { agreed: false });
  changed();
  await view().findByRole("button", { name: "Agree and start" });
  cleanup();
  assert.equal(stopped, 1, "the page stops listening when it closes");
});

test("welcome: Not now closes the page and agrees to nothing", async () => {
  const { calls, closed } = await show({ dashboard: { consent: false } });
  const later = await view().findByRole("button", { name: "Not now" });
  await user().click(later);
  assert.equal(closed(), 1);
  assert.equal(calls.some((c) => c.action === "consent"), false);
});

test("welcome: a person who already agreed sees that tracking is on", async () => {
  await show({ dashboard: { consent: true } });
  await view().findByText("Tracking is on.");
  assert.equal(view().queryByRole("button", { name: "Agree and start" }), null);
});

test("welcome: agreeing again while Pause is on says tracking is paused, not on", async () => {
  // Pause is separate from the agreement: a person who paused, turned tracking off and agreed
  // again is still paused, and nothing is recorded until they resume.
  await show({ dashboard: { consent: false, paused: true } });
  const agree = await view().findByRole("button", { name: "Agree and start" });
  await waitFor(() => assert.equal((agree as HTMLButtonElement).disabled, false));
  await user().click(agree);
  await view().findByText("Tracking is paused.");
  assert.equal(view().queryByText("Tracking is on."), null);
  cleanup();
  await show({ dashboard: { consent: true, paused: true } });
  await view().findByText("Tracking is paused.");
});

test("welcome: a choice that could not be saved says so and keeps the tracker off", async () => {
  const scenario: Scenario = { dashboard: { consent: false } };
  const transport = fakeTransport(scenario);
  const { default: Welcome } = await import("../lib/welcome/Welcome");
  render(
    <Welcome
      transport={async (action, payload) => {
        if (action === "consent") throw new Error("extension_request_failed");
        return transport(action, payload);
      }}
      close={() => {}}
    />,
  );
  const agree = await view().findByRole("button", { name: "Agree and start" });
  await waitFor(() => assert.equal((agree as HTMLButtonElement).disabled, false));
  await user().click(agree);
  assert.match((await view().findByRole("alert")).textContent!, /could not be saved\. Nothing is counted yet/);
  assert.ok(view().getByRole("button", { name: "Agree and start" }));
  assert.equal(view().queryByText(/Step 1 of 6/), null, "no tour without a saved agreement");
});

// The tour after agreeing (owner request of 21 October 2026): the same page explains the bar,
// Details, the popup, the dashboard and Settings, and privacy, then closes itself.
const TOUR_TITLES = [
  "You're all set. Go back to your AI tool and chat as usual.",
  "The bar under the message box",
  "Details shows the full picture",
  "Pin the tracker and open the popup",
  "The dashboard and Settings",
  "Private by design",
];
const tourHeading = () => view().getByRole("heading", { level: 1 });

async function agreeHere(scenario: Scenario = { dashboard: { consent: false } }) {
  const shown = await show(scenario);
  const agree = await view().findByRole("button", { name: "Agree and start" });
  await waitFor(() => assert.equal((agree as HTMLButtonElement).disabled, false));
  await user().click(agree);
  await view().findByText("Step 1 of 6");
  return shown;
}

test("welcome tour: agreeing turns the page into step 1 of the tour, with focus on its heading", async () => {
  await agreeHere();
  const heading = tourHeading();
  assert.equal(heading.textContent, TOUR_TITLES[0]);
  await waitFor(() => assert.equal(document.activeElement, heading, "focus follows the page change"));
  assert.equal(view().queryByRole("heading", { name: "See the footprint of your AI chats" }), null);
  assert.ok(view().getByText("Tracking is on."));
  // The reload hint stays only under the picture (owner, 21 Oct 2026).
  assert.equal(document.querySelector(".wl-tour-text")!.textContent!.includes("reload"), false);
  assert.ok(view().getByText("Reload a tab that was open before you installed the tracker."));
  // Each supported site opens in a new tab.
  const sites: Record<string, string> = {
    ChatGPT: "https://chatgpt.com/",
    Claude: "https://claude.ai/",
    Gemini: "https://gemini.google.com/",
    Perplexity: "https://www.perplexity.ai/",
    NotebookLM: "https://notebook.google.com/",
  };
  for (const [name, url] of Object.entries(sites)) {
    const link = view().getByRole("link", { name: new RegExp(`^${name}\\s*\\(opens in a new tab\\)$`) });
    assert.equal(link.getAttribute("href"), url);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.match(link.getAttribute("rel") ?? "", /noopener/);
  }
  assert.equal(view().queryByText(/signed in or not/), null, "the ChatGPT note was removed");
  assert.equal(view().queryByRole("button", { name: "Back" }), null, "nothing before the first step");
});

test("welcome tour: Next and Back move through every step, and each change is announced", async () => {
  await agreeHere();
  for (let at = 0; at < TOUR_TITLES.length; at++) {
    assert.equal(tourHeading().textContent, TOUR_TITLES[at]);
    assert.ok(view().getByText(`Step ${at + 1} of 6`));
    if (at < TOUR_TITLES.length - 1) await user().click(view().getByRole("button", { name: "Next" }));
  }
  assert.equal(view().queryByRole("button", { name: "Next" }), null);
  assert.ok(view().getByRole("button", { name: "Done, close this page" }));
  assert.equal(document.activeElement, tourHeading());
  assert.equal(document.querySelector("[aria-live='polite']")!.textContent, `Step 6 of 6: ${TOUR_TITLES[5]}`);
  for (let at = TOUR_TITLES.length - 1; at > 0; at--) {
    await user().click(view().getByRole("button", { name: "Back" }));
    assert.equal(tourHeading().textContent, TOUR_TITLES[at - 1]);
    assert.equal(document.activeElement, tourHeading());
  }
  assert.equal(document.querySelector("[aria-live='polite']")!.textContent, `Step 1 of 6: ${TOUR_TITLES[0]}`);
});

test("welcome tour: each step covers what the owner asked for, in the product's own words", async () => {
  await agreeHere();
  const text: string[] = [];
  for (let at = 0; at < TOUR_TITLES.length; at++) {
    text.push(document.querySelector(".wl-tour-step")!.textContent!);
    if (at < TOUR_TITLES.length - 1) await user().click(view().getByRole("button", { name: "Next" }));
  }
  const [, bar, details, popup, dashboard, privacy] = text;
  for (const term of ["Req", "In/Out tokens", "Electricity, Carbon, Water"]) assert.ok(bar!.includes(term), term);
  // The approximate marker and the bar states were removed from this step (owner, 21 Oct 2026).
  for (const term of ["≈", "Waiting for your request", "Processing", "No figures yet"]) assert.equal(bar!.includes(term), false, term);
  for (const term of ["Details", "everyday terms", "Tokens read and written", "smaller model", "how each figure is estimated", "Reload page"]) assert.ok(details!.includes(term), term);
  for (const term of ["Extensions button (the puzzle piece)", "pin", "today, 7 days or 30 days", "electricity, carbon and water", "split by AI tool", "Open the dashboard"]) assert.ok(popup!.includes(term), term);
  assert.equal(popup!.includes("Edge and Firefox"), false);
  for (const term of [
    "Overview",
    "Tools and models",
    "Monthly recap",
    "Methodology",
    "Minimum, Midpoint or Maximum",
    "Pause tracking",
    "Load full chat history automatically",
    "Erase all records",
    "Turn off tracking",
    "Connect to an organization",
    "Only numbers are shared, never your chats.",
  ])
    assert.ok(dashboard!.includes(term), term);
  for (const term of ["The tracker calculates everything on this computer.", "never stored or sent", "only numbers are shared"]) assert.ok(privacy!.includes(term), term);
});

// Owner request of 21 Oct 2026: letters for the popup, and the text uses the same badges as the pictures.
test("welcome tour: the badges in the text match the badges on the pictures", async () => {
  await agreeHere();
  const badges = (selector: string) => [...document.querySelectorAll(selector)].map((badge) => badge.textContent);
  for (let at = 0; at < 3; at++) await user().click(view().getByRole("button", { name: "Next" }));
  assert.equal(tourHeading().textContent, TOUR_TITLES[3]);
  assert.deepEqual(badges(".wl-tour-text .wl-inline-badge"), ["A", "B", "C", "D"]);
  assert.deepEqual(badges(".wl-tour-figure .wl-shot-badge"), ["A", "B", "C", "D"]);
  assert.deepEqual(badges(".wl-tour-figure .wl-legend-badge"), ["1", "2", "3", "A", "B", "C", "D"]);
  await user().click(view().getByRole("button", { name: "Next" }));
  assert.equal(tourHeading().textContent, TOUR_TITLES[4]);
  assert.deepEqual(badges(".wl-tour-text .wl-inline-badge"), ["1", "2", "3"]);
  assert.deepEqual(badges(".wl-tour-figure .wl-shot-badge"), ["1", "2", "3"]);
  assert.deepEqual(badges(".wl-tour-figure .wl-legend-badge"), ["1", "2", "3"]);
  const settings = [...document.querySelectorAll(".wl-tour-text .wl-lettered li")].map((item) => item.textContent);
  assert.match(settings[0]!, /^2Choose the low, midpoint or high end/);
  assert.match(settings[1]!, /^3Pause tracking\. Nothing is recorded while paused\.$/);
});

// Owner request of 21 Oct 2026: Skip on the left as a plain button, Next or Done on the right.
test("welcome tour: Skip tour and close is a secondary button on the left, Next the green one on the right", async () => {
  await agreeHere();
  const order = () => [...document.querySelectorAll(".wl-tour-nav button")].map((button) => button.textContent);
  assert.deepEqual(order(), ["Skip tour and close", "Next"]);
  const skip = view().getByRole("button", { name: "Skip tour and close" });
  assert.ok(skip.classList.contains("lg-btn") && skip.classList.contains("lg-btn-secondary"), "a real button, not a link style");
  assert.equal(skip.classList.contains("lg-btn-primary"), false, "not green like Next");
  assert.ok(view().getByRole("button", { name: "Next" }).classList.contains("lg-btn-primary"));
  await user().click(view().getByRole("button", { name: "Next" }));
  assert.deepEqual(order(), ["Back", "Skip tour and close", "Next"]);
  for (let at = 1; at < TOUR_TITLES.length - 1; at++) await user().click(view().getByRole("button", { name: "Next" }));
  assert.deepEqual(order(), ["Back", "Done, close this page"]);
});

test("welcome tour: every step has a picture with alt text, and every screenshot is packaged", async () => {
  const { readFileSync, statSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  await agreeHere();
  for (let at = 0; at < TOUR_TITLES.length; at++) {
    const figure = document.querySelector(".wl-tour-figure") as HTMLElement;
    const pictures = within(figure).getAllByRole("img");
    assert.ok(pictures.length >= 1, `step ${at + 1} has a picture`);
    for (const picture of pictures) {
      const name = picture.getAttribute("alt") ?? picture.getAttribute("aria-label") ?? "";
      assert.ok(name.length > 20, `step ${at + 1}: a picture without alt text`);
      const src = picture.getAttribute("src");
      if (src) {
        assert.match(src, /^\/tutorial\/[a-z]+\.webp$/);
        const file = fileURLToPath(new URL(`../public${src}`, import.meta.url));
        assert.ok(statSync(file).size > 1000, `${src} is in public/`);
        assert.equal(readFileSync(file).subarray(8, 12).toString("latin1"), "WEBP");
      }
    }
    if (at < TOUR_TITLES.length - 1) await user().click(view().getByRole("button", { name: "Next" }));
  }
});

test("welcome tour: Done, close this page and Skip tour and close both close the tab", async () => {
  const first = await agreeHere();
  await user().click(view().getByRole("button", { name: "Skip tour and close" }));
  assert.equal(first.closed(), 1);
  await user().click(view().getByRole("button", { name: "Next" }));
  await user().click(view().getByRole("button", { name: "Skip tour and close" }));
  assert.equal(first.closed(), 2, "Skip is offered on the later steps too");
  cleanup();
  const second = await agreeHere();
  for (let at = 1; at < TOUR_TITLES.length; at++) await user().click(view().getByRole("button", { name: "Next" }));
  assert.equal(view().queryByRole("button", { name: "Skip tour and close" }), null, "Done is the one close button on the last step");
  await user().click(view().getByRole("button", { name: "Done, close this page" }));
  assert.equal(second.closed(), 1);
});

test("welcome tour: a page opened after agreeing shows the tour without taking focus", async () => {
  const { closed } = await show({ dashboard: { consent: true } });
  await view().findByText("Step 1 of 6");
  assert.equal(tourHeading().textContent, TOUR_TITLES[0]);
  assert.notEqual(document.activeElement, tourHeading());
  assert.equal(document.querySelector("[aria-live='polite']")!.textContent, "");
  assert.equal(closed(), 0);
});

test("welcome tour: with Pause on the tour says so at the top and never says tracking is on", async () => {
  await agreeHere({ dashboard: { consent: false, paused: true } });
  const note = view().getByRole("status");
  assert.match(note.textContent!, /Tracking is paused\.Nothing is recorded\. To resume, use the popup or Settings\./);
  assert.ok(note.compareDocumentPosition(tourHeading()) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, "above the steps");
  assert.equal(view().queryByText("Tracking is on."), null);
  await user().click(view().getByRole("button", { name: "Next" }));
  assert.ok(view().getByRole("status"), "the note stays on every step");
});
