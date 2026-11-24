/**
 * The "Load full chat history automatically" setting (owner decision of 17 October 2026; name
 * and help text of 18 October 2026). It decides whether the tracker's own read (`own-read.ts`)
 * may ask a site for the messages of an opened chat that the page did not load. With it off the
 * tracker still counts everything the site loads by itself. One main switch and one switch per site; both are on
 * by default, and an installation saved before this setting existed has neither field, which
 * reads as on. Since 22 November 2026 claude.ai has one switch, "Claude", for its chats and
 * its Cowork sessions: the merged app opens both at one address, so they cannot be told apart
 * reliably. An installation that saved a separate Cowork value reads as off when either old
 * switch was off, and its next save drops the old value.
 *
 * Perplexity Computer file downloads are a separate feature and do not read this setting.
 */

export const OWN_READ_SETTING_KEYS = [
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
  "notebooklm",
] as const;

export type OwnReadSettingKey = (typeof OWN_READ_SETTING_KEYS)[number];

export const OWN_READ_SETTING_NAMES: Record<OwnReadSettingKey, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
  notebooklm: "NotebookLM",
};

/** A content script asks the background whether its site's switch is on: `{ target, key }`. */
export const OWN_READ_SETTING_TARGET = "own-read-setting";
/** The background tells open provider tabs that the setting changed; they ask again. */
export const OWN_READ_SETTING_CHANGED = "footprint-own-read-setting";
/** A content script asks the background to open Settings, from a button in Details. */
export const OPEN_SETTINGS_TARGET = "open-settings";

export type OwnReadSettings = {
  ownRead: boolean;
  ownReadSites: Record<OwnReadSettingKey, boolean>;
};

const isKey = (value: unknown): value is OwnReadSettingKey =>
  typeof value === "string" &&
  (OWN_READ_SETTING_KEYS as readonly string[]).includes(value);

/** Every field explicit; anything absent or not a boolean reads as on, the default. */
export function ownReadSettings(stored: {
  ownRead?: unknown;
  ownReadSites?: unknown;
}): OwnReadSettings {
  const sites =
    stored.ownReadSites && typeof stored.ownReadSites === "object"
      ? (stored.ownReadSites as Record<string, unknown>)
      : {};
  return {
    ownRead: stored.ownRead !== false,
    ownReadSites: Object.fromEntries(
      OWN_READ_SETTING_KEYS.map((key) => [
        key,
        // Before 22 Nov 2026 Cowork had its own switch; one off switch keeps Claude off.
        sites[key] !== false && (key !== "claude" || sites.cowork !== false),
      ]),
    ) as Record<OwnReadSettingKey, boolean>,
  };
}

/** Whether the tracker may load a chat's full history from this site now. */
export function ownReadAllowed(
  settings: OwnReadSettings,
  key: OwnReadSettingKey,
): boolean {
  return settings.ownRead && settings.ownReadSites[key];
}

/** A change to the per-site switches: known sites only, each true or false. */
export function validOwnReadSites(
  value: unknown,
): value is Partial<Record<OwnReadSettingKey, boolean>> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, on]) => isKey(key) && typeof on === "boolean",
    )
  );
}

/** The switch that governs reads on a site. */
export function ownReadSettingKeys(site: string | null | undefined): OwnReadSettingKey[] {
  return isKey(site) ? [site] : [];
}

/**
 * The background's answer to `OWN_READ_SETTING_TARGET`: true, false, or null when unreadable.
 * An answer that is off because of the main switch says so with `cause: "main"`
 * (`ownReadMainSwitchOff`), so Details can point to that switch instead of the site's.
 */
export function ownReadSettingAnswer(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const keys = Object.keys(value).sort().join(",");
  const { on, cause } = value as { on?: unknown; cause?: unknown };
  if (typeof on !== "boolean") return null;
  if (keys === "on") return on;
  return keys === "cause,on" && cause === "main" && on === false ? false : null;
}

/** Whether an answer to `OWN_READ_SETTING_TARGET` is off because of the main switch. */
export function ownReadMainSwitchOff(value: unknown): boolean {
  return (
    ownReadSettingAnswer(value) === false &&
    (value as { cause?: unknown }).cause === "main"
  );
}
