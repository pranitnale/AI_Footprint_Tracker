/**
 * Copy shared by the welcome page and the popup before the person agreed (canvas WelcomeNew and
 * PopupNew, owner decisions of 17 and 18 October 2026).
 */

/** The three points of "How it works" on the welcome page. */
export const HOW_IT_WORKS = [
  {
    title: "It reads the chat in this browser",
    text: "On ChatGPT, Claude, Gemini, Perplexity and NotebookLM it reads the page's own chat traffic to count tokens and find the model.",
  },
  {
    title: "It keeps numbers, not text",
    text: "Token counts, models, times and estimates are saved. The text of your chats is counted in memory and then discarded.",
  },
  {
    title: "Nothing leaves your computer",
    text: "Unless you later connect to an organization, which asks for its own agreement first. Even then, only numbers are sent, never your chats.",
  },
] as const;

/** The badges under "Everything runs on your computer." */
export const LOCAL_BADGES = ["Open source, MIT License", "No account", "No analytics or advertising"] as const;

/** The own-read setting, offered beside the agreement and on by default. */
export const FULL_HISTORY_LABEL = "Load full chat history automatically";
export const FULL_HISTORY_HELP =
  "Some sites show an older chat without loading all of it. With this on, the tracker asks the same site for that chat once, with your sign-in there. It only reads. You can change this in Settings.";

/**
 * The supported sites as the tour lists them, each opening its own start page. Host names match the
 * extension's host permissions in wxt.config.ts.
 */
export const TOUR_SITES = [
  { key: "chatgpt", url: "https://chatgpt.com/" },
  { key: "claude", url: "https://claude.ai/" },
  { key: "gemini", url: "https://gemini.google.com/" },
  { key: "perplexity", url: "https://www.perplexity.ai/" },
  { key: "notebooklm", url: "https://notebook.google.com/" },
] as const;

/** The popup's link to the welcome page's tour, shown before anything is recorded. */
export const TAKE_TOUR_LABEL = "Take the quick tour";
