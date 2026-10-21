export function placeFootprintHosts(
  form: Element,
  noticeHost: Element,
  barHost: Element,
) {
  form.insertAdjacentElement("beforebegin", noticeHost);
  form.insertAdjacentElement("afterend", barHost);
}

type ComposerSite =
  "chatgpt" | "claude" | "gemini" | "perplexity" | "notebooklm";

/**
 * Whether the page has finished setting up its composer, so hosts may be placed next to it.
 * Signed-out ChatGPT sets up its composer after the page loaded; nodes added next to the form
 * before then make it draw the composer again without its text box, and nobody can type until
 * a reload (live, 20 Oct 2026, also without the extension when two empty divs are added
 * there). It marks the end of that setup with html[data-octane-home-behavior-ready].
 */
export function composerPageReady(
  document: Document,
  anchor: Element,
  site: ComposerSite,
): boolean {
  return !(
    site === "chatgpt" &&
    anchor.matches("form[data-mobile-composer]") &&
    !document.documentElement.hasAttribute("data-octane-home-behavior-ready")
  );
}

const EDITOR_SELECTORS: Record<ComposerSite, string> = {
  // ChatGPT's current editor has no id; the earlier #prompt-textarea layout remains supported.
  // Without an account ChatGPT is a page of its own whose composer is a textarea in
  // form[data-mobile-composer] (seen 20 Oct 2026).
  chatgpt:
    '#prompt-textarea, form[data-chatgpt-composer] div.ProseMirror[contenteditable="true"], form[data-mobile-composer] textarea#mobile-composer-prompt',
  claude: '[contenteditable="true"].ProseMirror',
  // Quill keeps a hidden, focus-skipped clipboard helper that is also contenteditable.
  gemini: 'rich-textarea [contenteditable="true"]:not(.ql-clipboard)',
  perplexity: 'textarea[placeholder], [role="textbox"][contenteditable="true"]',
  // From a public selector list checked on the renamed Gemini Notebook in August 2026; the
  // aria-label form is its English fallback (W9).
  notebooklm: 'textarea.query-box-input, textarea[aria-label="Enter a query"]',
};

// ChatGPT Work's composer form has no data-chatgpt-composer (N7, 1 Oct). Its editor is
// looked for only when no standard composer exists, so a normal page never uses it.
const CHATGPT_FALLBACK_EDITOR_SELECTOR =
  'form div.ProseMirror[contenteditable="true"][role="textbox"]';
const CLAUDE_COMPOSER_SELECTOR =
  'fieldset[data-perf-region="composer"][data-cds-dock-group]';
const PERPLEXITY_EDITOR_SELECTOR =
  'div#ask-input[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
const PERPLEXITY_SUBMIT_SELECTOR = 'button[type="button"][aria-label="Submit"]';
// The composer box was data-appearance="raised" on 12 October 2026 and "framed" on 16 October.
const PERPLEXITY_BOX_SELECTOR =
  'div[data-appearance="raised"], div[data-appearance="framed"]';
const PERPLEXITY_VOICE_SELECTOR =
  'button[type="button"][aria-label="Use voice mode"]';
// The input-area-container class moved from the fieldset to its wrapper in a later Gemini layout.
const GEMINI_COMPOSER_SELECTOR =
  "fieldset.input-area-container, fieldset.input-area-fieldset";
const GEMINI_EDITOR_SELECTOR =
  'input-area-v2 rich-textarea [role="textbox"][contenteditable="true"]';
const GEMINI_ACTION_SELECTOR =
  'button[aria-label="Send message"], button[aria-label="Stop response"]';
const GEMINI_IDLE_SELECTOR =
  'button[aria-label="Dictate"], button[aria-label^="Dictate ("][aria-label$=")"]';
const NOTEBOOKLM_SUBMIT_SELECTOR = 'button[aria-label="Submit"]';
const MAX_EDITOR_CANDIDATES = 8;
const MAX_COMPOSER_DESCENDANTS = 256;
const SHOW_ELEMENT = 1;

type ComposerStyle = Pick<
  CSSStyleDeclaration,
  "display" | "visibility" | "opacity"
> &
  Partial<
    Pick<
      CSSStyleDeclaration,
      "gridTemplateColumns" | "overflow" | "position" | "flexDirection"
    >
  >;
type StyleReader = (element: Element) => ComposerStyle;

const defaultStyleReader: StyleReader = (element) => {
  const view = element.ownerDocument.defaultView;
  return view
    ? view.getComputedStyle(element)
    : { display: "", visibility: "", opacity: "" };
};

/**
 * Whether an element is drawn. `ariaRoot` limits the aria-hidden check to it and its
 * descendants: above it, only what the page draws counts.
 */
function isShown(
  element: Element,
  readStyle: StyleReader,
  ariaRoot: Element | null = null,
) {
  let aria = true;
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    if (
      current.hasAttribute("hidden") ||
      (aria && current.getAttribute("aria-hidden") === "true")
    )
      return false;
    if (current === ariaRoot) aria = false;
    const style = readStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return false;
  }
  return true;
}

/** Elements that may be the composer's editor, for noticing when the composer changes. */
export function composerEditorSelector(site: ComposerSite) {
  return site === "chatgpt"
    ? `${EDITOR_SELECTORS.chatgpt}, ${CHATGPT_FALLBACK_EDITOR_SELECTOR}`
    : EDITOR_SELECTORS[site];
}

export function resolveComposer(
  document: Document,
  site: ComposerSite,
  viewport: { width: number; height: number },
  readStyle: StyleReader = defaultStyleReader,
): { editor: Element; anchor: Element } | null {
  const editorSelector = EDITOR_SELECTORS[site];
  let editors = document.querySelectorAll(editorSelector);
  if (site === "chatgpt" && editors.length === 0)
    editors = document.querySelectorAll(CHATGPT_FALLBACK_EDITOR_SELECTOR);
  if (editors.length > MAX_EDITOR_CANDIDATES) return null;
  const candidates: Array<{ editor: Element; anchor: Element }> = [];

  for (const editor of editors) {
    // claude.ai marks the chat aria-hidden while its artifact panel is open, although the
    // composer stays on screen (N12). Above Claude's composer only drawn styles count.
    const ariaRoot =
      site === "claude"
        ? (editor.closest("form") ?? editor.closest(CLAUDE_COMPOSER_SELECTOR))
        : null;
    if (!isShown(editor, readStyle, ariaRoot)) continue;
    const form = editor.closest("form");
    const claudeComposer =
      !form && site === "claude"
        ? editor.closest(CLAUDE_COMPOSER_SELECTOR)
        : null;
    const perplexityComposer =
      !form && site === "perplexity"
        ? resolvePerplexityComposer(editor, viewport, readStyle)
        : null;
    const geminiComposer =
      !form && site === "gemini" && editor.matches(GEMINI_EDITOR_SELECTOR)
        ? editor.closest(GEMINI_COMPOSER_SELECTOR)
        : null;
    const notebookComposer =
      site === "notebooklm"
        ? resolveNotebookComposer(editor, form, viewport, readStyle)
        : null;
    const anchor =
      site === "notebooklm"
        ? notebookComposer
        : (form ?? claudeComposer ?? perplexityComposer ?? geminiComposer);
    if (
      !anchor ||
      !isVisibleComposerAnchor(anchor, viewport, readStyle, ariaRoot)
    )
      continue;
    // Claude's no-form layout is safe only when the semantic composer owns one editor.
    if (claudeComposer && !hasExactlyOneBounded(claudeComposer, editorSelector))
      continue;
    if (
      geminiComposer &&
      (!hasExactlyOneBounded(geminiComposer, editorSelector) ||
        !(
          hasExactlyOneBounded(geminiComposer, GEMINI_ACTION_SELECTOR) ||
          (!geminiComposer.querySelector(GEMINI_ACTION_SELECTOR) &&
            hasExactlyOneBounded(geminiComposer, GEMINI_IDLE_SELECTOR))
        ))
    )
      continue;
    candidates.push({
      editor,
      anchor:
        (geminiComposer &&
          geminiOuterBox(geminiComposer, editorSelector, viewport, readStyle)) ||
        anchor,
    });
    if (candidates.length > 1) return null;
  }

  return candidates.length === 1 ? candidates[0]! : null;
}

function resolvePerplexityComposer(
  editor: Element,
  viewport: { width: number; height: number },
  readStyle: StyleReader,
) {
  if (!editor.matches(PERPLEXITY_EDITOR_SELECTOR)) return null;
  // Keep the native grid and its decorative overlay together; their inner contents layer has no box.
  const anchors = new Set<Element>();
  let depth = 0;
  for (
    let candidate = editor.parentElement;
    candidate && depth < 8;
    candidate = candidate.parentElement
  ) {
    depth++;
    const style = readStyle(candidate);
    if (
      candidate.tagName !== "DIV" ||
      style.display !== "grid" ||
      !hasOneGridColumn(style.gridTemplateColumns) ||
      !hasExactlyOneBounded(candidate, PERPLEXITY_EDITOR_SELECTOR) ||
      !hasExactlyOneBounded(candidate, PERPLEXITY_SUBMIT_SELECTOR) ||
      !isVisibleComposerAnchor(candidate, viewport, readStyle)
    )
      continue;

    const wrapper = candidate.parentElement;
    const insertionParent = wrapper?.parentElement;
    if (!wrapper || wrapper.tagName !== "DIV" || !insertionParent) continue;
    const wrapperStyle = readStyle(wrapper);
    const parentStyle = readStyle(insertionParent);
    if (
      wrapperStyle.display === "block" &&
      wrapperStyle.position === "relative" &&
      wrapperStyle.overflow === "visible" &&
      hasExactlyOneBounded(wrapper, PERPLEXITY_EDITOR_SELECTOR) &&
      hasExactlyOneBounded(wrapper, PERPLEXITY_SUBMIT_SELECTOR) &&
      isVisibleComposerAnchor(wrapper, viewport, readStyle) &&
      parentStyle.display === "block" &&
      parentStyle.position === "static" &&
      parentStyle.overflow === "visible" &&
      isShown(insertionParent, readStyle)
    )
      anchors.add(wrapper);
  }
  if (anchors.size === 1) return [...anchors][0]!;
  return anchors.size ? null : resolvePerplexityStack(editor, viewport, readStyle);
}

/**
 * Perplexity's home page (12 October 2026) nests the composer box in a popover trigger
 * (span[aria-haspopup]) and in wrappers that each hold only it, inside a column with the
 * page's other blocks. An empty composer there shows "Use voice mode" instead of Submit.
 * The anchor climbs out of the trigger and those wrappers, checking at every step that it
 * still holds only this composer, and stops below the first parent that holds other blocks
 * and stacks them below. A bar inside the trigger would open the page's popover on click.
 */
function resolvePerplexityStack(
  editor: Element,
  viewport: { width: number; height: number },
  readStyle: StyleReader,
) {
  const box = editor.closest(PERPLEXITY_BOX_SELECTOR);
  if (!box || !holdsOnlyPerplexityComposer(box)) return null;
  let anchor: Element = box;
  for (let depth = 0; depth < 12; depth++) {
    const parent: Element | null = anchor.parentElement;
    if (!parent) return null;
    if (!anchor.closest("[aria-haspopup]") && parent.childElementCount > 1)
      return stacksBelow(readStyle(parent)) &&
        isShown(parent, readStyle) &&
        isVisibleComposerAnchor(anchor, viewport, readStyle)
        ? anchor
        : null;
    if (!holdsOnlyPerplexityComposer(parent)) return null;
    anchor = parent;
  }
  return null;
}

function holdsOnlyPerplexityComposer(box: Element) {
  return (
    hasExactlyOneBounded(box, PERPLEXITY_EDITOR_SELECTOR) &&
    (hasExactlyOneBounded(box, PERPLEXITY_SUBMIT_SELECTOR) ||
      (!box.querySelector(PERPLEXITY_SUBMIT_SELECTOR) &&
        hasExactlyOneBounded(box, PERPLEXITY_VOICE_SELECTOR)))
  );
}

/**
 * Gemini's composer fieldset used to hold the rounded input-area-v2 box. Since October 2026
 * the box holds the fieldset (live layout, 12 October 2026), so a bar placed after the
 * fieldset sat inside the box. The box becomes the anchor when it holds only this composer
 * and its parent stacks the next block below it; otherwise the fieldset stays the anchor.
 */
function geminiOuterBox(
  composer: Element,
  editorSelector: string,
  viewport: { width: number; height: number },
  readStyle: StyleReader,
) {
  const box = composer.parentElement?.closest("input-area-v2");
  const parent = box?.parentElement;
  if (
    !box ||
    !parent ||
    box.querySelectorAll("fieldset").length !== 1 ||
    !hasExactlyOneBounded(box, editorSelector) ||
    !stacksBelow(readStyle(parent)) ||
    !isVisibleComposerAnchor(box, viewport, readStyle)
  )
    return null;
  return box;
}

/**
 * NotebookLM's query box has no named container that is known to be stable, so the
 * anchor starts at the page's form, or without one at the nearest box around the editor
 * that holds only this editor and one Submit button. The sources panel has its own search
 * box and Submit button; a box that holds either twice is not the composer.
 *
 * The form sits in a row inside the rounded query box, beside the page's own controls.
 * Placed after the form, the bar became one more item of that row and squeezed the query
 * field (owner report and live layout, 5 October 2026). The anchor therefore leaves every
 * box that lays out its children side by side, while the outer box still holds only this
 * composer, so the bar sits below the rounded box. Otherwise the bar is not shown.
 */
function resolveNotebookComposer(
  editor: Element,
  form: Element | null,
  viewport: { width: number; height: number },
  readStyle: StyleReader,
) {
  let anchor = form ?? nearestNotebookBox(editor, viewport, readStyle);
  for (let depth = 0; anchor && depth < 4; depth++) {
    const parent = anchor.parentElement;
    if (!parent) return null;
    if (stacksBelow(readStyle(parent))) return anchor;
    if (
      !holdsOnlyNotebookComposer(parent) ||
      !isVisibleComposerAnchor(parent, viewport, readStyle)
    )
      return null;
    anchor = parent;
  }
  return null;
}

function nearestNotebookBox(
  editor: Element,
  viewport: { width: number; height: number },
  readStyle: StyleReader,
) {
  let depth = 0;
  for (
    let candidate = editor.parentElement;
    candidate && depth < 8;
    candidate = candidate.parentElement
  ) {
    depth++;
    if (
      !hasExactlyOneBounded(candidate, EDITOR_SELECTORS.notebooklm) ||
      candidate.querySelectorAll("textarea").length !== 1
    )
      return null;
    if (
      hasExactlyOneBounded(candidate, NOTEBOOKLM_SUBMIT_SELECTOR) &&
      isVisibleComposerAnchor(candidate, viewport, readStyle)
    )
      return candidate;
  }
  return null;
}

function holdsOnlyNotebookComposer(box: Element) {
  return (
    hasExactlyOneBounded(box, EDITOR_SELECTORS.notebooklm) &&
    box.querySelectorAll("textarea").length === 1 &&
    hasExactlyOneBounded(box, NOTEBOOKLM_SUBMIT_SELECTOR)
  );
}

/** Whether a block placed after a child of this box appears below the child. */
function stacksBelow(style: ComposerStyle) {
  switch (style.display) {
    case "flex":
    case "inline-flex":
      return style.flexDirection === "column";
    case "grid":
    case "inline-grid":
      return hasOneGridColumn(style.gridTemplateColumns);
    case "contents":
    case "none":
      return false;
    default:
      return true;
  }
}

function hasExactlyOneBounded(root: Element, selector: string) {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_ELEMENT);
  let visited = 0;
  let matches = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > MAX_COMPOSER_DESCENDANTS) return false;
    if ((node as Element).matches(selector) && ++matches > 1) return false;
  }
  return matches === 1;
}

function hasOneGridColumn(value: string | undefined) {
  if (!value || value === "none") return false;
  let depth = 0;
  let tracks = 0;
  let inTrack = false;
  for (const character of value.trim()) {
    if (character === "(" || character === "[") depth++;
    if (character === ")" || character === "]") depth--;
    if (/\s/.test(character) && depth === 0) {
      if (inTrack) tracks++;
      inTrack = false;
    } else inTrack = true;
  }
  if (inTrack) tracks++;
  return depth === 0 && tracks === 1;
}

export function isComposerSendButton(
  button: Element,
  composer: { anchor: Element },
  site: ComposerSite,
) {
  if (!composer.anchor.contains(button)) return false;
  const testId = button.getAttribute("data-testid");
  return (
    testId === "send-button" ||
    (site === "claude" && testId === "chat-input-send") ||
    (site === "perplexity" && button.matches(PERPLEXITY_SUBMIT_SELECTOR)) ||
    (site === "notebooklm" && button.matches(NOTEBOOKLM_SUBMIT_SELECTOR)) ||
    /^(send|send message|send prompt)$/i.test(
      button.getAttribute("aria-label") ?? "",
    )
  );
}

export function isVisibleComposerAnchor(
  form: Element,
  viewport: { width: number; height: number },
  readStyle: StyleReader = defaultStyleReader,
  ariaRoot: Element | null = null,
) {
  const bounds = form.getBoundingClientRect();
  const top = Number.isFinite(bounds.top)
    ? bounds.top
    : bounds.bottom - bounds.height;
  const left = Number.isFinite(bounds.left) ? bounds.left : 0;
  const right = Number.isFinite(bounds.right)
    ? bounds.right
    : left + bounds.width;
  if (
    bounds.width < 200 ||
    bounds.height < 20 ||
    top < 0 ||
    bounds.bottom > viewport.height + 1 ||
    right <= 0 ||
    left >= viewport.width
  )
    return false;

  return isShown(form, readStyle, ariaRoot);
}
