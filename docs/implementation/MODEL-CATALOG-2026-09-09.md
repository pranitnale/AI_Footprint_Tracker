# Consumer-app model catalog: 9 September 2026

This catalog combines the complete text-model menus inspected in one signed-in account per site with current official documentation. The four menus contained 27 choices, including the automatic labels Latest and Best and two visible Max-gated choices in Perplexity. The Gemini account was a work account.

This is exhaustive within those inspected menus. It is not a universal list for every plan, region, staged rollout, private Enterprise configuration, hidden fallback or agent submodel. A visible option can still require an upgrade. Media and separate agent-model menus were not inspected; their entries below are documented availability, not observed account access.

The [machine-readable catalog](../../registry/model-catalog-2026-09-09.json) keeps models, modes, routers and general families separate. Every entry has a source and availability statement. Inclusion does not certify token counting, context occupancy, electricity measurement or production adapter support.

## ChatGPT

### Observed text menu

| Exact visible choice | Meaning established by this check |
| --- | --- |
| Latest | Selected automatic/current-model label. The name alone does not identify an execution model. |
| GPT-5.6 Sol | Named model choice. |
| GPT-5.5 | Named legacy choice. Its effort and execution model must be observed separately. |

Extra High was selected in the composer. Its model submenu contained the three choices above. The [same-day protocol audit](LIVE-BROWSER-AUDIT-2026-09-09.md) separately observed an Extra High response reporting `gpt-5-6-thinking`. That does not establish a universal mapping from Latest, every GPT-5.6 Sol request or a developer API model.

### Public availability and routing

| Documented model or setting | Applicable scope |
| --- | --- |
| GPT-5.6 Sol | Eligible paid Chat plans. Medium and High are listed for Plus, Pro, Business and Enterprise; Extra High for Pro, Business and Enterprise. |
| GPT-5.6 Luna | Free and Go default as rollout proceeds; also powers their Think option. Not a selectable standard Chat choice. |
| GPT-5.6 Sol Pro | Pro option on eligible Pro, Business and Enterprise plans, with plan-specific allowances. |
| GPT-6 Pro | Powered by GPT-6 Astra; rolling out to Pro $100, Pro $200, Business and Enterprise. |
| Instant / Medium / High / Extra High | Speed and reasoning settings. Automatic reasoning can occur while Instant remains selected. |
| Pro / Think | Settings with model- and plan-dependent meanings, not unique model IDs. |

The official help page says, “Terra and Luna are not selectable in standard ChatGPT conversations.” Work, Codex and API availability must be recorded separately. Plus access to Astra in Work or Codex does not prove Astra access in Chat. [GPT-5.6 and GPT-6 Pro in ChatGPT](https://help.openai.com/en/articles/20001354-gpt-56-and-gpt-6-pro-in-chatgpt), displayed as updated 20 hours before this check.

GPT-5.5 remains in the inspected menu. Older release notes describe GPT-5.5 Instant, Thinking, Pro and a July 6 Instant Mini fallback; those historical descriptions are not proof that every variant remains selectable or that the fallback still applies after the GPT-5.6 rollout. The current help page permits earlier models where supported. [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes).

### Media and voice

| Documented name | Surface and applicability |
| --- | --- |
| ChatGPT Images 2.5 | Image generation and editing on all tiers; web, iOS and Android. Announced September 8. |
| Images with thinking | Plus, Pro and Business; Enterprise and Edu described as coming soon. |
| GPT-Live-1 | Live voice on eligible paid plans. Current help includes managed-workspace availability. |
| GPT-Live-1 mini | Live voice for Free and some paid-plan allowances. |
| Live / Advanced / Standard | Voice modes. Current help does not establish the exact model behind Advanced or Standard. |

Sources: [Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt), displayed updated 19 hours earlier; [ChatGPT Voice](https://help.openai.com/en/articles/20001274), displayed updated four days earlier. These model names must not be inferred from a text-chat selection.

## Claude.ai

### Observed text menu

| Exact visible model | Relevant documented availability or paid-chat context |
| --- | --- |
| Fable 5.1 | Selected. All paid plans, with Fable-specific usage rules; 1M paid-chat context. |
| Opus 5 | Observed in More models; 1M paid-chat context. |
| Sonnet 5 | Observed in More models; 1M paid-chat context. |
| Haiku 4.5 | Observed in More models. No individual paid-chat capacity row in the inspected context article. |
| Fable 5 | Observed in More models; all paid plans under the Fable-specific usage rules. See the capacity gap below. |
| Opus 4.8 | Observed in More models; 500K paid-chat context. |
| Opus 4.7 | Observed in More models; 500K paid-chat context. |
| Opus 4.6 | Observed in More models; 500K paid-chat context. |
| Opus 3 | Observed in More models; officially retained for all paid Claude.ai subscribers after formal retirement. |
| Sonnet 4.6 | Observed in More models; 500K paid-chat context. |

The named context values apply to Claude.ai chat on paid plans. They are full windows, with some capacity reserved for the response, and do not measure current occupied context. The general 200K rule in the article covers models outside the named larger-window groups, but Haiku 4.5 and Opus 3 are not individually named in its chat paragraph. Fable 5 is named in the Code and Cowork 1M lists but omitted from the explicit chat lists. This catalog does not copy those 1M values into Fable 5 chat. [Paid Claude context windows](https://support.claude.com/en/articles/8606394-how-large-is-the-context-window-on-paid-claude-plans); [usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work), dated July 13.

Fable 5 and 5.1 are included within the Fable share of regular limits on Max and premium Team or legacy Enterprise seats. Pro and standard seats use usage credits. Their former promotion ended July 19 and never covered Fable 5.1. [Claude Fable models on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan).

Fable 5.1 is the only API mapping added here. The [live protocol audit](LIVE-BROWSER-AUDIT-2026-09-09.md) paired its visible label with `claude-fable-5-1`, and the [official launch page](https://www.anthropic.com/claude-fable-and-mythos-5-1) independently gives that developer API identifier. This identifies the model label; it does not identify a validated local tokenizer.

### Effort, thinking and retirement

The selected Fable 5.1 menu showed Low, Medium, High, Extra and Max. Medium was marked Default and High was selected. The documentation calls Extra “Extra high (xhigh).” Thinking is a separate setting; Fable 5.1 and Opus 5 cannot turn it off in Claude.ai. API rules can differ. The displayed Max usage multiplier is not a measured energy ratio. [Model, effort and thinking settings](https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings).

A retirement label does not always mean removal from the consumer app. Anthropic's February 25 update explicitly keeps Opus 3 available to paid Claude.ai users after its January 5 formal retirement. Conversely, January 16 release notes explicitly removed Opus 4 and 4.1 from the model selector. [Opus 3 continued access](https://www.anthropic.com/research/deprecation-updates-opus-3); [Claude release notes](https://support.claude.com/en/articles/12138966-release-notes).

Mythos 5.1 is not added as a generally available Claude.ai choice. Its September 1 launch describes restricted trusted-access programs, whereas Fable 5.1 is generally available. Shared underlying model weights do not make these app choices interchangeable. [Fable 5.1 and Mythos 5.1](https://www.anthropic.com/claude-fable-and-mythos-5-1).

## Gemini Apps

### Observed work-account menu

| Exact visible choice | Visible description |
| --- | --- |
| 3.6 Flash | All-around help; marked New. |
| 3.6 Thinking | Solves complex problems; selected. |
| 3.1 Pro | Advanced reasoning. |

These labels belong to one inspected work account. The exact developer model and tokenizer behind each were not established. In particular, a Thinking label must not automatically become a model ID.

### Public documentation uses different scopes

| Documentation scope | Names and settings currently listed |
| --- | --- |
| Personal Google Account | Gemini Flash-Lite, Gemini Flash and Gemini Pro. The access table prefixes them with Gemini 3 but does not supply every point version. |
| Personal thinking settings | Standard thinking, Extended thinking and Deep Think. Deep Think requires Pro and AI Ultra. |
| Work or school account | Model categories Fast, Thinking and Pro, depending on Workspace edition. A separate feature row names Deep Think 3.1 for AI Ultra Access. |

Personal-account guidance says, “Model names, versions, and availability may change.” It lists all three model families across no-AI-plan, AI Plus, AI Pro and AI Ultra, with different limits. Its published context values are 32K without an AI plan, 128K for AI Plus and 1M for AI Pro or Ultra. [Personal Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en).

Workspace eligibility, protections and capacities are a different contract. The work/school article still uses Fast, Thinking and Pro and separately gives Deep Think 3.1 a 192K context. Do not transfer the personal-plan 1M figure to every work-account mode. The three inspected point-version labels are kept separately instead of being silently renamed to the public family labels. [Gemini Apps with a work or school account](https://support.google.com/gemini/answer/14620100?hl=en).

Neither Google help page displayed a publication/update date in its article body. Access date alone does not resolve the differences between current documentation and a current account menu.

### Media models

| Documented name | How the app uses it |
| --- | --- |
| Nano Banana 2 Lite | Image requests with Flash-Lite selected. |
| Nano Banana 2 | Image requests with Flash or Pro selected. |
| Nano Banana Pro | Paid image redo with Pro selected; Workspace rules differ. |
| Gemini Omni | Video generation and editing with an eligible Google AI plan or Workspace license. |
| Lyria | Music generation. The fetched help page supplies no version. Full tracks require Pro. |

Sources: [Gemini images](https://support.google.com/gemini/answer/14286560?hl=en), [Gemini video](https://support.google.com/gemini/answer/16126339?hl=en), [Gemini music](https://support.google.com/gemini/answer/16901237?hl=en). These are separate media workloads. Google currently restricts video upload for editing in the EEA, Switzerland, UK and some US states; this does not establish a restriction on every video-generation operation.

## Perplexity

### Observed Search menu and official snapshot

| Observed choice | Official consumer Search-plan statement |
| --- | --- |
| Best | Automatic option; Free and paid plans. Selected in this account. |
| Sonar 2 | Pro and Max. |
| GPT-5.6 Terra | Pro and Max. |
| GPT-5.6 Sol | Max. Visible but upgrade-gated in the inspected account. |
| Gemini 3.8 Flash | Observed name. September 4 official snapshot instead lists Gemini 3.7 Flash on Pro and Max. |
| Claude Sonnet 5 | Pro and Max. |
| Claude Opus 5 | Max. Visible but upgrade-gated in the inspected account. |
| Kimi K3 | Pro and Max; shown with Thinking. |
| GLM 5.3 | Pro and Max; shown with Thinking. |
| Grok 4.6 | Pro and Max. |
| Nemotron 3 Ultra | Pro and Max; shown with Thinking. |

The official catalog was last modified September 5 and dates its model tables September 4. It says the account selector is the source of truth and permits differences due to trials, rollout, region and organization settings. Enterprise Pro and Enterprise Max tables include all ten named models in that snapshot, subject to administration and data-retention restrictions. [Perplexity advanced model catalog](https://www.perplexity.ai/help-center/en/articles/10354919-what-advanced-ai-models-are-included-in-my-subscription).

Gemini 3.7 Flash in that source and 3.8 Flash in the inspected menu remain distinct dated records. The catalog does not choose one spelling and silently discard the other.

Thinking is a setting, not another model. Best is an automatic model option within Search, not a separate search mode. Perplexity's tools, search, prompts and limits also differ from the providers' own apps, so neither tokenizers nor context capacities should be imported solely from matching display names. [Advanced model catalog](https://www.perplexity.ai/help-center/en/articles/10354919-what-advanced-ai-models-are-included-in-my-subscription).

### Other modes and media

| Name | What is established |
| --- | --- |
| Deep Research | Models are chosen automatically. |
| Learn Mode | A learning workflow, without a unique model identity established here. |
| Model Council | Multiple models plus synthesis. Max/Enterprise Max on web and eligible iOS; Computer version available on paid plans using credits. |
| Computer | Separate agent surface with its own model selector and credit rules. Its complete model menu was not inspected. |
| Comet | Separate browser-assistant surface; its model list can differ from Search and was not inspected. |
| Default image model | Automatic image routing, distinct from Best in Search. |
| GPT Image 1 / Nano Banana / Seedream 4.5 | Named public image preferences. The article does not give a point version for Nano Banana. |
| Nano Banana Pro | Explicitly listed for Max and Enterprise Max image access. |
| Veo 3.1 | Video model assigned by subscription; Enterprise Pro is described as fast mode. No manual video-model choice. |

Sources: [advanced model catalog](https://www.perplexity.ai/help-center/en/articles/10354919-what-advanced-ai-models-are-included-in-my-subscription), [Model Council](https://www.perplexity.ai/help-center/en/articles/13641704-what-is-model-council), [Computer](https://www.perplexity.ai/help-center/en/articles/13837784-what-is-computer), [image generation](https://www.perplexity.ai/help-center/en/articles/10354781-generating-images-with-perplexity), [video generation](https://www.perplexity.ai/help-center/en/articles/11985060-generating-videos-with-perplexity). The detailed Model Council page includes iOS although the catalog summary mentions web only.

## Conflicts, exclusions and implementation consequences

- **Current menu beats an old example for that account.** Perplexity's September 3 general explainer still gives GPT-5 and Sonnet 4.6 examples. Its more specific September 4 catalog and the inspected menu provide stronger model-inventory evidence. [General explainer](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work).
- **Provider lineage is not a tokenizer mapping.** Perplexity's November 2025 legal page associates Sonar with Llama 3.1 70B. That dated statement does not identify the current Sonar 2 tokenizer, and its broad provider list does not enumerate the current picker. [Third-party models and terms](https://www.perplexity.ai/hub/legal/third-party-models).
- **Claude summarization cost wording conflicts.** The July 13 limits article says longer chats triggering context management consume more usage; the paid-context article says automatic management does not count toward usage. These could distinguish continued-chat cost from the summarization operation, but the pages do not settle that interpretation. Neither establishes physical energy or full retained context.
- **Historical ChatGPT models are not active inventory.** Release notes record removal of GPT-4.5 on June 26 and GPT-5.2 on June 12, announce o3 retirement for August 26 and the official DALL·E GPT retirement for August 30. The observed current text menu is recorded separately. [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes).
- **API and agent catalogs are separate.** Terra in Perplexity, Terra in Codex, a Mythos trusted-access program or an agent's hidden submodel does not imply the same choice exists in a standard ChatGPT or Claude.ai conversation.
- **Calibration remains separate.** All catalog entries have `energy_profile_status: "not_calibrated"`. No entry is promoted to a validated tokenizer because its name appears in a menu. Context capacities are scoped documentation values, not live context meters or production guidance budgets.

Preserve raw observed labels, account type, surface, mode, observation date and source revision when adapting these records. Resolve the model that actually answered each attempt when evidence supports it. A changing router, an unknown model or a conflicting version remains explicit uncertainty under the [data contracts](CONTRACTS.md) and [context guidance](CONTEXT-GUIDANCE.md).

The JSON source ledger contains all primary links, their visible dates or lack of dates, and the access date. Public-source entries supplement the inspected menu inventory; they are not a promise that every listed option is enabled for any one account.

