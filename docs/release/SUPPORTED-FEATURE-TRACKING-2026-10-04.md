# Supported feature tracking, 4 October 2026

The owner asked on 30 September 2026 that every supported feature be tracked and calculated without tracking problems, and decided the open questions on 2, 3 and 4 October 2026. This record lists what changed, how it was verified and what still needs the owner's native check after reloading the extension. Claude and Perplexity had priority.

Evidence about provider pages comes from the audit of 30 September 2026 and structural checks on 1 and 3 October 2026: structure, counts, lengths and model labels only, never message text. Raw captures were not kept. Tests use synthetic fixtures built from that structure.

## What changed

| Area | Change | Commits |
| --- | --- | --- |
| Contracts | Schema 3.0.0: output parts, generation components (text by other models, generated media), estimate components with the basis of each model selection; NotebookLM as a site; browser database version 17 with one local reset from before version 16. | 0932ad3, 1c2ecee |
| Estimates | Composite output total; image, speech, video and NotebookLM Video Overview methods with their data in `config/estimation.media.json`; uploaded image tokens by vendor rules; totals grouped by how figures were estimated rather than by model. | 0932ad3, c4974c8, f22c7b9 |
| Models | Label tables for every audited label, family benchmarks for unnamed and unlisted models, unknown labels kept in the browser and named only in Details. | e06335b |
| Details | How each part was estimated, what is not included, and a Partly measured paragraph in Details only. The original method's archived image benchmark is listed only where not every image of a reply is estimated, and it describes the benchmark, not the reply. | 9f848d7, d9e2884, 715caf2, cd1827d, b9f6de7 |
| Claude | Tool input and results, thinking or its summaries, every stop reason, retracted blocks, model fallbacks, Research briefs and search queries, AI artifact runs with exact usage, compaction summaries. | 475ed57, 5cf5dd3 |
| Claude Cowork | Results counted from Claude's own usage report, including side calls and exact reasoning, when a session is opened in this browser. | a455173, a6ea8f6, 24e88ec |
| ChatGPT | Commentary, tool input, turn plans, thoughts, several finals, Deep Research plans and reports, voice transcripts, read aloud, image turns, project and GPT chats. | 829108b, afe35ad, 70bdd29 |
| Perplexity | Both answer formats, search queries, video prompts and videos, display models, reply ids that link follow-ups. | 0033a4e, c285d08, 70bdd29 |
| Gemini | Secondary accounts and Gems, thoughts, Canvas, Deep Research, images, videos with storyboards; cancelled and stopped replies without false problems. | 4791859, 0d72545 |
| NotebookLM | Chats sent in this browser, notebook guides and Studio items. | d23e586, 96f90de, da867d1 |
| Resilience | Captures end after 5 minutes without data or 60 minutes in total, slots are released, end frames are never lost, bursts are delayed rather than dropped, unknown stream content makes a reply partly measured instead of a tracking problem. In company mode, a reply's upload still runs when the shared read after it goes stale. | 23a8b64, 8767926, 6002301 |
| Organization totals | One count per prompt or reply across members (company keys), with the restore gate checking the election page by page. | ab763fd, 50917ea, c965fc1 |
| Live fixes, 5 October | Perplexity replies update the bar live on the open thread (new threads, follow-ups, in-page moves and worker restarts); ChatGPT images made by a background job join their saved copy; ChatGPT Work chats confirm their first request; organization figures are read again when the local calculation changes before the display. | c302be5, 14c9580, df03f30, fc8b0bd, ae19f21, fbaef83, 951b66f, 38130a2, da5c94b |
| Documentation | Methodology section, changelog, configuration and privacy notes, release guide (provider drift check), bar message catalog. | 90fe20e, a1d0ee5 |

## Verification

- Automated suites on the final code (commit ae19f21; only the extension changed after fc8b0bd and was run again): contracts 46, ledger 238, estimator 133, tokenizers 13, capture-core 19, UI 13, adapters 167, file text 13, EcoLogits core 20, extension 1,211 (1 skipped), verification 16, documentation 105, refinement 8, website 50 (1 skipped: symbolic links need a Windows privilege) and Python 830 (22 skipped: the PostgreSQL variants, run separately below), all passed; every TypeScript check and Ruff are clean. The release tools, calibration and privacy suites were last run at a1d0ee5 (release tools 8, 12 and 3 with 1 skipped, calibration 11, privacy 25 and the privacy scan, all passed). The three EcoLogits maintenance tests that failed for older reasons were fixed on 5 October (518eabe).
- PostgreSQL 17.11: migrations 0001 to 0012 (down to 0011 and up again) and the company deduplication and concurrency tests passed in a throwaway container on a separate test server, with synthetic data only; at the final server code (c965fc1) all 23 PostgreSQL tests passed. The container, its image and its files were removed afterwards.
- Independent review: Codex (`gpt-5.6-sol`) reviewed every workstream and the review fixes, in 24 rounds up to 5 October 2026, ending with the final commits (df03f30, fbaef83, fc8b0bd and ae19f21). Each finding was checked in the code. Accepted findings were fixed with tests that fail without the fix; rejected findings were recorded with their reasons.
- Mutation checks: restoring an old or wrong behavior on its own makes its new test fail, for example for 34 company deduplication rules, 10 resilience rules and each review fix. For the fixes of 5 October, 23 of 26 mutations were caught; the other 3 change no state the code can reach.
- Builds: Chrome, Edge and Firefox were built on 5 October 2026 from a1d0ee5 and again from ae19f21. Compared with the build before a1d0ee5, the manifests add only `https://notebook.google.com/*` (host permission, content scripts and web-accessible resources), and the extension database moves from version 15 to 17.
- Native check: done in Chrome on 5 October 2026 for the paths listed in the live check below. Edge and Firefox were not checked natively.

## Live check in Chrome (5 October 2026)

Test messages were sent on the owner's test accounts in Chrome, with a build that also logged the link decisions (yes or no, never text). Figures were read from the bar.

- **Perplexity.** A new thread's first answer and follow-ups update the bar live (sent, generating, completed), including a follow-up sent after moving to another thread inside the page. The bar shows only its figures. On the build without the logging, a follow-up moved the bar from Req 2 to Req 3 within about 4.5 seconds, showed partial output and then the final figures, and a full reload of the thread showed the same totals from saved history. On the final build (ae19f21), a follow-up sent after reaching the thread from the home page inside the page showed Req 4 within a second, then Processing with growing output, then its final figures. A thread whose bar showed Req 2 for one visible question holds two saved requests in Perplexity's own data (a second, 2-character prompt), so the count was right.
- **Claude.** A reply with thinking counts the visible thinking summary and the answer: 12 + 63 = 75 output tokens, the bundled tokenizer's count of both texts. A reply stopped during thinking adds its summary and shows no problem. A web search counts the search tool input and both summaries as output; the results carried titles and links only, so nothing was added to input (decision of 2 October).
- **ChatGPT.** A text reply, an image in a new chat (Req 1 without ≈, image estimated) read aloud (speech added to Electricity, Req unchanged) a chat in a project and a chat with one of OpenAI's public GPTs, both approved by the owner (each counted live, with the same totals after a reload; a GPT's hidden instructions are not counted, by decision). A Work chat showed Partially loaded although its history was complete; fixed (see the changelog) and rechecked on the final build. A chat whose four images were sent with test builds from before the final image fix shows Req with ≈: Details lists those four saved image replies as having no verified link to live records. They are counted once, from the saved chat (about 3.5 Wh each, as in a new chat), and their live records hold no image, so nothing is counted twice. A further image sent in that chat with the final build joined its live record (matched messages rose from 6 to 8, unverified stayed at 4).
- **Gemini.** A reply on `/u/0/` and a reply stopped after about 3 seconds: the stopped reply ends as completed (Gemini sends no stop signal), shows no problem and counts the text it produced.
- **NotebookLM.** A chat sent in this browser counts live with its question and answer. Saved chats are not imported (decision).
- Not checked live: Edge and Firefox, and the items in point 12 below.

## Further live checks and fixes (5 October 2026)

A second round in Chrome on the owner's test accounts, after the local records were erased, covered every feature in points 3 to 8 below that the accounts offer. Each check and how each site sends and saves its data is written up in `docs/implementation/TRACKING-HANDOVER-2026-10-05.md`, which must be read before any change to tracking.

Checked and correct: ChatGPT thinking (only the saved answer counts, as the account saves a reasoning recap without thoughts) and Deep Research (plan and report counted, the research time used for timing); Claude Research (brief, summary and report); a Gemini Gem chat, Gemini thinking, image, Canvas and video on a secondary account (`/u/3/`); NotebookLM chat and opened quiz, flashcards and mind map items.

Found and fixed (each with a test that fails without the fix):

- **ChatGPT.** A long chat stayed Partially loaded after scrolling to the top, because the earlier page the site reads was not recognised (c4e5f6b).
- **NotebookLM.** Opened quiz, flashcards and mind map items were not counted, because the item read now carries an options list (c4e5f6b).
- **Gemini.** A video turn counted twice: the live reply carries the chat mode's label and the saved turn the video model's label, which blocked the link. Saved Gemini replies now link by reply id alone, also for a failed video job (f8c8ea7, 7f0ebe1).
- **History coverage.** A read that proved the chat's first request was lost when it committed after a newer read (8462ae1, from the Codex review).
- **Perplexity.** A generated image was estimated as a video (about 14 Wh instead of about 3.5 Wh), and a saved reply with an image but no answer text kept no image (fb79ef2).
- **Gemini Deep Research.** The thoughts the run's thinking panel shows were never counted, although the saved run holds them (f6a6859).
- **Claude Research.** The report's citation records (ids, titles and links attached by the page) counted as output, about doubling the reply's output tokens (6b36117).

The builds in `apps/extension/.output` include all of these. The Perplexity image and Claude Research fixes lower counts, and the stored records of a chat keep their higher figures when it is read again (a stale page must never shrink a count), so the two test chats still showed their old figures after a reload. After erasing all local records both were rechecked live on the build at 2284783: the image reply showed 3.62 Wh instead of 14 Wh, and the Research reply 11,242 output tokens instead of 20,414 (the rest is the research agents' own queries, links, briefs, findings and draft, which count). A Gemini Deep Research run (sent again by the owner after the first stayed "Researching" on Google's side) counts its plan and, once the chat is read again, its report; its visible research thoughts were not counted and now are (f6a6859): 3,085 output tokens instead of 1,667, the same after a second reload.

## Needs the owner's native check

Reload the extension (Chrome: `apps/extension/.output/chrome-mv3`) and check, without sending anything on the owner's behalf:

1. **First load.** The build loaded until now uses database version 15, so the new build clears the local records once (owner decision of 2 October 2026). Settings, the organization connection, engine and guidance preferences and deletion markers stay. Reopened chats import their history again with the new method. Check that the bar appears on each site and that no "!" badge or Tracking problem shows on an idle page.
2. **NotebookLM site access.** `notebook.google.com` is a new host. If Chrome's site access for the extension is limited, allow it there. Open a notebook: the bar appears below the chat box.
3. **Claude.** A reply with extended thinking, one with web search or Research, an AI artifact that calls Claude, and a reply stopped during thinking. Expected: figures without Tracking problem; Details lists thinking or its summary, tool input and results, search queries or the research brief, and exact usage for the artifact run.
4. **Claude Cowork.** Open a Cowork session in this browser, including one with more than 100 events. Expected: results counted from Claude's usage report with side calls; older pages of a long session are the unverified path.
5. **Perplexity.** Load an existing thread with a full page load, send a follow-up, and (if offered) a Computer task with files and a video. Expected: both answer formats counted, the follow-up linked to the reply it follows, search queries in Details, the model from the menu named in Details.
6. **ChatGPT.** A thinking reply, Deep Research, an image, read aloud, a voice reply, a project or GPT chat, and the Work composer. Expected: thoughts, plans and reports counted; images estimated; read aloud counted as speech but not as a request; the bar present on Work.
7. **Gemini.** A secondary account (`/u/N/`), a Gem, a thinking reply, Canvas, Deep Research, an image and a video, and a stopped reply. Expected: history imports on the secondary account, images and videos estimated (a video with its storyboard), no Tracking problem for the stopped reply.
8. **NotebookLM.** A chat sent in this browser, the notebook guide and Studio items (report, table, slides, infographic, flashcards, quiz, mind map, Audio and Video Overview). Expected: each counted when the notebook shows it; saved chats are not imported (decision). The chat request layout and the flashcard and mind map layouts are the unverified paths.
9. **Bar and Details.** The bar keeps only figures, units, approximate markers and Details. Partly measured appears only in Details; a genuine error shows as a small label with its reason on hover.
10. **Edge and Firefox.** The same checks in `apps/extension/.output/edge-mv3` and `apps/extension/.output/firefox-mv2`; neither has been checked natively for this work.
11. **Organization mode.** Only with a server at migration 0012 (none is deployed): after the next token refresh, a chat that two members see counts once in organization totals.
12. **Not covered yet.** claude.ai voice mode (postponed by the owner), Gemini read aloud (not tested), ChatGPT agent mode (not offered on the test account), a Claude AI artifact run, a Cowork session with more than 100 events, a Perplexity Computer task with files and a video, and NotebookLM paid Studio items (infographic, slides, Audio and Video Overview).

## Not counted by decision

Hidden reasoning and input, side calls on chat sites, the hidden work of research agents, NotebookLM Overview scripts, saved NotebookLM chats, Cowork sessions never opened in this browser, history a page never loads, music generation and activity outside the supported websites. Details lists what applies to each conversation.
