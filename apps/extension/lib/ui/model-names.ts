/**
 * Readable names for registry model ids on the dashboard ("claude-opus-5-5" reads "Claude Opus 5.5").
 * Presentation only: the ids themselves, and which estimate each one uses, stay as recorded.
 */
const SPECIAL: Record<string, string> = {
  "chatgpt-latest": "ChatGPT latest model",
  "chatgpt-think": "ChatGPT thinking",
  "chatgpt-reasoning-effort": "ChatGPT reasoning effort",
  "chatgpt-pro-option": "ChatGPT Pro option",
  "chatgpt-images-thinking": "ChatGPT images with thinking",
  "chatgpt-deep-research": "ChatGPT deep research",
  "chatgpt-agent": "ChatGPT agent",
  "chatgpt-voice-bidi": "ChatGPT voice",
  "chatgpt-voice-live": "ChatGPT live voice",
  "chatgpt-voice-advanced": "ChatGPT advanced voice",
  "chatgpt-voice-standard": "ChatGPT standard voice",
  "chatgpt-unlisted": "ChatGPT model not yet listed",
  "claude-effort": "Claude effort setting",
  "claude-thinking": "Claude thinking",
  "claude-unlisted": "Claude model not yet listed",
  "gemini-public-flash": "Gemini Flash",
  "gemini-public-flash-lite": "Gemini Flash-Lite",
  "gemini-public-pro": "Gemini Pro",
  "gemini-thinking-level": "Gemini thinking level",
  "gemini-deep-think": "Gemini Deep Think",
  "gemini-deep-research": "Gemini deep research",
  "gemini-unnamed": "Gemini, model not named",
  "gemini-unlisted": "Gemini model not yet listed",
  "gemini-omni-video": "Gemini Omni video",
  "notebooklm-default": "NotebookLM model",
  "notebooklm-image": "NotebookLM images",
  "perplexity-best": "Perplexity Best",
  "perplexity-search": "Perplexity search",
  "perplexity-thinking": "Perplexity thinking",
  "perplexity-deep-research": "Perplexity deep research",
  "perplexity-agentic-research": "Perplexity agentic research",
  "perplexity-create-files": "Perplexity files and apps",
  "perplexity-image-default": "Perplexity images",
  "perplexity-video-unlisted": "Perplexity video model not yet listed",
  "perplexity-unlisted": "Perplexity model not yet listed",
  "perplexity-unlisted-anthropic": "Claude model on Perplexity, not yet listed",
  "perplexity-unlisted-google": "Gemini model on Perplexity, not yet listed",
  // Variants whose id names a kind rather than a family or variant (14 October 2026).
  "claude-small-unlisted": "Claude mini, nano or lite model, not yet listed",
  "perplexity-claude-small-unlisted": "Claude mini, nano or lite model on Perplexity, not yet listed",
  "gemini-image-unlisted": "Gemini image model not yet listed",
  "perplexity-gemini-image-unlisted": "Gemini image model on Perplexity, not yet listed",
  // OpenAI's help page: GPT-6 Pro in ChatGPT is GPT-6 Astra through the Pro reasoning option.
  "chatgpt-gpt-6-pro": "GPT-6 Astra (Pro reasoning)",
  // Owner decision of 14 October 2026: o3-pro is o3 with Pro reasoning. The library has no o3
  // record, so it is estimated with the nearest one, GPT-6 Astra.
  "chatgpt-o3-pro": "o3 (Pro reasoning)",
  "perplexity-o3-pro": "o3 (Pro reasoning)",
  // Owner decision of 14 October 2026: Nano Banana Pro is Gemini 3 Pro Image.
  "gemini-nano-banana-pro": "Nano Banana Pro (Gemini 3 Pro Image)",
  "perplexity-nano-banana-pro": "Nano Banana Pro (Gemini 3 Pro Image)",
};
const WORDS: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  o1: "o1",
  o3: "o3",
  o4: "o4",
  mini: "mini",
  nano: "nano",
  pro: "Pro",
  lite: "Lite",
  ultra: "Ultra",
  k3: "K3",
};
const SITES = ["chatgpt", "claude", "gemini", "perplexity", "notebooklm"];

export function modelName(id: string): string {
  if (SPECIAL[id]) return SPECIAL[id]!;
  // A family's or variant's unlisted id ("claude-haiku-unlisted", "chatgpt-gpt-pro-unlisted")
  // names the family or variant but not the version.
  const family = id.match(/^(perplexity-)?(.+)-unlisted$/);
  if (family)
    return `${modelName(family[2]!)}${family[1] ? " on Perplexity" : ""}, version not yet listed`;
  // A Pro after a GPT family name is that model with Pro reasoning, not a model of its own
  // (owner correction of 14 October 2026): "chatgpt-gpt-6-sol-pro" reads "GPT-6 Sol (Pro reasoning)".
  const proReasoning = id.match(/^(.+-(?:sol|astra|luna|terra))-pro$/);
  if (proReasoning) return `${modelName(proReasoning[1]!)} (Pro reasoning)`;
  let rest = id;
  for (const site of SITES)
    if (rest.startsWith(`${site}-`) && site !== "claude" && site !== "gemini") {
      rest = rest.slice(site.length + 1);
      break;
    }
  const parts = rest.split("-");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    // Consecutive numbers are one version: "5-6" reads "5.6".
    if (/^\d+$/.test(part)) {
      let version = part;
      while (i + 1 < parts.length && /^\d+$/.test(parts[i + 1]!)) version += `.${parts[++i]}`;
      const previous = out.at(-1);
      if (previous === "GPT") out[out.length - 1] = `GPT-${version}`;
      else out.push(version);
      continue;
    }
    if (out.at(-1) === "GPT" && /^\d/.test(part)) {
      out[out.length - 1] = `GPT-${part}`;
      continue;
    }
    if (part === "nano" && parts[i + 1] === "banana") {
      out.push("Nano Banana");
      i++;
      continue;
    }
    // Names after "Flash" join with a dash, as the vendors write them: "Flash-Lite".
    if (part === "lite" && out.at(-1) === "Flash") {
      out[out.length - 1] = "Flash-Lite";
      continue;
    }
    out.push(WORDS[part] ?? part[0]!.toUpperCase() + part.slice(1));
  }
  return out.join(" ");
}

/** The readable name of an EcoLogits record ("openai/gpt-6.1-sol" reads "GPT-6.1 Sol"). */
export function recordName(record: string): string {
  return modelName(record.replace(/^[a-z_]+\//, "").replace(/\./g, "-"));
}

// Reasoning settings a site's label can carry after the model, as seen in the labels: a
// setting of the model, not another model (owner decision of 14 October 2026). Longer words
// first, so "auto-thinking" is not read as "thinking".
const SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ["auto-thinking", "Auto thinking"],
  ["extended thinking", "Extended thinking"],
  ["thinking", "Thinking"],
  ["instant", "Instant"],
  ["fast", "Fast"],
  ["high", "High"],
];

/**
 * A raw site label with a reasoning setting, read as its model with the setting in brackets
 * ("claude-haiku-6-thinking" reads "Claude Haiku 6 (Thinking)"). Other labels, and compact
 * ids such as Perplexity's "claude55haikuthinking" that cannot be split reliably, stay as the
 * site wrote them.
 */
export function labelName(raw: string): string {
  const text = raw.trim();
  // ChatGPT Work slugs end in "-wm" and Claude ids in a date; neither is part of the name.
  const lower = text.toLowerCase().replace(/-(?:wm|20\d{6}|latest)$/, "");
  if (/[_/]|[a-z]\d|\d[a-z]/.test(lower)) return text;
  for (const [word, setting] of SETTINGS) {
    const model = lower.endsWith(word) ? lower.slice(0, -word.length) : null;
    if (model && /^.+[- ]$/.test(model))
      return `${modelName(model.slice(0, -1).replace(/[ .]+/g, "-"))} (${setting})`;
  }
  return text;
}
