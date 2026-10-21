import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test, { afterEach, before } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, waitFor } from "@testing-library/react";
import "./async-timeout";
import userEvent from "@testing-library/user-event";
import { ApiError, type ApiClient } from "../src/api";
import { Methodology } from "@footprint/ui/methodology";
import { SITE_ROUTES } from "../src/site/board";
import { WebContactPage, afterSending } from "../src/site/pages/WebContact";
import { WebPrivacyPage } from "../src/site/pages/WebPrivacy";
import { WebSelfHostPage } from "../src/site/pages/WebSelfHost";
import { WebHomePage } from "../src/site/pages/WebHome";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://aifootprinttracker.example/contact",
});
before(() => {
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    FormData: dom.window.FormData,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    attachEvent: { value: () => {} },
    detachEvent: { value: () => {} },
  });
});
afterEach(() => cleanup());

const PAGES = new URL("../src/site/pages/", import.meta.url);
const pageSources = readdirSync(PAGES)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => [name, readFileSync(new URL(name, PAGES), "utf8")] as const);

test("no website page ships a canvas placeholder or an unwired control", () => {
  assert.ok(pageSources.length >= 12);
  for (const [name, source] of pageSources) {
    assert.doesNotMatch(source, /todo\(|data-todo|TODO/, name);
    assert.doesNotMatch(source, /Jonas|hafenwerk/i, `${name} keeps board sample data`);
  }
});

test("every link on the website goes to a site route, a heading on the page or a named outside address", () => {
  for (const [name, source] of pageSources) {
    const ids = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, href] of source.matchAll(/href="([^"]*)"/g)) {
      if (href.startsWith("#")) assert.ok(ids.has(href.slice(1)), `${name} ${href}`);
      else if (href.startsWith("/")) assert.ok(SITE_ROUTES.has(href.split("#")[0]), `${name} ${href}`);
      else assert.match(href, /^(https:\/\/github\.com\/pranitnale\/AI_Footprint_Tracker|https:\/\/www\.linkedin\.com\/|mailto:)/, `${name} ${href}`);
    }
  }
});

test("self-hosting links to the existing operations guide", () => {
  const html = renderToStaticMarkup(<WebSelfHostPage navigate={() => {}} />);
  assert.match(
    html,
    /github\.com\/pranitnale\/AI_Footprint_Tracker\/blob\/main\/docs\/operations\/SELF-HOSTING\.md/,
  );
});

test("privacy copy keeps every disclosure of the earlier page", () => {
  const html = renderToStaticMarkup(<WebPrivacyPage navigate={() => {}} />);
  assert.match(html, /Connecting later does not upload the personal history you already have/);
  assert.match(html, /can date from before you joined/);
  assert.match(html, /Earlier messages read from chats/);
  assert.match(html, /Until deleted/);
  assert.match(html, /Prompts, answers or thinking text/);
  assert.match(html, /keyed fingerprint of the site.{1,6}s message id for this, never the id itself/);
  assert.match(html, /never one person.{1,6}s usage, and the server enforces this/);
  assert.match(html, /in an organization of one or two people they can reveal one person.{1,6}s usage/);
  assert.match(html, /Connection IP addresses are not collected/);
  assert.match(html, /Brevo delivers the one-time sign-in codes and never receives usage or chat content/);
  assert.match(html, /Exported files that were already downloaded cannot be recalled/);
});

function contactApi(replies: Array<unknown | Error>) {
  const sent: any[] = [];
  const api = {
    post: async (path: string, body: unknown) => {
      sent.push({ path, body });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply;
    },
  } as unknown as ApiClient;
  return { api, sent };
}

const problem = (status: number, code: string, safe_message: string) =>
  new ApiError({ status, code, safe_message, retryable: status >= 500 || status === 429 });

test("the contact form sends one message with a size band and thanks the sender by name", async () => {
  const { api, sent } = contactApi([{ received: true }]);
  const view = render(<WebContactPage api={api} navigate={() => {}} />);
  const user = userEvent.setup({ document: dom.window.document });
  // The larger organization topic is chosen first and shows the size question.
  assert.equal(view.getByRole("radio", { name: /More than 50 members/ }).getAttribute("aria-checked"), "true");
  await user.type(view.getByLabelText("Your name"), "Mara Klein");
  await user.type(view.getByLabelText("Work email"), "mara.klein@example.org");
  await user.type(view.getByLabelText("Organization"), "Example Consulting");
  await user.selectOptions(view.getByLabelText("People who would use it"), "101-250");
  await user.type(view.getByLabelText(/^Message/), "We would like the larger plan.");
  await user.click(view.getByRole("button", { name: "Send message" }));
  await view.findByText("Thanks, Mara. Your message has arrived.");
  view.getByText(/We will reply to mara\.klein@example\.org\. For an organization with 101 to 250 people/);
  assert.equal(sent.length, 1);
  const { idempotency_key, ...body } = sent[0].body;
  assert.equal(sent[0].path, "/v1/public/contact");
  assert.match(idempotency_key, /^[0-9a-f-]{36}$/);
  assert.deepEqual(body, {
    topic: "larger_organization",
    name: "Mara Klein",
    email: "mara.klein@example.org",
    organization: "Example Consulting",
    people: "101-250",
    message: "We would like the larger plan.",
    website: "",
  });
  // Another message starts empty and carries its own key.
  await user.click(view.getByRole("button", { name: "Send another message" }));
  assert.equal((view.getByLabelText("Your name") as HTMLInputElement).value, "");
});

test("the contact form checks its fields, hides the size question for other topics and keeps the key on retry", async () => {
  const { api, sent } = contactApi([
    problem(0, "offline", "The service could not be reached. Check your connection and try again."),
    { received: true },
  ]);
  const view = render(<WebContactPage api={api} navigate={() => {}} />);
  const user = userEvent.setup({ document: dom.window.document });
  await user.click(view.getByRole("button", { name: "Send message" }));
  assert.equal(view.getByRole("alert").textContent, "Add your name and a message.");
  await user.click(view.getByRole("radio", { name: /Self-hosting/ }));
  assert.equal(view.queryByLabelText("People who would use it"), null);
  assert.equal(view.getByLabelText(/^Message/).getAttribute("placeholder"), "Which part of self-hosting can we help with?");
  await user.type(view.getByLabelText("Your name"), "Ada");
  await user.type(view.getByLabelText("Work email"), "not-an-address");
  await user.type(view.getByLabelText(/^Message/), "Which database versions work?");
  await user.click(view.getByRole("button", { name: "Send message" }));
  assert.equal(view.getByRole("alert").textContent, "Enter a work email we can reply to.");
  assert.equal(sent.length, 0);
  await user.clear(view.getByLabelText("Work email"));
  await user.type(view.getByLabelText("Work email"), "ada@example.org");
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => assert.match(view.getByRole("alert").textContent!, /could not be reached/));
  await user.click(view.getByRole("button", { name: "Send message" }));
  await view.findByText("Thanks, Ada. Your message has arrived.");
  view.getByText("We will reply to ada@example.org. We will answer your self-hosting question.");
  // The retry after a lost reply is the same message, so the server stores it once.
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.idempotency_key, sent[1].body.idempotency_key);
  assert.equal(sent[1].body.people, null);
  assert.equal(sent[1].body.topic, "self_hosting");
});

test("a sender who is sending too often is told when to try again", async () => {
  const { api } = contactApi([problem(429, "rate_limited", "Too many requests.")]);
  const view = render(<WebContactPage api={api} navigate={() => {}} />);
  const user = userEvent.setup({ document: dom.window.document });
  await user.click(view.getByRole("radio", { name: /Something else/ }));
  await user.type(view.getByLabelText("Your name"), "Ada");
  await user.type(view.getByLabelText("Work email"), "ada@example.org");
  await user.type(view.getByLabelText(/^Message/), "Hello");
  await user.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    assert.equal(view.getByRole("alert").textContent, "Too many messages were sent from here. Try again in an hour."),
  );
});

test("the thanks line names the chosen size band", () => {
  assert.equal(afterSending("other", null), "");
  assert.equal(
    afterSending("larger_organization", "1000+"),
    "For an organization with more than 1,000 people, we will suggest a plan that fits.",
  );
  assert.equal(afterSending("larger_organization", "unknown"), "");
});

const METHOD_LINKS = {
  part1: "/methodology",
  part2: "/methodology/ecologits",
  reference: "/methodology/reference",
  repository: "https://github.com/pranitnale/AI_Footprint_Tracker",
};

test("each methodology part marks itself, links the other part and the reference, and keeps every in-page link", () => {
  for (const part of [1, 2] as const) {
    const html = renderToStaticMarkup(<Methodology part={part} links={METHOD_LINKS} />);
    const own = part === 1 ? METHOD_LINKS.part1 : METHOD_LINKS.part2;
    const other = part === 1 ? METHOD_LINKS.part2 : METHOD_LINKS.part1;
    assert.match(html, new RegExp(`href="${own}" aria-current="page"`));
    assert.match(html, new RegExp(`href="${other}"`));
    assert.match(html, /href="\/methodology\/reference">Technical reference<\/a>/);
    // Both parts link the tracker's own repository beside the EcoLogits buttons.
    assert.match(html, /href="https:\/\/github\.com\/pranitnale\/AI_Footprint_Tracker"[^>]*>Tracker source code on GitHub/);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(target), `part ${part} #${target}`);
    // The website shows the credit in its footer, so the part leaves it out.
    assert.doesNotMatch(html, /Designed and built by/);
    assert.doesNotMatch(html, /—/);
  }
  assert.match(renderToStaticMarkup(<Methodology part={1} links={METHOD_LINKS} credit />), /Designed and built by/);
});

test("a methodology source number marks its sentence, opens its source and closes again", async () => {
  const view = render(<Methodology part={1} links={METHOD_LINKS} />);
  const user = userEvent.setup({ document: dom.window.document });
  const cite = view.container.querySelector<HTMLButtonElement>('[data-cite="k1"]')!;
  const sentence = cite.previousElementSibling as HTMLElement;
  const reference = view.container.querySelector<HTMLElement>("#src-2")!;
  assert.equal(cite.getAttribute("aria-pressed"), "false");
  assert.equal(view.queryAllByRole("note").length, 0);
  await user.click(cite);
  assert.equal(cite.getAttribute("aria-pressed"), "true");
  assert.equal(sentence.style.background, "rgb(255, 233, 168)");
  assert.equal(reference.style.background, "rgb(255, 241, 204)");
  const card = view.getByRole("note");
  assert.match(card.textContent!, /Source 2/);
  // Another number moves the mark; the close button clears it.
  await user.click(view.container.querySelector<HTMLButtonElement>('[data-cite="k2"]')!);
  assert.equal(cite.getAttribute("aria-pressed"), "false");
  assert.equal(reference.style.background, "transparent");
  await user.click(view.getByRole("button", { name: "Close the source" }));
  assert.equal(view.queryAllByRole("note").length, 0);
});

test("the home page leads with Runs entirely on your computer and says where the data goes (17 October 2026)", () => {
  const html = renderToStaticMarkup(<WebHomePage navigate={() => {}} />);
  assert.match(html, /Know the energy behind your AI use\./);
  assert.doesNotMatch(html, /Chat content never leaves the browser/);
  assert.match(html, /<section class="lg-local" aria-labelledby="home-local"><h2 id="home-local" class="lg-local-title">Runs entirely on your computer\.<\/h2>/);
  assert.match(html, /The extension counts and calculates in your browser\. Your chats never leave it, and for personal use nothing at all is sent to us\./);
  for (const badge of ["Open source, MIT License", "No account for personal use", "No analytics or advertising"])
    assert.ok(html.includes(`<li>${badge}</li>`), badge);
  assert.match(html, /href="\/downloads"[^>]*>Add to your browser/);
  assert.match(html, /href="\/open-source"[^>]*>Read the code<\/a>/);
  assert.match(html, /Where your data goes/);
  const order = ["On your computer", "Sent to us", "Only if you join an organization"].map((title) => html.indexOf(`<h3>${title}</h3>`));
  assert.ok(order.every((at, index) => at > 0 && (index === 0 || at > order[index - 1]!)), "three cards in order");
  assert.match(html, /Nothing, for personal use\./);
  assert.match(html, /Never prompts, answers, files or chat titles\./);
});
