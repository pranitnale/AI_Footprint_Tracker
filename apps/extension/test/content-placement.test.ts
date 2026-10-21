import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  isComposerSendButton,
  isVisibleComposerAnchor,
  placeFootprintHosts,
  resolveComposer,
} from "../lib/content-placement";

const visibleStyle = (element: Element) => ({
  display: element.getAttribute("data-hidden") === "true" ? "none" : "block",
  visibility: "visible",
  opacity: "1",
});

function setComposerBounds(element: Element) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 768,
      height: 100,
      top: 600,
      bottom: 700,
      left: 100,
      right: 868,
    }),
  });
}

test("context advice is placed above the native composer and the compact bar below", () => {
  const dom = new JSDOM(
    '<main><section id="before"></section><form id="composer"><textarea></textarea></form><section id="after"></section></main>',
  );
  const form = dom.window.document.querySelector("form")!;
  const notice = dom.window.document.createElement("div");
  notice.dataset.aiFootprint = "context-advice";
  const bar = dom.window.document.createElement("div");
  bar.dataset.aiFootprint = "information";

  placeFootprintHosts(form, notice, bar);

  assert.equal(form.previousElementSibling, notice);
  assert.equal(form.nextElementSibling, bar);
  assert.equal(form.parentElement?.children.length, 5);
  assert.equal(form.contains(notice), false);
  assert.equal(form.contains(bar), false);
});

test("a visible bottom composer in a display-contents wrapper remains a valid anchor", () => {
  const dom = new JSDOM(
    '<main><div id="flow"><div id="wrapper"><form id="composer"><textarea></textarea></form></div></div></main>',
  );
  const form = dom.window.document.querySelector("#composer")!;
  Object.defineProperty(form, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 640,
      height: 52,
      top: 644,
      bottom: 696,
      left: 320,
      right: 960,
    }),
  });
  const style = (element: Element) => ({
    display: element.id === "wrapper" ? "contents" : "block",
    visibility: "visible",
    opacity: "1",
  });
  assert.equal(
    isVisibleComposerAnchor(form, { width: 1280, height: 720 }, style),
    true,
  );

  form.setAttribute("hidden", "");
  assert.equal(
    isVisibleComposerAnchor(form, { width: 1280, height: 720 }, style),
    false,
  );
  form.removeAttribute("hidden");
  Object.defineProperty(form, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width: 640,
      height: 52,
      top: 721,
      bottom: 773,
      left: 320,
      right: 960,
    }),
  });
  assert.equal(
    isVisibleComposerAnchor(form, { width: 1280, height: 720 }, style),
    false,
  );
});

test("Claude resolves its unique visible semantic composer without a form", () => {
  const dom = new JSDOM(`
    <main>
      <fieldset data-perf-region="composer" data-cds-dock-group>
        <button data-testid="chat-input-attach">Attach</button>
        <button data-testid="model-selector-dropdown">Model</button>
        <div contenteditable="true" class="ProseMirror" data-testid="chat-input"></div>
        <button data-testid="chat-input-send">Send</button>
      </fieldset>
    </main>
  `);
  const fieldset = dom.window.document.querySelector("fieldset")!;
  setComposerBounds(fieldset);

  const composer = resolveComposer(
    dom.window.document,
    "claude",
    { width: 1200, height: 800 },
    visibleStyle,
  );

  assert.equal(composer?.anchor, fieldset);
  assert.equal(
    isComposerSendButton(
      dom.window.document.querySelector('[data-testid="chat-input-send"]')!,
      composer!,
      "claude",
    ),
    true,
  );
  for (const testId of ["chat-input-attach", "model-selector-dropdown"])
    assert.equal(
      isComposerSendButton(
        dom.window.document.querySelector(`[data-testid="${testId}"]`)!,
        composer!,
        "claude",
      ),
      false,
    );
});

test("Gemini resolves its bounded semantic fieldset without changing the native editor tree", () => {
  const dom =
    new JSDOM(`<main><input-container><fieldset class="input-area-container">
    <input-area-v2><div class="input-area children-ready"><rich-textarea>
      <div class="ql-editor textarea new-input-ui" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
    </rich-textarea><button aria-label="Send message" disabled>Send</button></div></input-area-v2>
  </fieldset></input-container></main>`);
  const fieldset = dom.window.document.querySelector("fieldset")!;
  setComposerBounds(fieldset);
  const before = fieldset.innerHTML;
  const composer = resolveComposer(
    dom.window.document,
    "gemini",
    { width: 1200, height: 800 },
    visibleStyle,
  );
  assert.equal(composer?.anchor, fieldset);
  const notice = dom.window.document.createElement("div"),
    bar = dom.window.document.createElement("div");
  placeFootprintHosts(composer!.anchor, notice, bar);
  assert.equal(fieldset.innerHTML, before);
  assert.equal(fieldset.previousElementSibling, notice);
  assert.equal(fieldset.nextElementSibling, bar);
  assert.equal(
    isComposerSendButton(
      fieldset.querySelector("button")!,
      composer!,
      "gemini",
    ),
    true,
  );
});

test("ChatGPT resolves its current id-less editor inside the composer form", () => {
  // Observed on 26 September 2026: the ProseMirror editor no longer has #prompt-textarea.
  const dom = new JSDOM(`<main><form class="relative flex flex-col gap-2" data-chatgpt-composer data-composer-placement="home">
    <div class="ComposerLayoutRoot"><div contenteditable="true" class="ProseMirror" role="textbox" aria-label="Ask ChatGPT"></div>
    <button aria-label="Dictate">Dictate</button></div></form></main>`);
  const form = dom.window.document.querySelector("form")!;
  setComposerBounds(form);
  const composer = resolveComposer(
    dom.window.document,
    "chatgpt",
    { width: 1200, height: 800 },
    visibleStyle,
  );
  assert.equal(composer?.anchor, form);
  assert.equal(composer?.editor.getAttribute("aria-label"), "Ask ChatGPT");
  // An unrelated rich-text field outside the composer form is not a composer.
  const other = new JSDOM(
    `<main><form><div contenteditable="true" class="ProseMirror"></div></form></main>`,
  );
  setComposerBounds(other.window.document.querySelector("form")!);
  assert.equal(
    resolveComposer(
      other.window.document,
      "chatgpt",
      { width: 1200, height: 800 },
      visibleStyle,
    ),
    null,
  );
});

// Live, 20 Oct 2026: ChatGPT used without an account is a different page ("unauth-mweb"). Its
// composer is a textarea#mobile-composer-prompt in form[data-mobile-composer][data-logged-out],
// and its send button is labelled "Send message". Before, no bar was placed there.
test("signed-out ChatGPT resolves its mobile composer form and send button", () => {
  const dom = new JSDOM(`<main><div data-composer-dictation-idle-content>
    <form data-landing data-logged-out data-mobile-composer data-voice-entry>
      <div data-composer-wrap-outer><div data-composer-wrap-inner><div data-composer-primary>
        <div data-composer-editor-host><textarea id="mobile-composer-prompt" data-mobile-composer-prompt name="prompt" aria-label="Chat with ChatGPT"></textarea></div>
      </div></div></div>
      <button type="button" aria-label="Start dictation" data-start-dictation></button>
      <button type="submit" aria-label="Send message" data-composer-submit data-send-label="Send message" data-stop-label="Stop generating"></button>
    </form>
    <form data-privacy-consent-form="true"></form>
    <form data-auth-provider="email"><input type="email"></form>
  </div></main>`);
  const form = dom.window.document.querySelector("form[data-mobile-composer]")!;
  setComposerBounds(form);
  const composer = resolveComposer(
    dom.window.document,
    "chatgpt",
    { width: 1200, height: 800 },
    visibleStyle,
  );
  assert.equal(composer?.anchor, form);
  assert.equal(composer?.editor.id, "mobile-composer-prompt");
  assert.equal(
    isComposerSendButton(form.querySelector("[data-composer-submit]")!, composer!, "chatgpt"),
    true,
  );
  // A textarea named prompt outside the signed-out composer form is no composer.
  const other = new JSDOM(
    `<main><form><textarea id="mobile-composer-prompt"></textarea></form></main>`,
  );
  setComposerBounds(other.window.document.querySelector("form")!);
  assert.equal(
    resolveComposer(other.window.document, "chatgpt", { width: 1200, height: 800 }, visibleStyle),
    null,
  );
});

// Live, 20 Oct 2026: on the first loads of signed-out ChatGPT the page finishes setting up its
// composer only after the tracker could place its bar. Nodes added next to the composer form
// before then make the page draw the composer again without its text box (reproduced without the
// extension by adding two empty divs there), so nobody can type until a reload. The page marks
// the end of its setup on <html> with data-octane-home-behavior-ready.
test("20 Oct 2026: signed-out ChatGPT's composer is ready for the bar only once the page marks its setup done", async () => {
  const placement = (await import("../lib/content-placement")) as any;
  assert.equal(typeof placement.composerPageReady, "function");
  const dom = new JSDOM(`<main><div><form data-landing data-logged-out data-mobile-composer>
      <div data-composer-editor-host><textarea id="mobile-composer-prompt" data-mobile-composer-prompt></textarea></div>
    </form></div></main>`);
  const document = dom.window.document;
  const form = document.querySelector("form[data-mobile-composer]")!;
  assert.equal(placement.composerPageReady(document, form, "chatgpt"), false);
  document.documentElement.setAttribute("data-octane-home-behavior-ready", "");
  assert.equal(placement.composerPageReady(document, form, "chatgpt"), true);
  // The signed-in composer and other sites have no such wait.
  const signedIn = new JSDOM(`<main><form data-chatgpt-composer><div id="prompt-textarea"></div></form></main>`);
  assert.equal(
    placement.composerPageReady(
      signedIn.window.document,
      signedIn.window.document.querySelector("form")!,
      "chatgpt",
    ),
    true,
  );
  assert.equal(placement.composerPageReady(document, form, "claude"), true);
});

test("N7 ChatGPT Work's composer without the composer mark is found only when no standard composer exists", () => {
  const work = new JSDOM(`<main><form class="relative flex w-full">
    <div contenteditable="true" class="ProseMirror" role="textbox" aria-label="Ask anything"></div>
    <button aria-label="Send prompt">Send</button></form></main>`);
  const form = work.window.document.querySelector("form")!;
  setComposerBounds(form);
  const resolve = (document: Document) =>
    resolveComposer(document, "chatgpt", { width: 1200, height: 800 }, visibleStyle);
  assert.equal(resolve(work.window.document)?.anchor, form);
  // A standard composer on the page wins; the other rich-text field is not used.
  const both = new JSDOM(`<main>
    <form id="edit"><div contenteditable="true" class="ProseMirror" role="textbox"></div></form>
    <form data-chatgpt-composer><div contenteditable="true" class="ProseMirror" role="textbox"></div></form>
  </main>`);
  for (const element of both.window.document.querySelectorAll("form"))
    setComposerBounds(element);
  assert.equal(
    resolve(both.window.document)?.anchor,
    both.window.document.querySelector("form[data-chatgpt-composer]"),
  );
  // Two possible composers without the mark are ambiguous, so no bar is placed.
  const two = new JSDOM(`<main>
    <form><div contenteditable="true" class="ProseMirror" role="textbox"></div></form>
    <form><div contenteditable="true" class="ProseMirror" role="textbox"></div></form>
  </main>`);
  for (const element of two.window.document.querySelectorAll("form"))
    setComposerBounds(element);
  assert.equal(resolve(two.window.document), null);
});

test("Gemini resolves the later layout with an input-area-fieldset and Quill's clipboard helper", () => {
  // Observed on 26 September 2026: input-area-container is now the fieldset's wrapper.
  const dom = new JSDOM(`<main><input-container><div class="input-area-container is-zero-state">
    <fieldset class="input-area-fieldset"><input-area-v2><div class="input-area children-ready"><rich-textarea>
      <div class="ql-editor ql-blank textarea new-input-ui" role="textbox" aria-label="Enter a prompt for Gemini" contenteditable="true"></div>
      <div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>
    </rich-textarea><button aria-label="Dictate (^⇧D)">Dictate</button></div></input-area-v2>
  </fieldset></div></input-container></main>`);
  const fieldset = dom.window.document.querySelector("fieldset")!;
  setComposerBounds(fieldset);
  const composer = resolveComposer(
    dom.window.document,
    "gemini",
    { width: 1200, height: 800 },
    visibleStyle,
  );
  assert.equal(composer?.anchor, fieldset);
});

test("Gemini's October layout puts the bar below the rounded input-area-v2 box that now holds the fieldset", () => {
  // Observed on 12 October 2026: the fieldset moved inside input-area-v2, so a bar placed
  // after the fieldset sat inside the rounded box.
  const html = (containerStyle: string) =>
    new JSDOM(`<main><input-container><div class="input-area-container" data-style="${containerStyle}">
    <input-area-v2><auto-suggest></auto-suggest><div class="input-area children-ready">
      <fieldset class="input-area-fieldset"><rich-textarea>
        <div class="ql-editor textarea new-input-ui" role="textbox" contenteditable="true"></div>
        <div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>
      </rich-textarea><button aria-label="Dictate (^⇧D)"></button></fieldset>
    </div></input-area-v2></div></input-container></main>`);
  const styled = (element: Element) =>
    element.getAttribute("data-style") === "row"
      ? { ...visibleStyle(element), display: "flex", flexDirection: "row" }
      : { ...visibleStyle(element), display: "flex", flexDirection: "column" };
  const dom = html("column");
  const document = dom.window.document;
  const box = document.querySelector("input-area-v2")!;
  setComposerBounds(box);
  setComposerBounds(document.querySelector("fieldset")!);
  const composer = resolveComposer(
    document,
    "gemini",
    { width: 1200, height: 800 },
    styled,
  );
  assert.equal(composer?.anchor, box);
  placeFootprintHosts(
    composer!.anchor,
    document.createElement("div"),
    document.createElement("section"),
  );
  assert.equal(box.nextElementSibling?.tagName, "SECTION");
  assert.equal(box.contains(document.querySelector("section")), false);

  // A box whose parent lays children side by side keeps the fieldset as the anchor.
  const row = html("row").window.document;
  setComposerBounds(row.querySelector("input-area-v2")!);
  setComposerBounds(row.querySelector("fieldset")!);
  assert.equal(
    resolveComposer(row, "gemini", { width: 1200, height: 800 }, styled)
      ?.anchor,
    row.querySelector("fieldset"),
  );
});

test("Gemini handles idle, draft and generating action controls while rejecting ambiguous composers", () => {
  for (const dictate of ["Dictate", "Dictate (^⇧D)"])
    for (const action of [
      "",
      '<button aria-label="Send message"></button>',
      '<button aria-label="Stop response"></button>',
    ]) {
      const dom =
        new JSDOM(`<main><fieldset class="input-area-container"><input-area-v2><rich-textarea>
      <div role="textbox" contenteditable="true"></div></rich-textarea>
      <button aria-label="${dictate}"></button>${action}
    </input-area-v2></fieldset></main>`);
      const document = dom.window.document,
        fieldset = document.querySelector("fieldset")!;
      setComposerBounds(fieldset);
      assert.equal(
        resolveComposer(
          document,
          "gemini",
          { width: 1200, height: 800 },
          visibleStyle,
        )?.anchor,
        fieldset,
      );
      if (action) {
        fieldset.insertAdjacentHTML("beforeend", action);
        assert.equal(
          resolveComposer(
            document,
            "gemini",
            { width: 1200, height: 800 },
            visibleStyle,
          ),
          null,
        );
        fieldset.lastElementChild!.remove();
      }
      const second = fieldset.cloneNode(true) as Element;
      fieldset.parentElement!.append(second);
      setComposerBounds(second);
      assert.equal(
        resolveComposer(
          document,
          "gemini",
          { width: 1200, height: 800 },
          visibleStyle,
        ),
        null,
      );
      second.remove();
      fieldset
        .querySelector("rich-textarea")!
        .insertAdjacentHTML(
          "beforeend",
          '<div role="textbox" contenteditable="true"></div>',
        );
      assert.equal(
        resolveComposer(
          document,
          "gemini",
          { width: 1200, height: 800 },
          visibleStyle,
        ),
        null,
      );
    }
});

// Perplexity's home page on 12 October 2026: the composer box sits in a popover trigger and
// single-child wrappers inside the page's column, and an empty composer has no Submit. No
// bar mounted, and each visit logged a "Something needs a look" problem.
test("Perplexity's home composer places the bar below the composer and outside its popover trigger", () => {
  const html = (action: string, extra = "", appearance = "raised") =>
    new JSDOM(`<main><div id="column">
      <h1>What do you want to know?</h1>
      <div id="outer"><div class="w"><div class="w"><span id="trigger" type="button" aria-haspopup="dialog">
        <div id="frame"><div data-appearance="${appearance}" id="raised"><div class="grid">
          <div id="ask-input" role="textbox" contenteditable="true" data-lexical-editor="true"></div>
          <button type="button" aria-label="Add files or tools"></button>
          <button type="button" aria-label="Dictation"></button>${action}
        </div></div><div class="overlay"></div></div>
      </span></div></div></div>
      <div id="card">Set up Computer</div>${extra}
    </div></main>`);
  const readStyle = (element: Element) => ({
    display: element.id === "column" ? "flex" : "block",
    flexDirection: element.id === "column" ? "column" : undefined,
    visibility: "visible",
    opacity: "1",
    position: "static",
    overflow: "visible",
  });
  const resolve = (dom: JSDOM) => {
    for (const element of dom.window.document.querySelectorAll("div, span"))
      setComposerBounds(element);
    return resolveComposer(
      dom.window.document,
      "perplexity",
      { width: 1200, height: 800 },
      readStyle,
    );
  };
  const voice = '<button type="button" aria-label="Use voice mode"></button>';
  const submit = '<button type="button" aria-label="Submit"></button>';
  // Perplexity renamed the box's appearance from raised to framed (live, 16 October 2026).
  for (const appearance of ["raised", "framed"])
  for (const action of [voice, submit]) {
    const dom = html(action, "", appearance);
    const composer = resolve(dom);
    const outer = dom.window.document.querySelector("#outer")!;
    assert.equal(composer?.anchor, outer);
    assert.equal(
      outer.contains(dom.window.document.querySelector("#trigger")),
      true,
    );
    placeFootprintHosts(
      outer,
      dom.window.document.createElement("aside"),
      dom.window.document.createElement("section"),
    );
    assert.equal(outer.nextElementSibling?.tagName, "SECTION");
    assert.equal(
      dom.window.document.querySelector("#trigger section, #trigger aside"),
      null,
    );
  }
  assert.equal(
    isComposerSendButton(
      html(submit).window.document.querySelector('[aria-label="Submit"]')!,
      resolve(html(submit))!,
      "perplexity",
    ),
    false,
    "a button from another document never counts",
  );
  // A doubled action, a second editor, or no action at all fail closed.
  assert.equal(resolve(html(voice + voice)), null);
  assert.equal(resolve(html(submit + submit)), null);
  assert.equal(resolve(html("")), null);
  const twoEditors = html(submit);
  twoEditors.window.document
    .querySelector("#frame")!
    .insertAdjacentHTML(
      "beforeend",
      '<div role="textbox" contenteditable="true" data-lexical-editor="true" id="ask-input"></div>',
    );
  assert.equal(resolve(twoEditors), null);
});

test("composer resolution skips a hidden first editor and fails closed on ambiguity", () => {
  const dom = new JSDOM(`
    <main>
      <form id="hidden-form" data-hidden="true">
        <div contenteditable="true" class="ProseMirror"></div>
      </form>
      <form id="visible-form">
        <div contenteditable="true" class="ProseMirror"></div>
      </form>
    </main>
  `);
  const hidden = dom.window.document.querySelector("#hidden-form")!;
  const visible = dom.window.document.querySelector("#visible-form")!;
  setComposerBounds(hidden);
  setComposerBounds(visible);

  assert.equal(
    resolveComposer(
      dom.window.document,
      "claude",
      { width: 1200, height: 800 },
      visibleStyle,
    )?.anchor,
    visible,
  );

  hidden.removeAttribute("data-hidden");
  assert.equal(
    resolveComposer(
      dom.window.document,
      "claude",
      { width: 1200, height: 800 },
      visibleStyle,
    ),
    null,
  );
});

test("N12 Claude keeps its composer while the artifact panel marks the chat aria-hidden", () => {
  const dom = new JSDOM(`
    <main aria-hidden="true">
      <fieldset data-perf-region="composer" data-cds-dock-group>
        <div contenteditable="true" class="ProseMirror" data-testid="chat-input"></div>
        <button data-testid="chat-input-send">Send</button>
      </fieldset>
    </main>
  `);
  const fieldset = dom.window.document.querySelector("fieldset")!;
  setComposerBounds(fieldset);
  const resolve = () =>
    resolveComposer(
      dom.window.document,
      "claude",
      { width: 1200, height: 800 },
      visibleStyle,
    );
  assert.equal(resolve()?.anchor, fieldset);
  // Inside the composer, aria-hidden still marks a copy that is not the real editor.
  fieldset.setAttribute("aria-hidden", "true");
  assert.equal(resolve(), null);
  fieldset.removeAttribute("aria-hidden");
  // What the page draws still decides above the composer.
  dom.window.document.querySelector("main")!.setAttribute("data-hidden", "true");
  assert.equal(resolve(), null);
  // Other sites keep treating aria-hidden ancestors as hidden.
  const chatgpt = new JSDOM(`
    <main>
      <form data-chatgpt-composer><div contenteditable="true" class="ProseMirror"></div></form>
    </main>
  `);
  const form = chatgpt.window.document.querySelector("form")!;
  setComposerBounds(form);
  const resolveChatgpt = () =>
    resolveComposer(
      chatgpt.window.document,
      "chatgpt",
      { width: 1200, height: 800 },
      visibleStyle,
    );
  assert.equal(resolveChatgpt()?.anchor, form);
  chatgpt.window.document
    .querySelector("main")!
    .setAttribute("aria-hidden", "true");
  assert.equal(resolveChatgpt(), null);
});

test("Claude no-form fallback rejects an ambiguous semantic composer", () => {
  const dom = new JSDOM(`
    <fieldset data-perf-region="composer" data-cds-dock-group>
      <div contenteditable="true" class="ProseMirror"></div>
      <div contenteditable="true" class="ProseMirror"></div>
    </fieldset>
  `);
  setComposerBounds(dom.window.document.querySelector("fieldset")!);

  assert.equal(
    resolveComposer(
      dom.window.document,
      "claude",
      { width: 1200, height: 800 },
      visibleStyle,
    ),
    null,
  );
});

test("Perplexity resolves the safe wrapper around its unique grid composer", () => {
  const dom = new JSDOM(`
    <span id="insertion-parent">
      <div id="wrapper">
        <div id="outer-grid">
          <div id="contents">
            <div id="inner-grid">
              <div id="ask-input" role="textbox" contenteditable="true" data-lexical-editor="true"></div>
              <button type="button" aria-label="Add files or tools">Add</button>
              <button type="button" aria-label="Submit" disabled>Submit</button>
            </div>
          </div>
        </div>
        <div aria-hidden="true">Decoration</div>
      </div>
    </span>
  `);
  const styles: Record<string, Partial<CSSStyleDeclaration>> = {
    "insertion-parent": {
      display: "block",
      position: "static",
      overflow: "visible",
    },
    wrapper: { display: "block", position: "relative", overflow: "visible" },
    "outer-grid": {
      display: "grid",
      gridTemplateColumns: "720px",
      position: "static",
      overflow: "visible",
    },
    contents: { display: "contents" },
    "inner-grid": {
      display: "grid",
      gridTemplateColumns: "minmax(0px, 720px)",
    },
  };
  const readStyle = (element: Element) => ({
    display: styles[element.id]?.display ?? "block",
    visibility: "visible",
    opacity: "1",
    gridTemplateColumns: styles[element.id]?.gridTemplateColumns,
    overflow: styles[element.id]?.overflow ?? "visible",
    position: styles[element.id]?.position ?? "static",
  });
  const wrapper = dom.window.document.querySelector("#wrapper")!;
  setComposerBounds(wrapper);
  setComposerBounds(dom.window.document.querySelector("#outer-grid")!);
  setComposerBounds(dom.window.document.querySelector("#inner-grid")!);

  const composer = resolveComposer(
    dom.window.document,
    "perplexity",
    { width: 1200, height: 800 },
    readStyle,
  );

  assert.equal(composer?.anchor, wrapper);
  assert.equal(
    isComposerSendButton(
      dom.window.document.querySelector('[aria-label="Submit"]')!,
      composer!,
      "perplexity",
    ),
    true,
  );
  assert.equal(
    isComposerSendButton(
      dom.window.document.querySelector('[aria-label="Add files or tools"]')!,
      composer!,
      "perplexity",
    ),
    false,
  );

  styles["outer-grid"]!.gridTemplateColumns = "300px 300px";
  assert.equal(
    resolveComposer(
      dom.window.document,
      "perplexity",
      { width: 1200, height: 800 },
      readStyle,
    ),
    null,
  );
});

test("W9 NotebookLM resolves the box around its query field and Submit, never the sources search", () => {
  const page = (composer: string, editor = '<textarea class="query-box-input" aria-label="Query box"></textarea>') =>
    new JSDOM(`
      <main id="main">
        <section id="sources">
          <textarea aria-label="Search the web for new sources"></textarea>
          <button type="button" aria-label="Submit">Go</button>
        </section>
        <section id="chat">
          <div id="panel">
            <div id="composer">
              <div id="field">${editor}</div>
              ${composer}
            </div>
            <p>NotebookLM can be inaccurate.</p>
          </div>
        </section>
      </main>
    `);
  const resolve = (dom: JSDOM) => {
    for (const id of ["field", "composer", "panel", "chat"]) {
      const element = dom.window.document.getElementById(id);
      if (element) setComposerBounds(element);
    }
    return resolveComposer(
      dom.window.document,
      "notebooklm",
      { width: 1200, height: 800 },
      visibleStyle,
    );
  };
  const dom = page('<button type="button" aria-label="Submit">Send</button>');
  const composer = resolve(dom);
  assert.equal(composer?.anchor, dom.window.document.getElementById("composer"));
  assert.equal(
    isComposerSendButton(
      dom.window.document.querySelector('#composer [aria-label="Submit"]')!,
      composer!,
      "notebooklm",
    ),
    true,
  );
  // The English label is the fallback when the class changes.
  const labelled = page(
    '<button type="button" aria-label="Submit">Send</button>',
    '<textarea aria-label="Enter a query"></textarea>',
  );
  assert.equal(
    resolve(labelled)?.anchor,
    labelled.window.document.getElementById("composer"),
  );
  // Two Submit buttons around the field, or none, leave no composer: the bar fails closed.
  assert.equal(
    resolve(page('<button aria-label="Submit">A</button><button aria-label="Submit">B</button>')),
    null,
  );
  assert.equal(resolve(page("")), null);
});

test("NotebookLM leaves the rows around its form so the bar sits below the rounded query box", () => {
  // The layout seen on 5 October 2026: the form sits in a row inside the rounded box
  // (.input-group), and the box around that (.query-box) is a column.
  const page = (extra = "") =>
    new JSDOM(`
      <section id="chat">
        <query-box>
          <div id="query-box">
            <div id="group">
              <form id="form">
                <div id="message">
                  <div id="wrapper"><textarea class="query-box-input" aria-label="Query box"></textarea></div>
                  <div id="actions"><span>1 source</span><button type="button" aria-label="Submit">Send</button></div>
                </div>
              </form>
              ${extra}
            </div>
          </div>
        </query-box>
        <div id="disclaimer">NotebookLM can be inaccurate.</div>
      </section>
    `);
  const styles: Record<string, Partial<CSSStyleDeclaration>> = {
    wrapper: { display: "flex", flexDirection: "row" },
    message: { display: "flex", flexDirection: "row" },
    form: { display: "flex", flexDirection: "column" },
    group: { display: "flex", flexDirection: "row" },
    "query-box": { display: "flex", flexDirection: "column" },
  };
  const readStyle = (element: Element) => ({
    display:
      styles[element.id]?.display ??
      (element.localName === "query-box" ? "inline" : "block"),
    flexDirection: styles[element.id]?.flexDirection ?? "row",
    gridTemplateColumns: styles[element.id]?.gridTemplateColumns,
    visibility: "visible",
    opacity: "1",
  });
  const resolve = (dom: JSDOM) => {
    for (const id of ["message", "form", "group", "query-box"]) {
      const element = dom.window.document.getElementById(id);
      if (element) setComposerBounds(element);
    }
    return resolveComposer(
      dom.window.document,
      "notebooklm",
      { width: 1200, height: 800 },
      readStyle,
    );
  };
  const dom = page();
  const document = dom.window.document;
  const composer = resolve(dom);
  const group = document.getElementById("group")!;
  assert.equal(composer?.anchor, group);
  assert.equal(
    isComposerSendButton(
      document.querySelector('[aria-label="Submit"]')!,
      composer!,
      "notebooklm",
    ),
    true,
  );
  // The bar follows the rounded box in its column, above the disclaimer; the advice
  // stays above the box.
  const notice = document.createElement("div");
  const bar = document.createElement("div");
  placeFootprintHosts(composer!.anchor, notice, bar);
  assert.equal(bar.previousElementSibling, group);
  assert.equal(bar.parentElement, document.getElementById("query-box"));
  assert.equal(notice.nextElementSibling, group);
  // Without the form, the nearest box around the field and Submit leads to the same place.
  const formless = page();
  const form = formless.window.document.getElementById("form")!;
  form.replaceWith(...form.childNodes);
  assert.equal(
    resolve(formless)?.anchor,
    formless.window.document.getElementById("group"),
  );
  // A row that also holds another text field or Submit cannot be left, so no bar.
  assert.equal(resolve(page('<textarea aria-label="Note"></textarea>')), null);
  assert.equal(
    resolve(page('<button type="button" aria-label="Submit">Other</button>')),
    null,
  );
  // A grid with one column stacks its items; a grid with two columns is a row.
  styles.group = { display: "grid", gridTemplateColumns: "571px" };
  const column = page();
  assert.equal(
    resolve(column)?.anchor,
    column.window.document.getElementById("form"),
  );
  styles.group = { display: "grid", gridTemplateColumns: "1fr 48px" };
  const grid = page();
  assert.equal(
    resolve(grid)?.anchor,
    grid.window.document.getElementById("group"),
  );
  // An outer row is left as well.
  styles["query-box"] = { display: "flex", flexDirection: "row" };
  const nested = page();
  assert.equal(
    resolve(nested)?.anchor,
    nested.window.document.getElementById("query-box"),
  );
});

test("composer discovery fails closed before styling an excessive candidate set", () => {
  const dom = new JSDOM(
    `<main>${Array.from(
      { length: 9 },
      (_, index) =>
        `<form id="composer-${index}"><div contenteditable="true" class="ProseMirror"></div></form>`,
    ).join("")}</main>`,
  );
  let styleReads = 0;

  assert.equal(
    resolveComposer(
      dom.window.document,
      "claude",
      { width: 1200, height: 800 },
      () => {
        styleReads++;
        return { display: "block", visibility: "visible", opacity: "1" };
      },
    ),
    null,
  );
  assert.equal(styleReads, 0);
});
