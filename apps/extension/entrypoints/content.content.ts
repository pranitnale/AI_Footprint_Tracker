import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import {
  isCoworkSessionId,
  isDisplayBinding,
  isConversationIdentity,
  isProvisionalChatgptRoute,
  isUnsavedChatgptRoute,
  matchesDisplayContext,
  parseConversationRoute,
  siteForHost,
  type DisplayBinding,
  type ConversationIdentity,
} from "@footprint/capture-core";
import {
  perplexityThreadRoute,
  validateThreadHistory,
  type ThreadHistoryMessage,
} from "@footprint/adapters";
import {
  parseDisplayScenario,
  readDisplayScenario,
  scenarioValue,
  type DisplayScenario,
} from "../lib/display-scenario";
import {
  computerFileLines,
  noteComputerFiles,
  savedComputerFiles,
  type ComputerFileFact,
} from "../lib/computer-file-details";
import {
  CaptureWatchdog,
  isPlainSendKey,
  validateCaptureReady,
  validateCoworkSent,
} from "../lib/capture-watchdog";
import {
  formatDateTime,
  formatInteger,
  formatMetric,
} from "@footprint/ui/formatters";
import { presentFileTextSummary } from "@footprint/ui/file-text";
import {
  attachmentNote,
  conversationBar,
  countSourceNote,
  coverageNotes,
  detailsPanelPlacement,
  estimateDetailLines,
  pageHealthCode,
  pageHealthMessage,
  pageHealthSummary,
  partlyMeasuredText,
  serverResourceText,
  serverTokenFigure,
  serverTokenTotal,
  serverWaterText,
  TOKEN_LABELS,
  tokenTotalText,
  type PageHealthCode,
  type TokenTotalKey,
  type PageHealthIssue,
  setBarStatus,
  trackingProblemAction,
  barStateText,
  BAR_NO_FIGURES,
  BAR_SET_UP,
  BAR_TRACKING_OFF,
  notebookGuideOnly,
  type BarActivity,
} from "../lib/conversation-bar";
import {
  presentHistoryView,
  combinedUsage,
  methodReleasesNote,
  noFiguresNote,
  notebookChatProblemNote,
  notebookChatRead,
  selectedHistory,
  HISTORY_LOADING_HINT,
} from "../lib/history-presentation";
import {
  CAPTURE_FAILURE_REASONS,
  CAPTURE_SILENT_MS,
  sideCapture,
  validateCapture,
  type CaptureMessage,
} from "../lib/bridge";
import {
  HISTORY_RESET_CHANNEL,
  NOTEBOOKLM_CHAT_PROBLEMS,
  notebooklmRows,
  validateHistoryCapture,
  validateHistoryDiagnostic,
  type HistoryCaptureMessage,
  type HistoryDiagnostic,
  type NotebooklmChatProblem,
} from "../lib/history-capture";
import {
  validateClaudeStreamCapture,
  type ClaudeStreamCapture,
} from "../lib/claude-history-message";
import {
  validateProviderStreamCapture,
  type ProviderStreamCapture,
} from "../lib/provider-history-message";
import {
  composerEditorSelector,
  composerPageReady,
  isComposerSendButton,
  placeFootprintHosts,
  resolveComposer,
} from "../lib/content-placement";
import {
  hasPendingConversation,
  localConversationPresentation,
  preferSyncedFigures,
  tokenPairText,
} from "../lib/conversation-display";
import { HISTORY_LIMITS } from "../lib/history-limits";
import { FileOfferBridge } from "../lib/file-offer-bridge";
import {
  FILE_RELAY_PATH,
  validUploadAssociation,
} from "../lib/file-relay-protocol";
import {
  comparisonLine,
  comparisonNodes,
  smallerModelCard,
  smallerModelNodes,
  countedDots,
  countedNodes,
  countedParts,
  countedSummary,
  DETAILS_STYLES,
  detailsModels,
  detailsStatusGroups,
  detailsSyncState,
  disclosure,
  notCountedHeading,
  notCountedNodes,
  syncNodes,
  estimatedNodes,
  estimatedSummary,
  headerLine,
  icon as detailsIcon,
  overviewNodes,
  requestComparison,
  serverFigure,
  statusNodes,
  stoppedRepliesStatus,
  trackingPausedStatus,
  ownReadOffStatus,
  progressText,
  type ComparisonState,
  type DetailsFigure,
  type DetailsInput,
} from "../lib/details-overview";
import {
  OPEN_SETTINGS_TARGET,
  OWN_READ_SETTING_CHANGED,
  OWN_READ_SETTING_TARGET,
  createOwnReadScheduler,
  isOwnReadSite,
  ownReadMainSwitchOff,
  ownReadSettingAnswer,
  type OwnReadMode,
} from "../lib/own-read";
import { ownReadSharedPause } from "../lib/own-read-pause";
import {
  CAPTURE_RETRY_DELAYS_MS,
  captureAnswer,
  captureSendThrew,
  type CaptureAnswer,
} from "../lib/capture-delivery";
import {
  chatgptPagesToday,
  chatgptProgressAfter,
  chatgptResume,
  validChatgptReadProgress,
  validChatgptReadReport,
  type ChatgptReadProgress,
} from "../lib/chatgpt-read-progress";
import {
  OPEN_WELCOME_TARGET,
  TRACKING_STATE_CHANGED,
  TRACKING_STATE_TARGET,
  localDetailsText,
  trackingStateAnswer,
} from "../lib/tracking-consent";
import {
  longChatTipReason,
  longChatTipText,
  parseLongChatTipState,
  tipOpen,
  type LongChatTipAction,
  type LongChatTipState,
} from "../lib/long-chat-tip";

export default defineContentScript({
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://www.perplexity.ai/*",
    "https://perplexity.ai/*",
    "https://notebook.google.com/*",
  ],
  runAt: "document_start",
  main(ctx) {
    const site = siteForHost(location.hostname);
    if (!site) return;
    let root: HTMLDivElement | null = null;
    /** The start-up wait (bootTimer) ended; the bar no longer waits for the page's setup. */
    let startupWaitOver = false;
    // Details opens over the composer, whose own layers share the bar's stacking context
    // (ChatGPT's composer, Perplexity's z-index 30 home composer; 12 October 2026). The bar
    // rises above them only while Details is open, so menus that open over it stay on top.
    const stackDetails = (open: boolean) => {
      const layer = open ? "2147483000" : "1";
      if (root && root.style.zIndex !== layer) root.style.zIndex = layer;
    };
    let noticeRoot: HTMLDivElement | null = null;
    let shadow: ShadowRoot | null = null;
    let noticeShadow: ShadowRoot | null = null;
    let mountController: AbortController | null = null;
    let schedulePanelPosition: (() => void) | null = null;
    let mountedComposer: {
      editor: Element;
      anchor: Element;
      insertionParent: Element;
    } | null = null;
    const ownedHosts = new WeakSet<Node>();
    // Details sections the person opened stay open while live figures re-render the panel, and
    // close again with Details, so each opening starts with them closed (canvas Details overlay).
    const openSections = new Set<string>();
    let comparison: { path: string; state: ComparisonState } | null = null;
    let latest: any = null;
    // The figures the bar last showed, kept while anything updates (see showFigures).
    let shownFigures: { navigation: string; path: string; text: string } | null =
      null;
    // When each reply's capture ended. Until its figures publish the bar stays on Processing,
    // for at most DISPLAY_WAIT_MS, so a reply whose figures never come ends on No figures yet.
    const captureEnds = new Map<string, number>();
    const DISPLAY_WAIT_MS = 30000;
    // Replies whose final figures arrived: a display after the end, with the estimate
    // published. Later displays of the same reply are corrections and update the bar in place.
    const finishedCaptures = new Set<string>();
    // A send from the composer (a trusted Enter or click). The bar shows Processing from then
    // on, also before the page's request reaches the tracker (on Gemini it arrived about 7 s
    // after sending in a live test of 14 Oct 2026), for at most SEND_WAIT_MS when no request
    // follows.
    let composerSent: { at: number; navigation: string } | null = null;
    const SEND_WAIT_MS = 15000;
    // NotebookLM guides of the open notebook still being written or counted, by capture: until
    // when each waits, CAPTURE_SILENT_MS after its last frame and DISPLAY_WAIT_MS after its end,
    // when the saved totals are read again with it. The bar shows Processing meanwhile, so
    // a guide still being counted never reads as Waiting for your request or No figures yet
    // (owner decision of 16 Oct 2026: the bar shows a guide's figures).
    const guideWaits = new Map<string, { navigation: string; until: number }>();
    // Whether this render asked for the tracker's own read and it is still pending.
    let ownReadAsked = false;
    // The navigation whose shown reply could not be delivered to the background even after
    // its retries (`lostReply`). Its chat is read once from saved history instead.
    let lostReplyNavigation: string | null = null;
    // The navigation in which tracking was turned off while one of its replies was arriving.
    // That reply's later frames go nowhere, so agreeing again in the same navigation reads the
    // chat once (`lostReplyNavigation`). It is decided at the withdrawal: by the time the person
    // agrees again the reply may have been silent for longer than any live capture runs, and
    // then it no longer looked like a reply that was arriving (live QA, 19 Oct 2026).
    let withdrawnReply: string | null = null;
    // The navigation whose lost reply was cut off by turning tracking off. The page's reads of
    // the chat while tracking was off were refused, so they must not stand in for that read.
    let lostReplyUncounted: string | null = null;
    // Renders again when a reply's wait for its figures runs out (see barActivity).
    let barRecheck: { timer: ReturnType<typeof setTimeout>; at: number } | null =
      null;
    const scheduleBarRecheck = (ms: number) => {
      const at = Date.now() + ms;
      if (barRecheck && barRecheck.at <= at) return;
      if (barRecheck) clearTimeout(barRecheck.timer);
      barRecheck = {
        at,
        timer: setTimeout(
          () => {
            barRecheck = null;
            if (!extensionStopped) render();
          },
          Math.min(ms + 1, 2147483647),
        ),
      };
    };
    let latestPath: string | null = null;
    let extensionStopped = false;
    // The person has not agreed to tracking (owner decisions of 17 and 18 Oct 2026,
    // lib/tracking-consent.ts). Set only when the background says so: the bar then shows
    // Tracking is off with Set up, nothing the page world observes is passed on and no own read
    // is made. The background refuses all of it as well, also before this page knows.
    let trackingOff = false;
    // Whether the background has answered the first question about the agreement. Until then
    // the bar row stays hidden: before the agreement its first state must be Tracking is off
    // (owner decision of 18 Oct 2026), and it showed Waiting for your request for a moment
    // before that answer arrived (QA of 19 Oct 2026).
    let trackingStateSettled = false;
    // Tracking is paused and no organization policy requires it (TrackingState.paused), so the
    // background records nothing this page sends. The bar then never shows Processing for a
    // reply or a read that will not be counted (live, 21 Oct 2026): it keeps the chat's earlier
    // figures or shows what a chat with nothing counted shows, and Details says why. Captures are
    // still passed on, as the background decides; resuming restores everything at once.
    let trackingPaused = false;
    // Replies dispatched while paused. Nothing records them, so even after resuming the bar
    // never waits for their figures.
    const pausedCaptures = new Set<string>();
    // The connected organization's name, for the line at the bottom of Details.
    let organizationLabel: string | null = null;
    // Resolved once the background answered whether the person agreed. The own read waits for
    // it, so a page that has not agreed never asks to read a chat, not even to be refused.
    let trackingStateKnown: () => void = () => {};
    const firstTrackingState = new Promise<void>((resolve) => {
      trackingStateKnown = resolve;
    });
    async function sendToBackground(message: any): Promise<any> {
      if (extensionStopped) return undefined;
      try {
        return await browser.runtime.sendMessage(message);
      } catch (error) {
        // Chrome can throw before returning a promise after an extension reload.
        if (String(error).includes("Extension context invalidated")) {
          stopExtension();
          return undefined;
        }
        throw error;
      }
    }
    // The saved range display choice travels with each display. A settings change is sent on
    // its own so an open page follows it without waiting for a new capture.
    let displayScenarioOverride: DisplayScenario | null = null;
    const displayScenario = (): DisplayScenario =>
      readDisplayScenario(displayScenarioOverride ?? latest?.displayScenario);
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    const pageHealth = new Map<string, PageHealthIssue>();
    let lastWindow = 0;
    let messages = 0;
    let lastPath = location.pathname;
    let loadedPath: string | null = null;
    let routeGeneration = 0;
    let routeLoading = false;
    let routeFailure: { message: string; retryable: boolean } | null = null;
    let threadRelationChanged = false;
    let historyFailure = false;
    let historyFailureReason: HistoryDiagnostic["reason"] | null = null;
    const historyTooLarge = () =>
      historyFailureReason === "history_response_limit" ||
      historyFailureReason === "history_text_limit" ||
      historyFailureReason === "history_message_limit";
    let historyFailureGeneration = 0;
    // A page of the notebook's saved chat the page world could not count in this navigation.
    // NotebookLM reads its saved chat once per document, so the next Studio read must not
    // clear the reason; a later chat read that is counted does (14 Oct 2026).
    let notebookChatProblem: NotebooklmChatProblem | null = null;
    // The page read the notebook's saved chat in this navigation. Its turns can take longer
    // than the page world's 30 s page-read window to import, so the tracker's own read must
    // not follow once that import ends (14 Oct 2026: a second chat read on direct loads).
    let notebookChatSeen = false;
    // The page's read of the notebook in this navigation found Studio items or chat turns. A
    // notebook can be empty, so until then its reads and the saved-totals read leave the bar
    // on Waiting for your request (live finding of 14 Oct 2026).
    let notebookContent = false;
    // Files Perplexity Computer created in the open chat, as this navigation's reads saw
    // them, for Details only (14 Oct 2026). Names stay in memory and are never stored.
    const computerFileFacts = new Map<string, ComputerFileFact>();
    let recordedThreadInvalidationToken: object | null = null;
    let siteAccess = true;
    let latestSource: "active" | "route" | null = null;
    let latestRouteBinding: DisplayBinding | null = null;
    let latestRouteSelectedCaptureId: string | null = null;
    let displayGeneration = 0;
    let scopeGeneration = 0;
    const documentNonce = crypto.randomUUID();
    let navigationNonce = crypto.randomUUID();
    // ChatGPT used without an account keeps a chat at /uc/<id> but never saves it: reloading
    // the address opens an empty chat at / (live, 20 Oct 2026). Its messages count only when
    // this page saw them live, so the page remembers which signed-out chats it saw start:
    // sends of a new chat (they name no chat yet), and the chats their replies named.
    const unsavedChatgptRoute = (path: string) =>
      site === "chatgpt" && isUnsavedChatgptRoute(path);
    // Listed in Details only, under "Not everything could be counted" (details-overview.ts).
    const UNSAVED_EARLIER = "Earlier messages not saved";
    const newChatCaptures = new Set<string>();
    const unsavedChatsSeen = new Set<string>();
    // Whether the open signed-out chat had messages before this page started counting it.
    const unsavedEarlierMissed = () => {
      if (!unsavedChatgptRoute(location.pathname)) return false;
      const route = parseConversationRoute(site, location.pathname);
      if (!route || unsavedChatsSeen.has(route.conversationId)) return false;
      return ![selectedCaptureId, pendingPromotion()?.binding.captureId].some(
        (captureId) => !!captureId && newChatCaptures.has(captureId),
      );
    };
    // Whether earlier messages for this navigation can still arrive. A provider read
    // binds within milliseconds of the route change; with no read after the grace
    // period, the provider reused its cached chat and only a reload can count it.
    let earlierImport: "none" | "running" | "done" = "none";
    // When a read of this navigation's chat was last counted, for the own read's note.
    let earlierImportAt: number | null = null;
    let earlierGraceTimer: ReturnType<typeof setTimeout> | null = null;
    const clearEarlierGrace = () => {
      if (earlierGraceTimer) clearTimeout(earlierGraceTimer);
      earlierGraceTimer = null;
    };
    const startEarlierGrace = (ms: number) => {
      clearEarlierGrace();
      earlierImport = "none";
      earlierImportAt = null;
      // A signed-out ChatGPT chat is never saved, so no read of it can come (20 Oct 2026).
      if (unsavedChatgptRoute(location.pathname)) return;
      const nonce = navigationNonce;
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (earlierGraceTimer !== timer) return;
        earlierGraceTimer = null;
        if (!extensionStopped && siteAccess && nonce === navigationNonce)
          render();
      }, ms);
      earlierGraceTimer = timer;
    };
    // A site can show a chat without reading it again (claude.ai's cache, for example). Only
    // then, once per navigation, the page world reads that chat itself (owner decisions of
    // 13 and 14 Oct 2026, lib/own-read.ts). A 429 or 5xx pause is shared with the site's
    // other tabs through the background (lib/own-read-pause.ts). Each read first asks the
    // background whether "Load full chat history" is on for the site (owner decision of 17 Oct
    // 2026, lib/own-read-settings.ts); an unreadable answer sends nothing.
    // Per switch: the last answer said the main switch is off, so Details points to it.
    const ownReadMainOff = new Map<string, boolean>();
    const ownRead = isOwnReadSite(site)
      ? createOwnReadScheduler({
          site,
          window,
          document,
          sharedPause: ownReadSharedPause(site, sendToBackground),
          allowed: async (key) => {
            await firstTrackingState;
            if (trackingOff) return false;
            const answer = await sendToBackground({
              target: OWN_READ_SETTING_TARGET,
              key,
            });
            ownReadMainOff.set(key, ownReadMainSwitchOff(answer));
            return ownReadSettingAnswer(answer);
          },
        })
      : null;
    // Whether this render asked for the tracker's own read at all, so Details names a read the
    // setting held only while the chat still needs it.
    let ownReadWanted = false;
    const openSettings = () => {
      void sendToBackground({ target: OPEN_SETTINGS_TARGET }).catch(() => {});
    };
    // The page's own read of this chat reached the history reader and was not counted. On
    // NotebookLM the tracker's read is of the saved chat only, so only a chat page that was
    // not counted asks for it: a passed-by Studio read made it read a chat the page had just
    // read, a second request for the same chat (14 Oct 2026). A chat over the history limits
    // would be refused again.
    const pageReadRefused = () =>
      site === "notebooklm"
        ? notebookChatProblem !== null
        : historyFailure && !historyTooLarge();
    // Closed or snoozed long-chat tips (16 Oct 2026, lib/long-chat-tip-store.ts). The
    // background keeps them per chat; this page asks once per chat and hides the tip until
    // the answer arrives, so a closed tip does not flash on reload. A chat without an address
    // yet keeps its closed tip for this page only.
    const tipStates = new Map<string, LongChatTipState | "loading">();
    const tipChat = () => {
      const identity = latest?.conversationIdentity;
      const conversationId =
        identity?.site === site && typeof identity.conversationId === "string"
          ? identity.conversationId
          : parseConversationRoute(site, location.pathname)?.conversationId;
      return conversationId
        ? { key: conversationId, conversationId }
        : { key: `page:${location.pathname}`, conversationId: null };
    };
    const tipState = (): LongChatTipState | null => {
      const chat = tipChat();
      const known = tipStates.get(chat.key);
      if (known === "loading") return null;
      if (known) return known;
      if (!chat.conversationId) return { closed: false, snoozedUntil: null };
      tipStates.set(chat.key, "loading");
      void sendToBackground({
        target: "long-chat-tip",
        conversationId: chat.conversationId,
      })
        .catch(() => null)
        .then((reply) => {
          if (tipStates.get(chat.key) !== "loading") return;
          // A failed read shows the tip rather than hiding it for good.
          tipStates.set(
            chat.key,
            parseLongChatTipState(reply) ?? { closed: false, snoozedUntil: null },
          );
          render();
        });
      return null;
    };
    const changeTip = (action: LongChatTipAction) => {
      const chat = tipChat();
      const known = tipStates.get(chat.key);
      const before =
        known && known !== "loading" ? known : { closed: false, snoozedUntil: null };
      tipStates.set(
        chat.key,
        action === "close"
          ? { ...before, closed: true }
          : { ...before, snoozedUntil: Date.now() + 86_400_000 },
      );
      if (chat.conversationId)
        void sendToBackground({
          target: "long-chat-tip",
          conversationId: chat.conversationId,
          action,
        }).catch(() => {});
    };
    // ChatGPT's own read continues below the oldest page an earlier opening read (14 Oct
    // 2026, lib/chatgpt-read-progress.ts). The background keeps that point per chat; it is
    // read once per navigation and kept after each page the read reports.
    let chatgptProgress: {
      navigation: string;
      conversationId: string;
      loaded: boolean;
      progress: ChatgptReadProgress | null;
      /** Only a read that started from the loaded progress may replace it. */
      tracked: boolean;
      /** Pages read today before the running read started. */
      usedBefore: number;
    } | null = null;
    const loadChatgptProgress = () => {
      if (site !== "chatgpt" || extensionStopped || !siteAccess) return;
      // A signed-out chat is never read, so it has no read progress.
      if (unsavedChatgptRoute(location.pathname)) return;
      const conversationId = parseConversationRoute(site, location.pathname)?.conversationId;
      if (
        !conversationId ||
        (chatgptProgress?.navigation === navigationNonce &&
          chatgptProgress.conversationId === conversationId)
      )
        return;
      const current: NonNullable<typeof chatgptProgress> = {
        navigation: navigationNonce,
        conversationId,
        loaded: false,
        progress: null,
        tracked: false,
        usedBefore: 0,
      };
      chatgptProgress = current;
      // A failed read leaves the progress unloaded, so a read then never replaces it.
      void sendToBackground({ target: "chatgpt-read-progress", conversationId }).then(
        (value) => {
          if (chatgptProgress !== current) return;
          current.progress = validChatgptReadProgress(value) ? value : null;
          current.loaded = true;
        },
        () => {},
      );
    };
    const chatgptReadResume = (nonce: string) => {
      const current = chatgptProgress;
      if (!current || current.navigation !== nonce) return null;
      current.tracked = current.loaded;
      if (!current.loaded) return null;
      const now = Date.now();
      current.usedBefore = chatgptPagesToday(current.progress, now);
      return chatgptResume(current.progress, now);
    };
    const chatgptReadReported = (nonce: string, value: unknown) => {
      const current = chatgptProgress;
      if (
        !current ||
        current.navigation !== nonce ||
        !current.tracked ||
        !validChatgptReadReport(value)
      )
        return;
      const next = chatgptProgressAfter(value, current.usedBefore, Date.now());
      current.progress = next;
      void sendToBackground({
        target: "chatgpt-read-progress",
        conversationId: current.conversationId,
        progress: next,
      }).catch(() => {});
    };
    // Why the read is asked for: "missing", no read of the chat arrived; "after_import", some
    // of the chat loaded (ChatGPT's newest turns, a notebook's Studio items), so the read
    // waits for the page's own import to end; "rejected", the history reader refused the
    // page's read (owner decision of 14 Oct 2026); "lost_reply", a live reply's frames could not
    // be delivered to the background (16 Oct 2026), so only the saved chat can count it.
    const requestOwnRead = (mode: OwnReadMode = "missing") => {
      if (!ownRead || extensionStopped || !siteAccess) return false;
      // A signed-out ChatGPT chat is never saved, so there is nothing to read.
      if (unsavedChatgptRoute(location.pathname)) return false;
      ownReadWanted = true;
      const nonce = navigationNonce;
      loadChatgptProgress();
      const pending = ownRead.request({
        navigation: nonce,
        pathname: location.pathname,
        mode,
        rejected: mode === "rejected",
        uncounted: mode === "lost_reply" && lostReplyUncounted === nonce,
        ...(site === "chatgpt"
          ? {
              resume: () => chatgptReadResume(nonce),
              resumed: (value: unknown) => chatgptReadReported(nonce, value),
            }
          : {}),
        stillNeeded: () =>
          nonce === navigationNonce &&
          (mode === "missing"
            ? earlierImport === "none"
            : mode === "after_import"
              ? earlierImport !== "running"
              : // For a lost reply, a page read of this chat meanwhile is noticed by the
                // page world, which then skips or stops the read itself.
                mode === "lost_reply" ||
                (site === "notebooklm"
                  ? notebookChatProblem !== null
                  : historyFailure)) &&
          siteAccess &&
          !extensionStopped,
        changed: () => {
          if (nonce === navigationNonce && !extensionStopped) render();
        },
      });
      // Only render asks for the read, and asks again on every render while it is needed, so
      // the bar's Processing follows the read without a copy of its state here.
      if (pending) ownReadAsked = true;
      return pending;
    };
    // A notebook may hold no chat and no Studio item at all, so an empty notebook is not a
    // sign that its saved chat was not loaded; its saved chat counts whenever the page
    // reads it (14 Oct 2026).
    const earlierHistoryState = ():
      | "loading"
      | "not_loaded"
      | "unsaved"
      | null =>
      site === "notebooklm"
        ? null
        : // Nothing can load a signed-out chat's earlier messages, so it never waits for them.
          unsavedChatgptRoute(location.pathname)
          ? unsavedEarlierMissed()
            ? "unsaved"
            : null
          : routeLoading ||
            earlierImport === "running" ||
            (earlierImport === "none" && earlierGraceTimer !== null)
          ? "loading"
          : earlierImport === "none"
            ? requestOwnRead()
              ? "loading"
              : "not_loaded"
            : null;
    // A fallback in case the publication notice is missed: at most three reads per navigation.
    let calculationCheck: {
      nonce: string;
      tries: number;
      timer: ReturnType<typeof setTimeout> | null;
    } | null = null;
    // A new observation waits a moment for the selected method's recalculation. Until
    // it is ready, the bar keeps the last complete whole-chat figures with Updating
    // instead of briefly showing figures for this page only.
    const HOLD_MS = 15000;
    let heldDisplay: {
      display: any;
      path: string;
      navigationNonce: string;
      scopeGeneration: number;
    } | null = null;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      heldDisplay = null;
    };
    // An import can finish while the first saved-totals read is still running. That
    // read still renders; the one refresh it needs runs after it settles.
    let routeRefreshAfter: number | null = null;
    let routeReadGeneration: number | null = null;
    const scheduleCalculationCheck = () => {
      const same = calculationCheck?.nonce === navigationNonce;
      if (same && (calculationCheck!.timer || calculationCheck!.tries >= 3))
        return;
      const tries = same ? calculationCheck!.tries : 0;
      const nonce = navigationNonce;
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        () => {
          if (calculationCheck?.timer !== timer) return;
          calculationCheck.timer = null;
          if (extensionStopped || !siteAccess || nonce !== navigationNonce)
            return;
          loadedPath = null;
          void loadRecordedRoute(true);
        },
        10000 * (tries + 1),
      );
      calculationCheck = { nonce, tries: tries + 1, timer };
    };
    const siteName = () =>
      site === "chatgpt"
        ? "ChatGPT"
        : site === "claude"
          ? "Claude"
          : site === "gemini"
            ? "Gemini"
            : site === "notebooklm"
              ? "NotebookLM"
              : "Perplexity";
    let selectedCaptureId: string | null = null;
    const captureBindings = new Map<string, DisplayBinding>();
    const captureIdentities = new Map<
      string,
      {
        binding: DisplayBinding;
        identity: ConversationIdentity | null;
        scopeGeneration: number;
      }
    >();
    let pendingCapturePromotion: {
      binding: DisplayBinding;
      identity: ConversationIdentity | null;
      display: any;
      scopeGeneration: number;
      expires: number;
      /** Kept across ChatGPT's move from its provisional new-chat address to the chat. */
      awaitsNewChat?: true;
    } | null = null;
    // Since October 2026 a new ChatGPT chat opens at /c/local-chatgpt:<id> and moves to
    // /c/<uuid> before the reply's first frame names the chat (seen live 12 Oct 2026).
    const provisionalChatgptRoute = (path: string) =>
      site === "chatgpt" && isProvisionalChatgptRoute(path);
    const pendingPromotion = () => {
      if (
        pendingCapturePromotion &&
        (pendingCapturePromotion.expires <= Date.now() ||
          pendingCapturePromotion.scopeGeneration !== scopeGeneration ||
          pendingCapturePromotion.binding.documentNonce !== documentNonce)
      )
        pendingCapturePromotion = null;
      return pendingCapturePromotion;
    };
    const captureCommits = new Map<string, Promise<boolean>>();
    /**
     * Captures still running, with the time of their last frame. A capture whose end never
     * came stops counting once it has been silent longer than any live capture can be
     * (X10), so its binding can be reused.
     */
    const activeCaptureIds = new Map<string, number>();
    /** Progress frames over the rate limit, the newest per capture (X10). */
    const heldProgress = new Map<
      string,
      { data: CaptureMessage; sequence: number }
    >();
    let heldTimer: ReturnType<typeof setTimeout> | null = null;
    // Read aloud speaks a reply the bar already shows, so it never becomes the selected
    // capture (G1). Its saved speech updates the totals shown instead.
    const readAloudIds = new Set<string>();
    type HistoryObservation = {
      at: string;
      binding: DisplayBinding;
      path: string;
      scopeGeneration: number;
      selectedCaptureId: string | null;
      threadId: string;
      pageAccepted: boolean;
      pageDisplayGeneration: number | null;
      timer: ReturnType<typeof setTimeout> | null;
      chain: Promise<unknown>;
    };
    const historyBindings = new Map<string, HistoryObservation>();
    const physicalHistoryCalls = new Set<object>();
    const historyStarts: number[] = [];
    const historySeen = new Map<string, number>();
    type HistoricalObservation = {
      binding: DisplayBinding;
      conversationId: string;
      observedAt: string;
      pageAccepted: boolean;
      path: string;
      scopeGeneration: number;
      selectedCaptureId: string | null;
      failureGeneration: number;
      failureReported: boolean;
      timer: ReturnType<typeof setTimeout> | null;
      chain: Promise<unknown>;
      /** The read sent turns of a notebook's saved chat. */
      notebookChat?: boolean;
    };
    const historicalBindings = new Map<string, HistoricalObservation>();
    // Reads waiting for an import slot (waitForHistoricalSlot), with their later messages.
    const waitingHistorical = new Map<
      string,
      { later: Array<() => void>; timer: ReturnType<typeof setTimeout> | null }
    >();
    // About 6 s in all, well inside the page world's 30 s wait for each reply.
    const HISTORICAL_SLOT_WAITS = [200, 400, 800, 1600, 3200];
    const physicalHistoricalCalls = new Set<object>();
    const historicalStarts: number[] = [];
    const historicalSeen = new Map<string, number>();
    const displayContext = () => ({
      documentNonce,
      navigationNonce,
      selectedCaptureId,
      route: parseConversationRoute(site, location.pathname),
    });
    const watchdog = new CaptureWatchdog(Date.now());
    const probeNonce = crypto.randomUUID();
    let trackingEnabled = false;
    let diagnosticActivity = false;
    let diagnosticScan = 0;
    const controller = new AbortController();
    const signal = controller.signal;
    // Capture frames in arrival order. A capture problem clears only when a frame that
    // arrived after it was raised is saved in full, so a late reply about an older frame
    // cannot hide a newer failure.
    let captureSequence = 0;
    const captureRaisedAt = new Map<string, number>();
    const recordPageHealth = (
      value: unknown,
      active: boolean,
      context: PageHealthIssue["context"] = "capture",
    ) => {
      if (extensionStopped) return;
      const code =
        value === "site_access_removed" ||
        value === "conversation_summary_unavailable"
          ? value
          : pageHealthCode(value);
      const now = Date.now();
      const key = `${context}:${code}`;
      if (context === "capture") captureRaisedAt.set(key, captureSequence);
      const previous = pageHealth.get(key);
      pageHealth.set(key, {
        code,
        context,
        firstAt: previous?.firstAt ?? now,
        lastAt: now,
        count: (previous?.count ?? 0) + 1,
        active,
      });
      render();
    };
    const recoverPageHealth = (
      context: PageHealthIssue["context"],
      ...codes: PageHealthCode[]
    ) => {
      if (extensionStopped) return;
      let changed = false;
      for (const code of codes) {
        const key = `${context}:${code}`;
        const issue = pageHealth.get(key);
        if (issue?.active) {
          pageHealth.set(key, { ...issue, active: false });
          changed = true;
        }
      }
      if (changed) render();
    };
    const recoverPageHealthContext = (context: PageHealthIssue["context"]) => {
      if (extensionStopped) return;
      let changed = false;
      for (const [key, issue] of pageHealth) {
        if (issue.context === context && issue.active) {
          pageHealth.set(key, { ...issue, active: false });
          changed = true;
        }
      }
      if (changed) render();
    };
    const recoverCaptureBefore = (sequence: number) => {
      if (extensionStopped) return;
      let changed = false;
      for (const [key, issue] of pageHealth) {
        if (
          issue.context === "capture" &&
          issue.active &&
          (captureRaisedAt.get(key) ?? 0) < sequence
        ) {
          pageHealth.set(key, { ...issue, active: false });
          changed = true;
        }
      }
      if (changed) render();
    };
    // Only a current problem is a status (D7). A capture failure stays current until a
    // later capture succeeds; Details keeps earlier problems and their times.
    const pageHealthAffectsStatus = () =>
      [...pageHealth.values()].some((issue) => issue.active);
    const fileBinding = () => ({
      documentNonce,
      navigationNonce,
      captureId: null as null,
    });
    const relayUrl = browser.runtime.getURL(FILE_RELAY_PATH);
    const methodologyUrl =
      browser.runtime.getURL("/methodology-reference.html") + "#method-history";
    const relayLocation = new URL(relayUrl);
    const fileOffers = new FileOfferBridge({
      binding: fileBinding,
      captureBinding: (captureId) => captureBindings.get(captureId) ?? null,
      captureCurrent: (captureId, binding) => {
        const captured = captureBindings.get(captureId);
        return (
          !!captured &&
          captured.documentNonce === binding.documentNonce &&
          captured.navigationNonce === binding.navigationNonce &&
          captured.captureId === captureId
        );
      },
      document,
      extensionId: browser.runtime.id,
      extensionOrigin: `${relayLocation.protocol}//${relayLocation.host}`,
      pageOrigin: location.origin,
      relayUrl,
      runtimeSend: (message) => sendToBackground(message),
      siteAccess: () => siteAccess,
      window,
    });
    const clearOwnedDisplay = () => {
      clearHold();
      latest = null;
      latestPath = null;
      latestSource = null;
      latestRouteBinding = null;
      latestRouteSelectedCaptureId = null;
      displayGeneration++;
      shownFigures = null;
      if (shadow) {
        shadow.querySelector("[data-metrics]")!.textContent = barStateText(
          barActivity(),
        );
        setBarStatus("", shadow);
        shadow.querySelector("[data-body]")!.replaceChildren();
        shadow.querySelector("[data-sync-row]")?.replaceChildren();
        const panel = shadow.querySelector<HTMLElement>(".panel");
        if (panel) panel.hidden = true;
        stackDetails(false);
        shadow
          .querySelectorAll("[data-open]")
          .forEach((button) => button.setAttribute("aria-expanded", "false"));
      }
      const advice = noticeShadow?.querySelector<HTMLElement>(".notice");
      if (advice) advice.hidden = true;
    };
    const releaseHistoricalCapture = (
      id: string,
      observed: HistoricalObservation,
    ) => {
      if (historicalBindings.get(id) !== observed) return;
      if (observed.timer) clearTimeout(observed.timer);
      historicalBindings.delete(id);
    };
    const clearHistoricalCapture = () => {
      for (const observed of historicalBindings.values())
        if (observed.timer) clearTimeout(observed.timer);
      historicalBindings.clear();
      const waiting = [...waitingHistorical.values()];
      waitingHistorical.clear();
      // Their later messages find no read and are refused.
      for (const entry of waiting) {
        if (entry.timer) clearTimeout(entry.timer);
        for (const next of entry.later) next();
      }
    };
    const invalidateHistoricalCapture = (resetPageObserver = true) => {
      clearHistoricalCapture();
      if (resetPageObserver)
        window.postMessage({ channel: HISTORY_RESET_CHANNEL }, location.origin);
      void sendToBackground({
        target: "history-observation-invalidate",
        binding: { documentNonce, navigationNonce, captureId: null },
      }).catch(() => {});
    };
    /**
     * A move between two addresses of the same chat is not a navigation. A ChatGPT project
     * chat opened by full load at /g/g-p-<id>/c/<chat> moves to the project's named address
     * (/g/g-p-<id>-<name>/c/<chat>) while its saved messages load; treating that as a new
     * chat dropped the read, so the bar stayed on Processing and then showed No figures yet
     * with a history problem until a reload (live QA, 19 Oct 2026). The chat's reads, figures
     * and navigation stay; only the remembered address changes. Returns true when it did.
     *
     * A new ChatGPT chat's move from the start page to its local address right after the send
     * is the same new chat too, so its reply stays selected and its displays show there. A
     * Stop before ChatGPT names the chat leaves the page at that address (live, 19 Oct 2026);
     * before, the reply's figures never showed and the bar fell back to a waiting state. The
     * reply also waits, bounded, for the move to the chat's own address, as in scan().
     */
    const followChatAddress = () => {
      const path = location.pathname;
      if (path === lastPath) return false;
      const before = parseConversationRoute(site!, lastPath);
      const after = parseConversationRoute(site!, path);
      const captured = selectedCaptureId
        ? captureBindings.get(selectedCaptureId)
        : null;
      const newChat =
        !before &&
        !provisionalChatgptRoute(lastPath) &&
        provisionalChatgptRoute(path) &&
        !!captured &&
        captured.documentNonce === documentNonce &&
        captured.navigationNonce === navigationNonce;
      if (
        !newChat &&
        (!before ||
          !after ||
          before.site !== after.site ||
          before.conversationId !== after.conversationId)
      )
        return false;
      if (newChat) {
        const observed = captureIdentities.get(selectedCaptureId!);
        pendingCapturePromotion = {
          binding: { ...captured! },
          identity:
            observed?.scopeGeneration === scopeGeneration
              ? observed.identity
              : null,
          display: latestSource === "active" ? latest : null,
          scopeGeneration,
          expires: Date.now() + 30000,
        };
      }
      const from = lastPath;
      lastPath = path;
      if (latestPath === from) latestPath = path;
      if (loadedPath === from) loadedPath = path;
      for (const observed of historicalBindings.values())
        if (observed.path === from) observed.path = path;
      for (const observed of historyBindings.values())
        if (observed.path === from) observed.path = path;
      if (heldDisplay?.path === from) heldDisplay.path = path;
      if (shownFigures?.path === from) shownFigures.path = path;
      if (comparison?.path === from) comparison.path = path;
      return true;
    };
    const currentHistoricalCapture = (observed: HistoricalObservation) => {
      followChatAddress();
      const route = parseConversationRoute(site!, location.pathname);
      return (
        observed.binding.documentNonce === documentNonce &&
        observed.binding.navigationNonce === navigationNonce &&
        observed.scopeGeneration === scopeGeneration &&
        observed.path === location.pathname &&
        route?.conversationId === observed.conversationId
      );
    };
    const liveHistoricalCapture = (
      id: string,
      observed: HistoricalObservation,
    ) =>
      siteAccess &&
      historicalBindings.get(id) === observed &&
      currentHistoricalCapture(observed);
    const scheduleHistoricalRpc = (
      id: string,
      observed: HistoricalObservation,
      message: HistoryCaptureMessage | ClaudeStreamCapture | ProviderStreamCapture,
    ): Promise<unknown> | null => {
      if (physicalHistoricalCalls.size >= HISTORY_LIMITS.maxActive) return null;
      const lease = {};
      physicalHistoricalCalls.add(lease);
      return Promise.resolve()
        .then(() => {
          if (!liveHistoricalCapture(id, observed)) return null;
          return sendToBackground({
            target: "history-observation",
            message,
            binding: observed.binding,
          });
        })
        .finally(() => physicalHistoricalCalls.delete(lease));
    };
    const markCurrentHistoricalFailure = (
      reason: HistoryDiagnostic["reason"] | null = null,
    ) => {
      historyFailureGeneration++;
      if (
        reason === "history_response_limit" ||
        reason === "history_text_limit" ||
        reason === "history_message_limit"
      )
        historyFailureReason = reason;
      if (historyFailure && !reason) return;
      historyFailure = true;
      render();
    };
    const markHistoricalFailure = (observed: HistoricalObservation) => {
      if (observed.failureReported || !currentHistoricalCapture(observed))
        return;
      observed.failureReported = true;
      markCurrentHistoricalFailure();
    };
    const reportHistoricalDiagnostic = (message: HistoryDiagnostic) => {
      if (!siteAccess) return;
      const route = parseConversationRoute(site!, location.pathname);
      if (route?.conversationId !== message.conversationId) return;
      if (NOTEBOOKLM_CHAT_PROBLEMS.has(message.reason)) {
        notebookChatProblem = message.reason as NotebooklmChatProblem;
        render();
        return;
      }
      if (message.id === null) {
        markCurrentHistoricalFailure(message.reason);
        return;
      }
      const observed = historicalBindings.get(message.id);
      if (
        !observed ||
        observed.observedAt !== message.observedAt ||
        observed.conversationId !== message.conversationId ||
        !liveHistoricalCapture(message.id, observed)
      )
        return;
      markHistoricalFailure(observed);
      releaseHistoricalCapture(message.id, observed);
    };
    const sendHistoricalCapture = (message: HistoryCaptureMessage) => {
      if (!siteAccess) return;
      const path = location.pathname;
      const route = parseConversationRoute(site!, path);
      if (route?.conversationId !== message.conversationId) return;
      if (message.event === "start") {
        // A provider can start loading the selected chat before our delayed DOM
        // scan. Bind to the new route now without canceling that same response.
        if (path !== lastPath) scan(true);
        const now = Date.now();
        for (const [id, seenAt] of historicalSeen)
          if (now - seenAt > 300000) historicalSeen.delete(id);
        if (historicalSeen.has(message.id)) return;
        historicalSeen.set(message.id, now);
        while (historicalSeen.size > 64)
          historicalSeen.delete(historicalSeen.keys().next().value!);
        while (
          historicalStarts.length &&
          now - historicalStarts[0]! >= HISTORY_LIMITS.windowMs
        )
          historicalStarts.shift();
        if (historicalStarts.length >= HISTORY_LIMITS.startsPerWindow) {
          markCurrentHistoricalFailure();
          return;
        }
        historicalStarts.push(now);
        if (historicalSlotsBusy()) {
          waitForHistoricalSlot(message, 0);
          return;
        }
        beginHistoricalCapture(message, path);
        return;
      }
      const observed = historicalBindings.get(message.id);
      // A read waiting for a slot keeps its page until it starts.
      if (!observed && waitingHistorical.has(message.id)) {
        waitingHistorical
          .get(message.id)!
          .later.push(() => sendHistoricalCapture(message));
        return;
      }
      continueHistoricalCapture(message, observed);
    };
    const historicalSlotsBusy = () =>
      historicalBindings.size >= HISTORY_LIMITS.maxActive ||
      physicalHistoricalCalls.size >= HISTORY_LIMITS.maxActive;
    /**
     * Waits for an import slot with backoff. The page world starts a read once its own slot
     * is free, but the background may still be saving the previous read, slowly on the first
     * page load after the extension restarts (live finding of 14 Oct 2026 on NotebookLM),
     * so a read that found both slots taken failed although a slot was about to free. Only
     * when no slot frees within the waits does it count as a failed import.
     */
    const waitForHistoricalSlot = (
      message: HistoryCaptureMessage,
      attempt: number,
    ) => {
      let waiting = waitingHistorical.get(message.id);
      if (!waiting) {
        if (waitingHistorical.size >= HISTORY_LIMITS.maxActive) {
          markCurrentHistoricalFailure();
          return;
        }
        waiting = { later: [], timer: null };
        waitingHistorical.set(message.id, waiting);
      }
      const entry = waiting;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (waitingHistorical.get(message.id) !== entry) return;
        const path = location.pathname;
        const current =
          siteAccess &&
          !extensionStopped &&
          parseConversationRoute(site!, path)?.conversationId ===
            message.conversationId;
        if (current && historicalSlotsBusy()) {
          if (attempt + 1 < HISTORICAL_SLOT_WAITS.length) {
            waitForHistoricalSlot(message, attempt + 1);
            return;
          }
          markCurrentHistoricalFailure();
        } else if (current) beginHistoricalCapture(message, path);
        waitingHistorical.delete(message.id);
        // Its later messages follow in order; without a started read they are refused.
        for (const next of entry.later) next();
      }, HISTORICAL_SLOT_WAITS[attempt]);
    };
    const beginHistoricalCapture = (
      message: HistoryCaptureMessage,
      path: string,
    ) => {
      const observed: HistoricalObservation = {
        binding: { documentNonce, navigationNonce, captureId: null },
        conversationId: message.conversationId,
        observedAt: message.observedAt,
        pageAccepted: false,
        path,
        scopeGeneration,
        selectedCaptureId,
        failureGeneration: historyFailureGeneration,
        failureReported: false,
        timer: null,
        chain: Promise.resolve(),
      };
      observed.timer = setTimeout(() => {
        if (liveHistoricalCapture(message.id, observed))
          markHistoricalFailure(observed);
        releaseHistoricalCapture(message.id, observed);
      }, HISTORY_LIMITS.lifecycleMs);
      historicalBindings.set(message.id, observed);
      earlierImport = "running";
      observed.chain = (
        scheduleHistoricalRpc(message.id, observed, message) ??
        Promise.resolve(null)
      )
        .then((result: any) => {
          if (result?.accepted !== true) {
            markHistoricalFailure(observed);
            releaseHistoricalCapture(message.id, observed);
            return null;
          }
          return result;
        })
        .catch(() => {
          markHistoricalFailure(observed);
          releaseHistoricalCapture(message.id, observed);
          return null;
        });
    };
    const continueHistoricalCapture = (
      message: HistoryCaptureMessage,
      observed: HistoricalObservation | undefined,
    ) => {
      if (
        !observed ||
        observed.pageAccepted ||
        observed.observedAt !== message.observedAt ||
        observed.conversationId !== message.conversationId ||
        !currentHistoricalCapture(observed)
      )
        return;
      observed.pageAccepted = true;
      observed.chain = observed.chain
        .then((start: any) => {
          if (
            start?.accepted !== true ||
            !liveHistoricalCapture(message.id, observed)
          )
            return null;
          return scheduleHistoricalRpc(message.id, observed, message);
        })
        .then((page: any) => {
          const current =
            liveHistoricalCapture(message.id, observed) &&
            selectedCaptureId === observed.selectedCaptureId;
          releaseHistoricalCapture(message.id, observed);
          if (!current) return;
          if (page?.accepted !== true) {
            markHistoricalFailure(observed);
            return;
          }
          if (observed.failureGeneration === historyFailureGeneration)
            historyFailure = false;
          if (!historyFailure) historyFailureReason = null;
          earlierImport = "done";
          earlierImportAt = Date.now();
          refreshRecordedRoute();
        })
        .catch(() => {
          markHistoricalFailure(observed);
          releaseHistoricalCapture(message.id, observed);
        });
    };
    const sendClaudeStreamCapture = (
      message: ClaudeStreamCapture | ProviderStreamCapture,
      port: MessagePort,
    ) => {
      const observed = historicalBindings.get(message.id);
      // A read waiting for a slot answers its rows once it starts (waitForHistoricalSlot).
      if (!observed && waitingHistorical.has(message.id)) {
        waitingHistorical
          .get(message.id)!
          .later.push(() => sendClaudeStreamCapture(message, port));
        return;
      }
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      // A question about Computer files is answered with the files saved counts hold.
      const reply = (accepted: boolean, known?: unknown) => {
        if (heartbeat) clearInterval(heartbeat);
        try {
          port.postMessage(
            known === undefined ? { accepted } : { accepted, known },
          );
        } catch {}
        port.close();
      };
      if (
        !siteAccess ||
        !observed ||
        observed.pageAccepted ||
        observed.observedAt !== message.observedAt ||
        observed.conversationId !== message.conversationId ||
        !currentHistoricalCapture(observed)
      ) {
        reply(false);
        return;
      }
      if (observed.timer) clearTimeout(observed.timer);
      observed.timer = setTimeout(() => {
        if (liveHistoricalCapture(message.id, observed))
          markHistoricalFailure(observed);
        releaseHistoricalCapture(message.id, observed);
      }, HISTORY_LIMITS.lifecycleMs);
      if (
        site === "notebooklm" &&
        message.event === "batch" &&
        Array.isArray(message.rows) &&
        message.rows.length
      ) {
        if (!notebookContent) {
          notebookContent = true;
          // The bar leaves Waiting for your request for Processing (barActivity).
          render();
        }
        if (
          notebooklmRows(message.rows.map((row: any) => row.message)) === "chat"
        ) {
          observed.notebookChat = true;
          notebookChatSeen = true;
        }
      }
      if (message.event === "finish") {
        observed.pageAccepted = true;
        heartbeat = setInterval(() => {
          if (!liveHistoricalCapture(message.id, observed)) {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = null;
            return;
          }
          if (observed.timer) clearTimeout(observed.timer);
          observed.timer = setTimeout(() => {
            if (liveHistoricalCapture(message.id, observed))
              markHistoricalFailure(observed);
            releaseHistoricalCapture(message.id, observed);
          }, HISTORY_LIMITS.lifecycleMs);
          try {
            port.postMessage({ pending: true });
          } catch {
            if (heartbeat) clearInterval(heartbeat);
            heartbeat = null;
          }
        }, 10000);
      }
      observed.chain = observed.chain
        .then((previous: any) => {
          if (
            previous?.accepted !== true ||
            !liveHistoricalCapture(message.id, observed)
          )
            return null;
          return scheduleHistoricalRpc(message.id, observed, message);
        })
        .then((result: any) => {
          const accepted =
            result?.accepted === true &&
            liveHistoricalCapture(message.id, observed);
          if (!accepted) {
            markHistoricalFailure(observed);
            releaseHistoricalCapture(message.id, observed);
          } else if (message.event === "finish") {
            releaseHistoricalCapture(message.id, observed);
            if (observed.failureGeneration === historyFailureGeneration) {
              historyFailure = false;
              historyFailureReason = null;
            }
            // Only a counted read of the saved chat answers a chat that was not counted.
            if (observed.notebookChat) notebookChatProblem = null;
            earlierImport = "done";
            earlierImportAt = Date.now();
            refreshRecordedRoute();
          } else if (message.site === "perplexity" && message.event === "batch")
            noteComputerFiles(
              computerFileFacts,
              message.rows.map((row) => row.message),
            );
          reply(
            accepted,
            accepted && message.event === "files" ? result.known : undefined,
          );
          return result;
        })
        .catch(() => {
          markHistoricalFailure(observed);
          releaseHistoricalCapture(message.id, observed);
          reply(false);
        });
    };
    const releaseThreadHistory = (id: string, observed: HistoryObservation) => {
      if (historyBindings.get(id) !== observed) return;
      if (observed.timer) clearTimeout(observed.timer);
      historyBindings.delete(id);
    };
    const clearThreadHistory = () => {
      for (const observed of historyBindings.values())
        if (observed.timer) clearTimeout(observed.timer);
      historyBindings.clear();
    };
    const invalidateThreadHistory = (resetPageObserver = true) => {
      clearThreadHistory();
      invalidateHistoricalCapture(resetPageObserver);
      if (site === "perplexity")
        void sendToBackground({
          target: "thread-history-invalidate",
          binding: {
            documentNonce,
            navigationNonce,
            captureId: null,
          },
        }).catch(() => {});
    };
    const currentThreadHistory = (observed: HistoryObservation) => {
      followChatAddress();
      return (
        observed.binding.documentNonce === documentNonce &&
        observed.binding.navigationNonce === navigationNonce &&
        observed.scopeGeneration === scopeGeneration &&
        observed.path === location.pathname &&
        observed.threadId === perplexityThreadRoute(location.pathname)
      );
    };
    const liveThreadHistory = (id: string, observed: HistoryObservation) =>
      siteAccess &&
      historyBindings.get(id) === observed &&
      currentThreadHistory(observed);
    const scheduleThreadHistoryRpc = (
      id: string,
      observed: HistoryObservation,
      message: ThreadHistoryMessage,
    ): Promise<unknown> | null => {
      if (physicalHistoryCalls.size >= HISTORY_LIMITS.maxActive) return null;
      const physicalLease = {};
      physicalHistoryCalls.add(physicalLease);
      return Promise.resolve()
        .then(() => {
          if (!liveThreadHistory(id, observed)) return null;
          return sendToBackground({
            target: "thread-history",
            binding: observed.binding,
            payload: message,
          });
        })
        .finally(() => {
          physicalHistoryCalls.delete(physicalLease);
        });
    };
    const sendThreadHistory = (message: ThreadHistoryMessage) => {
      if (site !== "perplexity" || !siteAccess) return;
      const path = location.pathname;
      if (perplexityThreadRoute(path) !== message.threadId) return;
      if (message.event === "start") {
        // As for text history, bind to the new route before the delayed DOM scan.
        // Otherwise the text import's scan clears this thread binding.
        if (path !== lastPath) scan(true);
        const now = Date.now();
        for (const [id, seenAt] of historySeen)
          if (now - seenAt > 300000) historySeen.delete(id);
        if (historySeen.has(message.id)) return;
        historySeen.set(message.id, now);
        while (historySeen.size > 64)
          historySeen.delete(historySeen.keys().next().value!);
        while (
          historyStarts.length &&
          now - historyStarts[0]! >= HISTORY_LIMITS.windowMs
        )
          historyStarts.shift();
        if (historyStarts.length >= HISTORY_LIMITS.startsPerWindow) return;
        historyStarts.push(now);
        if (
          historyBindings.size >= HISTORY_LIMITS.maxActive ||
          physicalHistoryCalls.size >= HISTORY_LIMITS.maxActive
        )
          return;
        const binding: DisplayBinding = {
          documentNonce,
          navigationNonce,
          captureId: null,
        };
        const observed: HistoryObservation = {
          at: message.at,
          binding,
          path,
          scopeGeneration,
          selectedCaptureId,
          threadId: message.threadId,
          pageAccepted: false,
          pageDisplayGeneration: null,
          timer: null,
          chain: Promise.resolve() as Promise<unknown>,
        };
        observed.timer = setTimeout(
          () => releaseThreadHistory(message.id, observed),
          HISTORY_LIMITS.lifecycleMs,
        );
        historyBindings.set(message.id, observed);
        earlierImport = "running";
        observed.chain = (
          scheduleThreadHistoryRpc(message.id, observed, message) ??
          Promise.resolve(null)
        )
          .then((result: any) => {
            if (result?.observed !== false) {
              releaseThreadHistory(message.id, observed);
              return null;
            }
            return result;
          })
          .catch(() => {
            releaseThreadHistory(message.id, observed);
            return null;
          });
        return;
      }
      const observed = historyBindings.get(message.id);
      if (
        !observed ||
        observed.pageAccepted ||
        observed.at !== message.at ||
        observed.threadId !== message.threadId ||
        !currentThreadHistory(observed)
      )
        return;
      observed.pageAccepted = true;
      observed.pageDisplayGeneration = displayGeneration;
      const heartbeat = setInterval(() => {
        if (!liveThreadHistory(message.id, observed)) {
          clearInterval(heartbeat);
          return;
        }
        if (observed.timer) clearTimeout(observed.timer);
        observed.timer = setTimeout(
          () => releaseThreadHistory(message.id, observed),
          HISTORY_LIMITS.lifecycleMs,
        );
      }, 10000);
      const chain = observed.chain
        .then((start: any) => {
          if (
            start?.observed !== false ||
            !liveThreadHistory(message.id, observed)
          )
            return null;
          return (
            scheduleThreadHistoryRpc(message.id, observed, message) ?? null
          );
        })
        .then((page: any) => {
          // A newer live display stays. A newer saved-totals read may have been made before
          // this link was saved (the own read's text import refreshes while the link is
          // written), so the totals are read again (live finding of 14 Oct 2026).
          const current =
            historyBindings.get(message.id) === observed &&
            currentThreadHistory(observed) &&
            selectedCaptureId === observed.selectedCaptureId &&
            (displayGeneration === observed.pageDisplayGeneration ||
              latestSource === "route");
          releaseThreadHistory(message.id, observed);
          if (!current) return;
          if (
            page?.code === "thread_relation_conflict" &&
            page?.error ===
              "Recorded thread links conflict with company records."
          ) {
            threadRelationChanged = true;
            loadedPath = null;
            routeLoading = false;
            routeFailure = {
              message:
                "Recorded thread matches changed. Reloading saved totals.",
              retryable: true,
            };
            clearOwnedDisplay();
            render();
            void loadRecordedRoute(true);
            return;
          }
          if (page?.observed !== true || !currentThreadHistory(observed))
            return;
          threadRelationChanged = false;
          earlierImport = "done";
          earlierImportAt = Date.now();
          loadedPath = null;
          void loadRecordedRoute(true);
        })
        .catch(() => {
          releaseThreadHistory(message.id, observed);
        });
      observed.chain = chain.finally(() => clearInterval(heartbeat));
    };
    const listen = (event: MessageEvent) => {
      if (extensionStopped) return;
      if (!siteAccess) return;
      // Before the person agreed nothing the page world observed is passed on. A history read
      // waiting on its own channel is told at once that it was not taken, so it does not wait.
      if (trackingOff) {
        if (
          event.source === window &&
          event.origin === location.origin &&
          event.ports.length === 1 &&
          (validateClaudeStreamCapture(event.data) ||
            validateProviderStreamCapture(event.data))
        ) {
          const port = event.ports[0]!;
          try {
            port.postMessage({ accepted: false });
          } catch {}
          port.close();
        }
        return;
      }
      if (fileOffers.handleWindowMessage(event)) return;
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.ports.length === 0 &&
        validUploadAssociation(event.data)
      ) {
        const committed = captureCommits.get(event.data.captureId);
        if (committed) fileOffers.bindAssociation(event.data, committed);
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        validateCaptureReady(event.data, probeNonce)
      ) {
        const now = Date.now();
        watchdog.ready(now, event.data.interception);
        // A missed request stays a problem until the page reloads.
        if (
          !watchdog.status(now).activityGap &&
          event.data.interception !== "missed"
        )
          recoverPageHealth("capture", "capture_hook_missing");
        render();
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        validateCoworkSent(event.data, probeNonce, Date.now())
      ) {
        // A Cowork send is observed like a dispatch; its reply arrives as saved history.
        const now = Date.now();
        watchdog.captured(Date.parse(event.data.at));
        const status = watchdog.status(now);
        if (status.listener === "active" && !status.activityGap)
          recoverPageHealth(
            "capture",
            // A request that skipped the tracker stays a problem until reload.
            ...(status.interception === "missed"
              ? []
              : (["capture_hook_missing"] as const)),
            "protocol_unsupported",
          );
        render();
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        validateThreadHistory(event.data)
      ) {
        sendThreadHistory(event.data);
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.ports.length === 0 &&
        validateHistoryDiagnostic(event.data, location.hostname)
      ) {
        reportHistoricalDiagnostic(event.data);
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.ports.length === 0 &&
        validateHistoryCapture(event.data, location.hostname)
      ) {
        sendHistoricalCapture(event.data);
        return;
      }
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.ports.length === 1 &&
        (validateClaudeStreamCapture(event.data) ||
          validateProviderStreamCapture(event.data))
      ) {
        sendClaudeStreamCapture(event.data, event.ports[0]!);
        return;
      }
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        !validateCapture(event.data, location.hostname)
      )
        return;
      const now = Date.now();
      const sequence = ++captureSequence;
      if (event.data.event === "dispatch") {
        watchdog.captured(Date.parse(event.data.at));
        const status = watchdog.status(now);
        if (status.listener === "active" && !status.activityGap)
          recoverPageHealth(
            "capture",
            // A request that skipped the tracker stays a problem until reload.
            ...(status.interception === "missed"
              ? []
              : (["capture_hook_missing"] as const)),
            "protocol_unsupported",
          );
        render();
      }
      // A saved failure receipt does not mean the request was measured. Surface
      // capture failures even when missing identity prevents a totals publication.
      if (event.data.failure)
        recordPageHealth(
          CAPTURE_FAILURE_REASONS[event.data.failure] ?? "partial_capture",
          true,
        );
      const admitted = admitCapture(event.data.event, now);
      // Only progress of a bound capture waits; any other could never be relayed, and
      // holding it would let a flood of new ids grow the held frames without bound.
      if (admitted === "hold" && captureBindings.has(event.data.id)) {
        holdProgress(event.data, sequence);
        return;
      }
      if (admitted !== "send") {
        recordPageHealth("capture_limit_exceeded", true);
        return;
      }
      relayCapture(event.data, sequence);
    };
    /**
     * Whether a capture frame may go to the background now (X10). Over 16 frames a second,
     * progress waits for the next second and health frames, sent once per failure, are
     * dropped. Dispatch and end frames always pass unless a page floods 64 a second.
     */
    const admitCapture = (event: CaptureMessage["event"], now: number) => {
      if (now - lastWindow > 1000) {
        lastWindow = now;
        messages = 0;
      }
      if (messages >= (event === "dispatch" || event === "end" ? 64 : 16))
        return event === "progress" ? "hold" : "drop";
      messages++;
      return "send";
    };
    const holdProgress = (data: CaptureMessage, sequence: number) => {
      heldProgress.set(data.id, { data, sequence });
      heldTimer ??= setTimeout(
        flushHeldProgress,
        Math.max(1, lastWindow + 1001 - Date.now()),
      );
    };
    const flushHeldProgress = () => {
      heldTimer = null;
      for (const [id, held] of [...heldProgress]) {
        if (admitCapture("progress", Date.now()) !== "send") break;
        heldProgress.delete(id);
        relayCapture(held.data, held.sequence);
      }
      if (heldProgress.size)
        heldTimer = setTimeout(
          flushHeldProgress,
          Math.max(1, lastWindow + 1001 - Date.now()),
        );
    };
    type CaptureFrame = {
      data: CaptureMessage;
      sequence: number;
      binding: DisplayBinding;
      spoken: boolean;
      done: (delivered: boolean) => void;
    };
    type CaptureLane = { frames: CaptureFrame[]; tries: number };
    /**
     * Captures with a frame the background was not ready for (lib/capture-delivery.ts). Their
     * frames wait here in revision order, with the later frames of the same capture, and are
     * sent again after CAPTURE_RETRY_DELAYS_MS. Holding the later frames keeps an end frame
     * from reaching the background before the dispatch that starts its record. Frames of
     * other captures are not held, so a waiting capture never delays another.
     */
    const captureLanes = new Map<string, CaptureLane>();
    // The newest frame relayed for each capture. A frame sent while an older one was failing
    // may have run before it, so it is sent once more after it; the background skips a repeat.
    const newestFrames = new Map<string, CaptureFrame>();
    // Captures whose dispatch never reached the background. Their reply is lost once it ends.
    const lostDispatches = new Set<string>();
    const sendCapture = async (
      frame: CaptureFrame,
    ): Promise<CaptureAnswer | null> => {
      let answer: CaptureAnswer;
      try {
        answer = captureAnswer(
          await sendToBackground({
            target: "capture",
            payload: frame.data,
            binding: frame.binding,
          }),
        );
      } catch {
        answer = captureSendThrew();
      }
      // A stopped tracker (an extension reload) sends nothing more and reports nothing.
      return extensionStopped ? null : answer;
    };
    // A reply the bar shows whose frames could not be delivered is read from the chat's saved
    // history once (16 Oct 2026). Read aloud and replies of another chat are not.
    const lostReply = (captureId: string) => {
      if (
        captureId !==
        (selectedCaptureId ?? pendingPromotion()?.binding.captureId ?? null)
      )
        return;
      lostReplyNavigation = navigationNonce;
      render();
    };
    const captureDelivered = (frame: CaptureFrame, superseded: boolean) => {
      const { data } = frame;
      if (data.event === "end") {
        if (newestFrames.get(data.id)?.data === data) newestFrames.delete(data.id);
        // The background had no record to add this reply to.
        if (lostDispatches.delete(data.id)) lostReply(data.id);
      }
      // A newer frame of the same reply replaced this one before it ran, so it
      // says nothing about storage health.
      if (superseded) return;
      // A frame captured and saved in full shows that capture works again. A saved
      // failure receipt does not: its own problem stays current.
      if (!data.failure) recoverCaptureBefore(frame.sequence);
      // Saved totals on the bar are read again to include the speech or guide. A
      // reply shown live is published again by the background instead.
      if (frame.spoken && latestSource !== "active") refreshRecordedRoute();
    };
    // Frames that will not be sent again, with the last answer's code: a refusal, or not ready
    // on the last try (`exhausted`). The problem is recorded once for them, so a frame that
    // was delivered on a later try leaves no problem behind.
    const captureUndelivered = (
      frames: CaptureFrame[],
      code: unknown,
      exhausted: boolean,
    ) => {
      const id = frames[0]!.data.id;
      let ended = false;
      for (const { data } of frames)
        if (data.event === "end") {
          ended = true;
          // A failed end frame publishes no figures, so the bar stops waiting for them.
          captureEnds.delete(data.id);
          guideWaits.delete(data.id);
          if (newestFrames.get(data.id)?.data === data) newestFrames.delete(data.id);
        }
      recordPageHealth(code, true);
      if (!exhausted) {
        // Never read for a refusal.
        if (ended) lostDispatches.delete(id);
        return;
      }
      if (ended) {
        lostDispatches.delete(id);
        lostReply(id);
      } else if (frames.some(({ data }) => data.event === "dispatch"))
        lostDispatches.add(id);
    };
    const holdCapture = (lane: CaptureLane, frame: CaptureFrame) => {
      const { revision } = frame.data;
      const same = lane.frames.find((held) => held.data.revision === revision);
      if (same) {
        // The same frame again (a copy sent once more): one send settles both.
        const settle = same.done;
        same.done = (delivered) => {
          settle(delivered);
          frame.done(delivered);
        };
        return;
      }
      // Progress frames carry the whole reply so far, so only the newest needs to wait. A
      // dispatch, an end and a saved failure receipt each wait in full.
      const mergeable = (value: CaptureFrame) =>
        value.data.event === "progress" && !value.data.failure;
      if (
        mergeable(frame) &&
        lane.frames.some(
          (held) =>
            held.data.event !== "dispatch" && held.data.revision > revision,
        )
      ) {
        frame.done(true);
        return;
      }
      if (frame.data.event !== "dispatch")
        for (const held of lane.frames.filter(
          (value) => mergeable(value) && value.data.revision < revision,
        )) {
          lane.frames.splice(lane.frames.indexOf(held), 1);
          held.done(true);
        }
      lane.frames.push(frame);
      lane.frames.sort((a, b) => a.data.revision - b.data.revision);
    };
    const runCaptureLane = async (id: string, lane: CaptureLane) => {
      lane.tries++;
      while (lane.frames.length) {
        const frame = lane.frames[0]!;
        const answer = await sendCapture(frame);
        if (!answer) {
          captureLanes.delete(id);
          for (const held of lane.frames.splice(0)) held.done(false);
          return;
        }
        if (answer.kind === "not_ready") {
          if (lane.tries < CAPTURE_RETRY_DELAYS_MS.length) {
            scheduleCaptureLane(id, lane);
            return;
          }
          captureLanes.delete(id);
          const frames = lane.frames.splice(0);
          if (!frames.length) return;
          captureUndelivered(frames, answer.code, true);
          for (const held of frames) held.done(false);
          return;
        }
        // A newer frame may have replaced this one while it was sent.
        const index = lane.frames.indexOf(frame);
        if (index >= 0) lane.frames.splice(index, 1);
        if (answer.kind === "delivered") {
          captureDelivered(frame, answer.superseded);
          frame.done(true);
        } else {
          captureUndelivered([frame], answer.code, false);
          frame.done(false);
        }
      }
      captureLanes.delete(id);
    };
    const scheduleCaptureLane = (id: string, lane: CaptureLane) => {
      setTimeout(
        () => void runCaptureLane(id, lane),
        CAPTURE_RETRY_DELAYS_MS[lane.tries],
      );
    };
    const retryCapture = (frame: CaptureFrame) => {
      const id = frame.data.id;
      let lane = captureLanes.get(id);
      if (!lane) {
        lane = { frames: [], tries: 0 };
        captureLanes.set(id, lane);
        const newest = newestFrames.get(id);
        if (newest && newest.data.revision > frame.data.revision)
          holdCapture(lane, { ...newest, done: () => {} });
        scheduleCaptureLane(id, lane);
      }
      holdCapture(lane, frame);
    };
    const deliverCapture = (frame: CaptureFrame) => {
      const health = frame.data.event === "health";
      const lane = health ? undefined : captureLanes.get(frame.data.id);
      if (lane) {
        holdCapture(lane, frame);
        return;
      }
      void sendCapture(frame).then((answer) => {
        if (!answer) {
          frame.done(false);
          return;
        }
        if (answer.kind === "delivered") {
          // An older frame of this capture failed meanwhile and waits; this one may have
          // run before it, so it follows it once more.
          const waiting = health ? undefined : captureLanes.get(frame.data.id);
          if (waiting) holdCapture(waiting, { ...frame, done: () => {} });
          captureDelivered(frame, answer.superseded);
          frame.done(true);
          return;
        }
        // A health frame reports a page problem and has no revision the background could
        // use to skip a repeat, so it is never sent again.
        if (
          answer.kind === "not_ready" &&
          !health &&
          CAPTURE_RETRY_DELAYS_MS.length
        ) {
          retryCapture(frame);
          return;
        }
        captureUndelivered(
          [frame],
          answer.code,
          answer.kind === "not_ready" && !health,
        );
        frame.done(false);
      });
    };
    const relayCapture = (data: CaptureMessage, sequence: number) => {
      const now = Date.now();
      // A newer frame of the capture replaces one still held.
      heldProgress.delete(data.id);
      let binding = captureBindings.get(data.id);
      if (data.event === "dispatch") {
        if (!binding) {
          for (const [captureId, seenAt] of activeCaptureIds)
            if (now - seenAt > CAPTURE_SILENT_MS)
              activeCaptureIds.delete(captureId);
          for (const [captureId] of captureBindings) {
            if (captureBindings.size < 32) break;
            if (!activeCaptureIds.has(captureId)) {
              captureBindings.delete(captureId);
              captureEnds.delete(captureId);
              finishedCaptures.delete(captureId);
              captureCommits.delete(captureId);
              newestFrames.delete(captureId);
              lostDispatches.delete(captureId);
              captureIdentities.delete(captureId);
              readAloudIds.delete(captureId);
              guideWaits.delete(captureId);
              newChatCaptures.delete(captureId);
              pausedCaptures.delete(captureId);
            }
          }
          if (captureBindings.size >= 32) {
            recordPageHealth("capture_limit_exceeded", true);
            return;
          }
          binding = {
            documentNonce,
            navigationNonce,
            captureId: data.id,
          };
          captureBindings.set(data.id, binding);
          if (trackingPaused) pausedCaptures.add(data.id);
        }
        if (sideCapture(data.dispatch?.action)) readAloudIds.add(data.id);
        else {
          // A ChatGPT send that names no chat starts a new one (unsavedEarlierMissed).
          if (
            site === "chatgpt" &&
            data.dispatch?.action === "send" &&
            data.dispatch.conversationId === null
          )
            newChatCaptures.add(data.id);
          pendingCapturePromotion = null;
          selectedCaptureId = data.id;
          // The request arrived; from here its capture decides what the bar shows.
          composerSent = null;
          // A request that names its chat (claude.ai's completion address does) gives its
          // capture the identity the background will publish it with. A new chat moves from
          // /new to its own address while the first display is still on its way; without the
          // identity that move dropped the reply, so the saved totals read for the new address
          // showed its partial figures (Unknown) on the bar until it ended (live QA, 19 Oct
          // 2026). Perplexity's ids never name a thread, as in the background.
          const named = {
            site: site!,
            conversationId: data.dispatch?.conversationId,
          };
          if (
            site !== "perplexity" &&
            isConversationIdentity(named) &&
            !captureIdentities.has(data.id)
          )
            captureIdentities.set(data.id, {
              binding: { ...binding },
              identity: named,
              scopeGeneration,
            });
        }
      }
      if (data.event === "health")
        binding = {
          documentNonce,
          navigationNonce,
          captureId: data.id,
        };
      if (!binding) {
        recordPageHealth("request_identity_ambiguous", true);
        return;
      }
      // Every frame shows its capture is alive, also one that resumes after its end.
      if (data.event === "end") {
        activeCaptureIds.delete(data.id);
        // The reply's figures publish after its end; the bar waits for them on Processing.
        if (!readAloudIds.has(data.id)) {
          captureEnds.set(data.id, now);
          scheduleBarRecheck(DISPLAY_WAIT_MS);
        }
      } else if (data.event !== "health") activeCaptureIds.set(data.id, now);
      // A NotebookLM guide's figures come with the saved totals read after its end
      // (captureDelivered). A guide that wrote nothing, as for a notebook without sources,
      // adds no figures, so the bar leaves Processing at once.
      if (
        site === "notebooklm" &&
        readAloudIds.has(data.id) &&
        data.event !== "health"
      ) {
        if (data.event === "end" && data.snapshot?.intermediate === "")
          guideWaits.delete(data.id);
        else {
          const wait = data.event === "end" ? DISPLAY_WAIT_MS : CAPTURE_SILENT_MS;
          guideWaits.set(data.id, {
            navigation: binding.navigationNonce,
            until: now + wait,
          });
          scheduleBarRecheck(wait);
        }
      }
      const spoken = data.event === "end" && readAloudIds.delete(data.id);
      let done!: (delivered: boolean) => void;
      const committed = new Promise<boolean>((resolve) => (done = resolve));
      const frame: CaptureFrame = { data, sequence, binding, spoken, done };
      if (data.event !== "health") newestFrames.set(data.id, frame);
      deliverCapture(frame);
      if (data.event === "dispatch") captureCommits.set(data.id, committed);
      // A request sent, or a notebook guide started, before the chat has figures turns the
      // bar to Processing at once.
      if (
        data.event === "dispatch" &&
        (guideWaits.has(data.id) ||
          (!readAloudIds.has(data.id) && selectedCaptureId === data.id))
      )
        render();
    };
    window.addEventListener("message", listen, { signal });
    const editorSelector = composerEditorSelector(site);
    const composer = () =>
      resolveComposer(document, site, {
        width: innerWidth,
        height: innerHeight,
      });
    const inComposer = (target: EventTarget | null) => {
      const selectedComposer = composer();
      return (
        target instanceof Element && !!selectedComposer?.editor.contains(target)
      );
    };
    // A send the person made from the composer. The bar shows Processing from here (see
    // composerSent); Enter in an empty composer sends nothing, so it changes only the
    // watchdog, which keeps its own rule.
    const composerSend = (typed: boolean) => {
      const now = Date.now();
      watchdog.sent(now);
      if (typed) {
        const editor = composer()?.editor;
        const text =
          editor instanceof HTMLTextAreaElement
            ? editor.value
            : editor?.textContent;
        if (!text?.trim()) return;
      }
      composerSent = { at: now, navigation: navigationNonce };
      // Figures already shown stay while the request is processed (owner decision 1a).
      if (shownFigures?.navigation !== navigationNonce) render();
    };
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.isTrusted &&
          isPlainSendKey(event) &&
          inComposer(event.target)
        )
          composerSend(true);
      },
      { capture: true, signal },
    );
    document.addEventListener(
      "submit",
      (event) => {
        if (
          event.isTrusted &&
          event.target instanceof Element &&
          composer()?.anchor === event.target
        )
          composerSend(false);
      },
      { capture: true, signal },
    );
    document.addEventListener(
      "click",
      (event) => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        const button = event.target.closest("button");
        const selectedComposer = composer();
        if (
          button &&
          selectedComposer &&
          isComposerSendButton(button, selectedComposer, site)
        )
          composerSend(false);
      },
      { capture: true, signal },
    );
    const probe = () => {
      window.postMessage(
        { channel: "ai-footprint-probe-v1", nonce: probeNonce },
        location.origin,
      );
      void sendToBackground({ target: "capture-status" })
        .then((status) => {
          trackingEnabled = status?.enabled === true;
          recoverPageHealth("status", "policy_unavailable");
        })
        .catch(() => {
          trackingEnabled = false;
          recordPageHealth("policy_unavailable", true, "status");
        });
    };
    probe();
    const checkWatchdog = (resumed = false) => {
      if (extensionStopped) return;
      const now = Date.now();
      const schedule = watchdog.poll(now, resumed);
      if (schedule.refreshStatus) probe();
      else if (schedule.probe)
        window.postMessage(
          { channel: "ai-footprint-probe-v1", nonce: probeNonce },
          location.origin,
        );
      const failure = watchdog.check(now, trackingEnabled && siteAccess);
      if (failure) {
        const status = watchdog.status(now);
        recordPageHealth(
          failure,
          status.listener === "missing" ||
            status.activityGap ||
            status.interception === "missed",
        );
        void sendToBackground({
          target: "capture-diagnostic",
          code: failure,
        }).catch(() => {});
      }
    };
    const watchdogTimer = setInterval(checkWatchdog, 1000);
    window.addEventListener(
      "pageshow",
      (event) => {
        if (event.persisted) checkWatchdog(true);
      },
      { signal },
    );
    browser.runtime.onMessage.addListener((message, sender) => {
      if (extensionStopped) return;
      const fileGrantCheck = fileOffers.handleGrantCheck(message, sender);
      if (fileGrantCheck) return fileGrantCheck;
      // "Load full chat history" changed in Settings: a running read whose switch is now off stops,
      // and a read the switch held is made once it is on (owner decision of 17 Oct 2026).
      if (message?.target === OWN_READ_SETTING_CHANGED) {
        if (sender.id !== browser.runtime.id) return;
        ownRead?.settingChanged();
        return;
      }
      // The person agreed or turned tracking off in the welcome page, popup or Settings.
      if (message?.target === TRACKING_STATE_CHANGED) {
        if (sender.id !== browser.runtime.id) return;
        readTrackingState();
        return;
      }
      // The popup asks this tab whether capture works now; saved records only say what
      // happened earlier (owner, 12 October 2026).
      if (message?.target === "page-health") {
        if (sender.id !== browser.runtime.id) return;
        return Promise.resolve({
          target: "page-health",
          problems: [...pageHealth.values()]
            .filter(
              (issue) =>
                issue.active &&
                issue.context === "capture" &&
                (issue.code === "capture_hook_missing" ||
                  issue.code === "protocol_unsupported"),
            )
            .map((issue) => ({ code: issue.code, count: issue.count })),
        });
      }
      if (message?.target === "footprint-capture-current") {
        if (sender.id !== browser.runtime.id) return;
        // The browser can report the new address before this page has handled it; a new
        // Perplexity thread's answer starts waiting for its proof only then.
        if (
          (site === "perplexity" ||
            provisionalChatgptRoute(location.pathname) ||
            provisionalChatgptRoute(lastPath) ||
            unsavedChatgptRoute(location.pathname)) &&
          location.pathname !== lastPath
        )
          scan();
        const binding = message.binding;
        const captured = captureBindings.get(binding?.captureId);
        const route = parseConversationRoute(site!, location.pathname);
        const pending = pendingPromotion();
        return Promise.resolve({
          current:
            Object.keys(message).sort().join(",") ===
              "binding,conversationId,path,site,target" &&
            typeof message.path === "string" &&
            message.path.startsWith("/") &&
            message.path.length <= 2048 &&
            (message.conversationId === null ||
              isConversationIdentity({
                site: message.site,
                conversationId: message.conversationId,
              })) &&
            isDisplayBinding(binding, binding?.captureId) &&
            binding.captureId !== null &&
            (selectedCaptureId === binding.captureId ||
              pending?.binding.captureId === binding.captureId) &&
            !!captured &&
            captured.documentNonce === documentNonce &&
            binding.documentNonce === documentNonce &&
            captured.navigationNonce === binding.navigationNonce &&
            message.site === site &&
            siteAccess &&
            (!pending?.identity ||
              message.conversationId === null ||
              pending.identity.conversationId === message.conversationId) &&
            ((route?.conversationId === message.conversationId &&
              route?.site === site) ||
              // A new Perplexity thread opens before its answer is proven to be in it, and
              // the answer waits for that proof (scan()). Its binding must survive the move.
              (site === "perplexity" &&
                !!route &&
                message.conversationId === null &&
                pending?.binding.captureId === binding.captureId &&
                !pending.identity) ||
              // The same wait for a new ChatGPT chat after its provisional address.
              (!!route &&
                message.conversationId === null &&
                pending?.binding.captureId === binding.captureId &&
                pending.awaitsNewChat === true &&
                !pending.identity) ||
              (!route &&
                ((message.path === location.pathname &&
                  binding.navigationNonce === navigationNonce) ||
                  pending?.binding.captureId === binding.captureId))),
        });
      }
      if (message?.target === "footprint-route-current") {
        if (sender.id !== browser.runtime.id) return;
        const route = parseConversationRoute(site!, location.pathname);
        return Promise.resolve({
          current:
            Object.keys(message).sort().join(",") ===
              "binding,conversationId,site,target" &&
            isDisplayBinding(message.binding, null) &&
            message.binding.documentNonce === documentNonce &&
            message.binding.navigationNonce === navigationNonce &&
            message.site === site &&
            route?.conversationId === message.conversationId &&
            siteAccess,
        });
      }
      if (
        message?.target === "footprint-recorded-thread-invalidated" &&
        Object.keys(message).length === 1
      ) {
        if (site !== "perplexity" || recordedThreadInvalidationToken) return;
        const selectedBinding = selectedCaptureId
          ? captureBindings.get(selectedCaptureId)
          : null;
        const activeBinding = latest?.displayBinding;
        const passiveMatch =
          latestSource === "route" &&
          selectedCaptureId === latestRouteSelectedCaptureId &&
          latest?.recordedThread &&
          isDisplayBinding(latestRouteBinding, null) &&
          matchesDisplayContext(
            latestRouteBinding,
            latest.conversationIdentity ?? null,
            displayContext(),
          );
        const activeMatch =
          selectedCaptureId !== null &&
          latestSource === "active" &&
          latest?.recordedThread?.status === "matched_recorded_subset" &&
          isDisplayBinding(activeBinding, selectedCaptureId) &&
          !!selectedBinding &&
          selectedBinding.captureId === selectedCaptureId &&
          activeBinding.documentNonce === selectedBinding.documentNonce &&
          activeBinding.navigationNonce === selectedBinding.navigationNonce &&
          matchesDisplayContext(
            activeBinding,
            latest.conversationIdentity ?? null,
            displayContext(),
          );
        if (!passiveMatch && !activeMatch) return;
        const panel = shadow?.querySelector<HTMLElement>(".panel");
        const restoreComposerFocus = !!(
          panel &&
          shadow?.activeElement &&
          panel.contains(shadow.activeElement)
        );
        const editor = restoreComposerFocus ? composer()?.editor : null;
        const invalidationToken = {};
        recordedThreadInvalidationToken = invalidationToken;
        routeGeneration++;
        navigationNonce = crypto.randomUUID();
        startEarlierGrace(4000);
        invalidateThreadHistory();
        loadedPath = null;
        routeLoading = false;
        routeFailure = null;
        threadRelationChanged = true;
        clearOwnedDisplay();
        render();
        if (editor instanceof HTMLElement && editor.isConnected)
          editor.focus({ preventScroll: true });
        void loadRecordedRoute(true).finally(() => {
          if (recordedThreadInvalidationToken === invalidationToken)
            recordedThreadInvalidationToken = null;
        });
        return;
      }
      if (
        message?.target === "footprint-calculation-updated" &&
        Object.keys(message).length === 1
      ) {
        // Only a display still waiting for recalculation needs a new totals read.
        if (
          sender.id === browser.runtime.id &&
          siteAccess &&
          latestSource === "route" &&
          latest?.calculationPending === true &&
          parseConversationRoute(site!, location.pathname)
        )
          refreshRecordedRoute();
        return;
      }
      if (
        message?.target === "footprint-display-stale" &&
        Object.keys(message).sort().join(",") ===
          "conversationIdentity,displayBinding,target" &&
        message.conversationIdentity === null
      ) {
        // The observation was saved, but its figures could not be shown after several
        // tries. This is shown until the next display, which clears it.
        const binding = message.displayBinding;
        if (
          sender.id === browser.runtime.id &&
          siteAccess &&
          isDisplayBinding(binding, binding?.captureId) &&
          binding.captureId !== null &&
          binding.captureId === selectedCaptureId &&
          binding.documentNonce === documentNonce &&
          binding.navigationNonce === navigationNonce
        )
          recordPageHealth("aggregate_inconsistent", true, "saved_totals");
        return;
      }
      if (
        message?.target === "footprint-scope-changed" &&
        Object.keys(message).length === 1
      ) {
        restartTracking();
        // Connecting or disconnecting changes the organization named in Details.
        readTrackingState();
        return;
      }
      if (message?.target === "capture-permission-lost") {
        recordedThreadInvalidationToken = null;
        siteAccess = false;
        clearEarlierGrace();
        captureIdentities.clear();
        pendingCapturePromotion = null;
        fileOffers.invalidate();
        invalidateThreadHistory();
        routeGeneration++;
        loadedPath = null;
        routeLoading = false;
        routeFailure = {
          message: "Site access was removed.",
          retryable: false,
        };
        historyFailure = false;
        historyFailureReason = null;
        notebookChatProblem = null;
        notebookChatSeen = false;
        notebookContent = false;
        computerFileFacts.clear();
        window.postMessage(
          { channel: "ai-footprint-control-v1", action: "stop" },
          location.origin,
        );
        recordPageHealth("site_access_removed", true, "permission");
        clearOwnedDisplay();
        render();
        return;
      }
      if (message?.target === "footprint-display-scenario") {
        const parsed = parseDisplayScenario(message.displayScenario);
        if (parsed === null) return;
        displayScenarioOverride = parsed;
        if (latest) render();
        return;
      }
      if (message?.target !== "footprint-display") return;
      if (!siteAccess) return;
      const candidate = pendingPromotion();
      if (
        candidate &&
        isDisplayBinding(message.displayBinding, candidate.binding.captureId) &&
        message.displayBinding.documentNonce ===
          candidate.binding.documentNonce &&
        message.displayBinding.navigationNonce ===
          candidate.binding.navigationNonce &&
        isConversationIdentity(message.conversationIdentity) &&
        message.conversationIdentity.site === site
      ) {
        if (
          candidate.identity &&
          (candidate.identity.site !== message.conversationIdentity.site ||
            candidate.identity.conversationId !==
              message.conversationIdentity.conversationId)
        ) {
          pendingCapturePromotion = null;
          return;
        }
        const identity: ConversationIdentity = {
          ...message.conversationIdentity,
        };
        candidate.identity = identity;
        candidate.display = message;
        const route = parseConversationRoute(site!, location.pathname);
        if (route) {
          if (route.conversationId !== identity.conversationId) {
            pendingCapturePromotion = null;
            return;
          }
          selectedCaptureId = candidate.binding.captureId;
          pendingCapturePromotion = null;
        } else if (
          // At a new ChatGPT chat's local address the reply stays selected
          // (followChatAddress), so its display shows below, and the promotion keeps it
          // for the move to the chat's own address.
          !provisionalChatgptRoute(location.pathname) ||
          selectedCaptureId !== candidate.binding.captureId
        )
          return;
      }
      if (
        !isDisplayBinding(
          message.displayBinding,
          message.displayBinding?.captureId,
        ) ||
        message.displayBinding.captureId === null ||
        !matchesDisplayContext(
          message.displayBinding,
          message.conversationIdentity ?? null,
          displayContext(),
        )
      )
        return;
      const captureId = message.displayBinding.captureId;
      if (
        typeof captureId === "string" &&
        isConversationIdentity(message.conversationIdentity) &&
        message.conversationIdentity.site === site
      ) {
        const captured = captureBindings.get(captureId);
        const previous = captureIdentities.get(captureId);
        if (
          captured &&
          captured.documentNonce === message.displayBinding.documentNonce &&
          captured.navigationNonce === message.displayBinding.navigationNonce
        ) {
          const conflicts =
            previous &&
            (previous.identity === null ||
              previous.identity.site !== message.conversationIdentity.site ||
              previous.identity.conversationId !==
                message.conversationIdentity.conversationId);
          captureIdentities.set(captureId, {
            binding: { ...captured },
            identity: conflicts ? null : { ...message.conversationIdentity },
            scopeGeneration,
          });
          if (!conflicts && newChatCaptures.has(captureId)) {
            unsavedChatsSeen.add(message.conversationIdentity.conversationId);
            if (unsavedChatsSeen.size > 64)
              unsavedChatsSeen.delete(unsavedChatsSeen.values().next().value!);
          }
        }
      }
      routeFailure = null;
      routeLoading = false;
      recoverPageHealthContext("saved_totals");
      if (holdsPreviousFigures(message)) {
        heldDisplay = {
          display: message,
          path: location.pathname,
          navigationNonce,
          scopeGeneration,
        };
        // A steady stream of waiting displays must not postpone the fallback forever.
        if (!holdTimer) holdTimer = setTimeout(releaseHeldDisplay, HOLD_MS);
        render();
        return;
      }
      clearHold();
      applyActiveDisplay(message);
    });
    // Starts this page's tracking again from its current route: after a scope change, and when
    // the person agreed while the page was open, so the open chat is read and counted without
    // a reload.
    function restartTracking() {
      recordedThreadInvalidationToken = null;
      routeGeneration++;
      // A scope change while tracking is off keeps the chat open, and the reply cut off in it.
      const carryWithdrawn = withdrawnReply === navigationNonce;
      navigationNonce = crypto.randomUUID();
      if (carryWithdrawn) withdrawnReply = navigationNonce;
      startEarlierGrace(4000);
      selectedCaptureId = null;
      // Messages of a signed-out chat sent before this restart were not counted in this scope.
      newChatCaptures.clear();
      unsavedChatsSeen.clear();
      scopeGeneration++;
      captureIdentities.clear();
      pendingCapturePromotion = null;
      fileOffers.invalidate();
      invalidateThreadHistory();
      loadedPath = null;
      routeLoading = false;
      routeFailure = null;
      threadRelationChanged = false;
      historyFailure = false;
      historyFailureReason = null;
      notebookChatProblem = null;
      notebookChatSeen = false;
      notebookContent = false;
      computerFileFacts.clear();
      // Another scope, or an erase of this one, has its own closed tips.
      tipStates.clear();
      clearOwnedDisplay();
      render();
      void loadRecordedRoute();
    }
    // Whether the person agreed to tracking (lib/tracking-consent.ts), asked at start, when the
    // background says the agreement changed and after a scope change. Only a valid answer
    // changes anything; a newer question wins over an older answer.
    let trackingStateRead = 0;
    function readTrackingState() {
      const read = ++trackingStateRead;
      void sendToBackground({ target: TRACKING_STATE_TARGET })
        .then((answer) => {
          const state = trackingStateAnswer(answer);
          if (!state || read !== trackingStateRead || extensionStopped) return;
          trackingStateSettled = true;
          const wasOff = trackingOff;
          trackingOff = state.consent === "required";
          organizationLabel = state.organization;
          // Pause and resume only change what the bar and Details show (render below); the
          // background decides what is recorded.
          trackingPaused = state.paused;
          if (wasOff !== trackingOff) {
            if (trackingOff) {
              const now = Date.now();
              withdrawnReply = [...activeCaptureIds].some(
                ([captureId, seenAt]) =>
                  now - seenAt <= CAPTURE_SILENT_MS && !readAloudIds.has(captureId),
              )
                ? navigationNonce
                : null;
              clearOwnedDisplay();
            } else {
              // A reply that was arriving when tracking was turned off sent its later frames
              // nowhere, so only the open chat's saved copy can count it: read it once, as for
              // a lost reply (live QA, 19 Oct 2026, when the bar kept the partial figures
              // until a reload).
              const interrupted = withdrawnReply === navigationNonce;
              withdrawnReply = null;
              activeCaptureIds.clear();
              restartTracking();
              if (interrupted && parseConversationRoute(site!, location.pathname)) {
                lostReplyNavigation = navigationNonce;
                lostReplyUncounted = navigationNonce;
              }
              // The capture watchdog follows the background's answer again.
              probe();
            }
            // A running own read stops; one the agreement held may start now.
            ownRead?.settingChanged();
          }
          render();
        })
        .catch(() => {})
        // The latest question's answer, valid or not, releases a waiting own read and shows
        // the bar. Without a valid answer (a background from before the agreement step) the
        // bar shows as it did then.
        .finally(() => {
          if (read !== trackingStateRead) return;
          trackingStateKnown();
          if (!trackingStateSettled && !extensionStopped) {
            trackingStateSettled = true;
            render();
          }
        });
    }
    readTrackingState();
    function applyActiveDisplay(message: any) {
      // The ended reply's figures published, so the bar no longer waits for them. Only the
      // end frame gives a reply a terminal state; a dispatch or progress display, or one
      // still waiting for its estimate, can arrive after the end and is not final.
      if (
        message.state !== "generating" &&
        message.state !== "dispatch_only" &&
        message.calculationPending !== true
      ) {
        captureEnds.delete(message.displayBinding.captureId);
        finishedCaptures.add(message.displayBinding.captureId);
        if (finishedCaptures.size > 64)
          finishedCaptures.delete(finishedCaptures.values().next().value!);
      }
      latest = message;
      latestPath = location.pathname;
      latestSource = "active";
      latestRouteBinding = null;
      latestRouteSelectedCaptureId = null;
      displayGeneration++;
      mount();
      render();
    }
    /** A display waiting for recalculation keeps complete figures for the same chat. */
    function holdsPreviousFigures(message: any) {
      if (
        message.calculationPending !== true ||
        !latest ||
        latest.calculationPending === true ||
        latestPath !== location.pathname ||
        historyFailure ||
        latest.recordedThread ||
        message.recordedThread ||
        latest.mode !== message.mode ||
        !isConversationIdentity(latest.conversationIdentity) ||
        !isConversationIdentity(message.conversationIdentity) ||
        latest.conversationIdentity.site !== message.conversationIdentity.site ||
        latest.conversationIdentity.conversationId !==
          message.conversationIdentity.conversationId ||
        !latest.history
      )
        return false;
      // The bar is local-first, so this browser's history counts as whole-chat figures too.
      return [latest.summary, latest.conversation?.server].some(
        (summary) =>
          !!summary &&
          selectedHistory(summary, latest.history)?.status === "available",
      );
    }
    function releaseHeldDisplay() {
      holdTimer = null;
      const held = heldDisplay;
      heldDisplay = null;
      if (
        !held ||
        extensionStopped ||
        !siteAccess ||
        held.path !== location.pathname ||
        held.navigationNonce !== navigationNonce ||
        held.scopeGeneration !== scopeGeneration ||
        !matchesDisplayContext(
          held.display.displayBinding,
          held.display.conversationIdentity ?? null,
          displayContext(),
        )
      )
        return;
      applyActiveDisplay(held.display);
    }
    function refreshRecordedRoute() {
      if (
        routeReadGeneration !== null &&
        routeReadGeneration === routeGeneration &&
        loadedPath === location.pathname
      ) {
        routeRefreshAfter = routeGeneration;
        return;
      }
      loadedPath = null;
      void loadRecordedRoute(true);
    }
    const removeOwnedHosts = () => {
      mountController?.abort();
      mountController = null;
      schedulePanelPosition = null;
      root?.remove();
      noticeRoot?.remove();
      root = null;
      noticeRoot = null;
      shadow = null;
      noticeShadow = null;
      mountedComposer = null;
    };
    function mount(recheck = false) {
      if (extensionStopped) return;
      if (
        !recheck &&
        root?.isConnected &&
        noticeRoot?.isConnected &&
        mountedComposer
      )
        return;
      const current = composer();
      const insertionParent = current?.anchor.parentElement;
      if (!current || !insertionParent) {
        if (recheck) removeOwnedHosts();
        return;
      }
      // Wait until the page has set up its composer (signed-out ChatGPT, composerPageReady).
      // Its ready mark reaches the page observer, which scans again; after the start-up wait
      // the bar is placed anyway, as before.
      if (
        !startupWaitOver &&
        !root?.isConnected &&
        !composerPageReady(document, current.anchor, site!)
      )
        return;
      if (
        root?.isConnected &&
        noticeRoot?.isConnected &&
        mountedComposer?.editor === current.editor &&
        mountedComposer.anchor === current.anchor &&
        mountedComposer.insertionParent === insertionParent &&
        root.parentElement === insertionParent &&
        noticeRoot.parentElement === insertionParent
      )
        return;
      removeOwnedHosts();
      root = document.createElement("div");
      ownedHosts.add(root);
      root.dataset.aiFootprint = "information";
      root.style.cssText =
        "position:relative;display:block;max-width:100%;z-index:1;align-self:stretch";
      noticeRoot = document.createElement("div");
      ownedHosts.add(noticeRoot);
      noticeRoot.dataset.aiFootprint = "context-advice";
      noticeRoot.style.cssText =
        "position:relative;display:block;max-width:100%;z-index:1;align-self:stretch";
      shadow = root.attachShadow({ mode: "closed" });
      noticeShadow = noticeRoot.attachShadow({ mode: "closed" });
      mountController = new AbortController();
      const mountSignal = mountController.signal;
      mountedComposer = {
        editor: current.editor,
        anchor: current.anchor,
        insertionParent,
      };
      const styles = `:host{color:var(--aft-ink);font-family:inherit;font-size:12px;line-height:1.45;text-align:start}*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:1px solid var(--aft-border);background:var(--aft-surface);border-radius:5px;min-height:30px;padding:4px 8px}button:focus-visible,a[data-open]:focus-visible,a[data-setup]:focus-visible{outline:2px solid var(--aft-ink);outline-offset:2px}.bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px;padding:6px 4px;color:var(--aft-ink)}.bar [data-metrics]{grid-column:1;grid-row:1;min-width:0;overflow-wrap:anywhere}.bar [data-open],.bar [data-setup]{grid-column:2;grid-row:1;text-decoration:underline;text-underline-offset:3px;white-space:nowrap}.bar [hidden],.bar[hidden]{display:none}.notice{background:var(--aft-warning);color:var(--aft-warning-ink);padding:9px 10px;margin:6px 0;border-radius:6px;display:flex;gap:8px;align-items:center;font-size:13px}.notice span{flex:1}.notice [data-dismiss]{align-self:flex-start;border:0;background:transparent;min-width:24px;min-height:24px;padding:0 4px;margin:-4px -4px 0 0;font-size:16px;line-height:1}.panel{position:absolute;bottom:calc(100% + 6px);right:0;width:min(520px,calc(100vw - 28px));max-height:var(--aft-panel-max-height,460px);min-width:0;overflow:auto;background:var(--aft-surface);border:1px solid var(--aft-border);border-radius:10px;padding:18px;box-shadow:0 8px 30px #0003;font-size:13px;z-index:2}.panel[data-placement="below"]{top:calc(100% + 6px);bottom:auto}.panel[hidden],.notice[hidden]{display:none}h2{font-size:17px;margin:0 0 12px}h3{font-size:14px;margin:16px 0 6px}h4{font-size:13px;margin:12px 0 4px}p{margin:8px 0}dl{display:grid;grid-template-columns:1fr auto;gap:7px 12px;margin:10px 0}dt,dd{margin:0}.close{float:right}progress{width:100%;height:10px;accent-color:#8A5A16}.muted{opacity:.85}.state{border-top:1px solid var(--aft-border);padding-top:10px}a{color:inherit}summary{cursor:pointer}.panel [data-body],.panel dl,.panel dt,.panel dd,.panel p,.panel strong,.panel h2,.panel h3,.panel h4{min-width:0;max-width:100%;overflow-wrap:anywhere}.panel dl{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}`;
      const style = document.createElement("style");
      style.textContent = styles + DETAILS_STYLES;
      shadow.append(style);
      const noticeStyle = document.createElement("style");
      noticeStyle.textContent = styles;
      noticeShadow.append(noticeStyle);
      const notice = document.createElement("div");
      notice.className = "notice";
      notice.hidden = true;
      notice.innerHTML =
        '<span>Long chat · for a new topic, consider a fresh conversation.</span><button type="button" data-open>Details</button><button type="button" data-dismiss aria-label="Close tip" title="Close tip">×</button>';
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.innerHTML =
        '<span data-status hidden></span><span data-metrics></span><a href="#ai-footprint-conversation-details" data-open aria-controls="ai-footprint-conversation-details" aria-expanded="false">Details</a><a href="#ai-footprint-set-up" data-setup hidden></a>';
      // Tracking is off until the person agrees; Set up opens the welcome page (18 Oct 2026).
      const setUp = bar.querySelector<HTMLAnchorElement>("[data-setup]")!;
      setUp.textContent = BAR_SET_UP;
      setUp.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          void sendToBackground({ target: OPEN_WELCOME_TARGET }).catch(() => {});
        },
        { signal: mountSignal },
      );
      // The bar is never empty, also before render() below has run, and shows no state before
      // the background said whether the person agreed (trackingStateSettled).
      bar.querySelector("[data-metrics]")!.textContent = trackingOff
        ? BAR_TRACKING_OFF
        : barStateText(barActivity());
      bar.hidden = !trackingStateSettled;
      if (trackingOff) {
        setUp.hidden = false;
        bar.querySelector<HTMLElement>("a[data-open]")!.hidden = true;
      }
      const panel = document.createElement("section");
      panel.className = "panel";
      panel.id = "ai-footprint-conversation-details";
      panel.hidden = true;
      panel.setAttribute("aria-label", "AI footprint details");
      panel.innerHTML =
        '<div class="dt-head"><div><h2>This chat</h2><p class="dt-sub" data-sub></p></div><button type="button" class="close" data-close aria-label="Close details"></button></div><div data-body></div><p class="dt-progress" data-progress-line role="status"></p><div class="dt-sync-row" data-sync-row></div><p class="dt-local" data-local-line></p><p class="dt-credit">Designed and built by <a href="https://www.linkedin.com/in/pranitnale/" target="_blank" rel="noopener noreferrer">Pranit Nale</a></p>';
      panel
        .querySelector("[data-close]")!
        .append(detailsIcon(document, "close", 16));
      noticeShadow.append(notice);
      shadow.append(bar, panel);
      const opens = [
        ...noticeShadow.querySelectorAll<HTMLButtonElement>("[data-open]"),
        ...shadow.querySelectorAll<HTMLAnchorElement>("[data-open]"),
      ];
      let lastDetailsTrigger: HTMLElement | null = null;
      const positionDetailsPanel = () => {
        // The nearest containers that clip their content bound the room as well as the window.
        const visible = { top: 0, bottom: innerHeight };
        let depth = 0;
        for (
          let element = root!.parentElement;
          element && element !== document.body && depth < 40;
          element = element.parentElement, depth++
        ) {
          const overflow = getComputedStyle(element).overflowY;
          if (overflow === "visible") continue;
          const box = element.getBoundingClientRect();
          visible.top = Math.max(visible.top, box.top);
          visible.bottom = Math.min(visible.bottom, box.bottom);
        }
        const placement = detailsPanelPlacement(
          root!.getBoundingClientRect(),
          innerHeight,
          visible,
        );
        const maxHeight = `${placement.maxHeight}px`;
        if (panel.dataset.placement !== placement.placement)
          panel.dataset.placement = placement.placement;
        stackDetails(true);
        if (
          panel.style.getPropertyValue("--aft-panel-max-height") !== maxHeight
        )
          panel.style.setProperty("--aft-panel-max-height", maxHeight);
      };
      let positionRequest: number | ReturnType<typeof setTimeout> | null = null;
      let positionRequestKind: "frame" | "timer" | null = null;
      const repositionWhenOpen = () => {
        if (panel.hidden || positionRequest !== null) return;
        const apply = () => {
          positionRequest = null;
          positionRequestKind = null;
          if (!panel.hidden && root?.isConnected) positionDetailsPanel();
        };
        if (typeof window.requestAnimationFrame === "function") {
          positionRequestKind = "frame";
          positionRequest = window.requestAnimationFrame(apply);
        } else {
          positionRequestKind = "timer";
          positionRequest = setTimeout(apply, 0);
        }
      };
      schedulePanelPosition = repositionWhenOpen;
      window.addEventListener("resize", repositionWhenOpen, {
        signal: mountSignal,
      });
      document.addEventListener("scroll", repositionWhenOpen, {
        capture: true,
        signal: mountSignal,
      });
      // The bar and notice line up with the composer they follow. Gemini insets its narrow
      // composer with side margins, so the bar ran to the window edges (12 October 2026).
      const anchor = current.anchor;
      const alignToComposer = () => {
        const style = getComputedStyle(anchor);
        for (const host of [root, noticeRoot]) {
          if (!host) continue;
          if (host.style.marginLeft !== style.marginLeft)
            host.style.marginLeft = style.marginLeft;
          if (host.style.marginRight !== style.marginRight)
            host.style.marginRight = style.marginRight;
        }
      };
      alignToComposer();
      const resizeObserver =
        typeof window.ResizeObserver === "function"
          ? new window.ResizeObserver(() => {
              alignToComposer();
              repositionWhenOpen();
            })
          : null;
      resizeObserver?.observe(root);
      resizeObserver?.observe(current.anchor);
      resizeObserver?.observe(insertionParent);
      mountSignal.addEventListener("abort", () => {
        resizeObserver?.disconnect();
        if (positionRequest !== null) {
          if (positionRequestKind === "frame")
            window.cancelAnimationFrame(positionRequest as number);
          else clearTimeout(positionRequest);
        }
        positionRequest = null;
        positionRequestKind = null;
      });
      const close = (restore: boolean) => {
        panel.hidden = true;
        stackDetails(false);
        openSections.clear();
        comparison = null;
        opens.forEach((b) => b.setAttribute("aria-expanded", "false"));
        if (restore) lastDetailsTrigger?.focus();
      };
      opens.forEach((b) =>
        b.addEventListener("click", (event) => {
          event.preventDefault();
          lastDetailsTrigger = b;
          if (panel.hidden) positionDetailsPanel();
          panel.hidden = !panel.hidden;
          if (!panel.hidden) repositionWhenOpen();
          opens.forEach((button) =>
            button.setAttribute("aria-expanded", String(!panel.hidden)),
          );
          if (panel.hidden) {
            stackDetails(false);
            openSections.clear();
            comparison = null;
            return;
          }
          // The long-chat notice opens Details at its explanation.
          if (noticeShadow?.contains(b)) openSections.add("context");
          void loadComparison();
          render();
          // Details opens at its top, or at the chat length explanation from the long-chat
          // notice. Without this the panel kept a scroll offset and opened at its bottom, with
          // the figures out of view (seen live on 15 October 2026).
          const section = openSections.has("context")
            ? panel.querySelector<HTMLElement>('[data-section="context"]')
            : null;
          const head = panel.querySelector<HTMLElement>(".dt-head");
          panel.scrollTop = section
            ? Math.max(0, section.offsetTop - (head?.offsetHeight ?? 0))
            : 0;
        }),
      );
      shadow
        .querySelectorAll("[data-close]")
        .forEach((b) => b.addEventListener("click", () => close(true)));
      const dismiss =
        noticeShadow.querySelector<HTMLButtonElement>("[data-dismiss]")!;
      // The tip sits next to the site's composer, so the cross keeps its pointer, mouse and
      // key events from the site's own handlers. Its click still closes the tip.
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "click",
        "keydown",
        "keyup",
        "keypress",
      ])
        dismiss.addEventListener(type, (event) => event.stopPropagation(), {
          signal: mountSignal,
        });
      // One click closes the tip of this chat for good; other chats still show theirs.
      dismiss.addEventListener(
        "click",
        () => {
          const focused = noticeShadow?.activeElement === dismiss;
          notice.hidden = true;
          changeTip("close");
          if (latest?.guidance?.key)
            void sendToBackground({
              target: "dismiss-advice",
              key: latest.guidance.key,
            });
          // A keyboard user keeps a place to continue from instead of the page's start.
          if (focused) shadow?.querySelector<HTMLElement>("[data-open]")?.focus();
        },
        { signal: mountSignal },
      );
      document.addEventListener(
        "pointerdown",
        (event) => {
          // Closed shadow roots retarget internal pointer events to the host.
          if (!panel.hidden && !event.composedPath().includes(root!))
            close(false);
        },
        { signal: mountSignal },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape" && !panel.hidden) close(true);
        },
        { signal: mountSignal },
      );
      placeFootprintHosts(current.anchor, noticeRoot, root);
      adaptTheme(current);
      render();
      void loadRecordedRoute();
    }
    /** Reads how this chat compares with the others, once per opening of Details. */
    async function loadComparison() {
      const path = location.pathname;
      const route = parseConversationRoute(site!, path);
      if (!route || extensionStopped || !siteAccess) {
        comparison = null;
        return;
      }
      const current = { path, state: { state: "loading" } as ComparisonState };
      comparison = current;
      // A comparison that does not answer within 10 seconds counts as failed.
      const result = await requestComparison(
        () =>
          sendToBackground({
            target: "chat-comparison",
            conversationId: route.conversationId,
          }),
        { signal: controller.signal },
      );
      if (extensionStopped) return;
      const next: ComparisonState = result
        ? { state: "ready", result }
        : { state: "failed" };
      if (comparison !== current || location.pathname !== path) return;
      comparison = { path, state: next };
      render();
    }
    async function loadRecordedRoute(replaceRecorded = false) {
      if (extensionStopped) return;
      const path = location.pathname;
      const route = parseConversationRoute(site!, path);
      if (!route || !siteAccess || loadedPath === path) return;
      // An active capture display always wins over saved totals, so a read now would
      // be discarded. Retry after a failure still reads.
      if (
        latest &&
        latestSource === "active" &&
        latestPath === path &&
        !routeFailure
      )
        return;
      loadedPath = path;
      // Ready well before an own read of a long ChatGPT chat can start.
      loadChatgptProgress();
      const generation = ++routeGeneration;
      routeReadGeneration = generation;
      const selectedAtQuery = selectedCaptureId;
      const queryBinding: DisplayBinding = {
        documentNonce,
        navigationNonce,
        captureId: null,
      };
      routeLoading = true;
      routeFailure = null;
      render();
      try {
        const result = await sendToBackground({
          target: "conversation-summary",
          conversationId: route.conversationId,
          binding: queryBinding,
        });
        if (generation !== routeGeneration || location.pathname !== path)
          return;
        // A queued refresh replaces this read, so the loading state stays until it runs.
        const refreshing = routeRefreshAfter === generation;
        routeLoading = refreshing;
        const permissionLost = result?.error === "Site access was removed.";
        if (permissionLost) {
          siteAccess = false;
          captureIdentities.clear();
          pendingCapturePromotion = null;
          fileOffers.invalidate();
          clearOwnedDisplay();
          routeFailure = {
            message: "Site access was removed.",
            retryable: false,
          };
          recordPageHealth("site_access_removed", true, "permission");
          loadedPath = null;
          render();
          return;
        }
        if (
          selectedCaptureId !== selectedAtQuery ||
          (latest && (!replaceRecorded || latestSource === "active"))
        ) {
          render();
          return;
        }
        if (result?.target === "footprint-display") {
          if (
            !isDisplayBinding(result.displayBinding, null) ||
            !matchesDisplayContext(
              result.displayBinding,
              result.conversationIdentity ?? null,
              displayContext(),
            )
          ) {
            loadedPath = null;
            if (refreshing) return;
            routeFailure = {
              message: "Recorded conversation totals could not be loaded.",
              retryable: true,
            };
            recordPageHealth("payload_rejected", true, "saved_totals");
            render();
            return;
          }
          routeFailure = null;
          recoverPageHealthContext("saved_totals");
          latest = result;
          latestPath = path;
          latestSource = "route";
          latestRouteBinding = { ...result.displayBinding };
          latestRouteSelectedCaptureId = selectedAtQuery;
          displayGeneration++;
          render();
          return;
        }
        loadedPath = null;
        if (refreshing) return;
        routeFailure = {
          message:
            result?.error === "Recorded conversation totals are unavailable."
              ? result.error
              : "Recorded conversation totals could not be loaded.",
          retryable: true,
        };
        recordPageHealth(
          result?.code ?? "conversation_summary_unavailable",
          true,
          "saved_totals",
        );
        render();
      } catch {
        if (generation !== routeGeneration || location.pathname !== path)
          return;
        const refreshing = routeRefreshAfter === generation;
        routeLoading = refreshing;
        loadedPath = null;
        if (refreshing) return;
        routeFailure = {
          message: "Recorded conversation totals could not be loaded.",
          retryable: true,
        };
        recordPageHealth(
          "conversation_summary_unavailable",
          true,
          "saved_totals",
        );
        render();
      } finally {
        if (routeReadGeneration === generation) routeReadGeneration = null;
        if (routeRefreshAfter === generation) {
          routeRefreshAfter = null;
          if (
            !extensionStopped &&
            siteAccess &&
            generation === routeGeneration &&
            location.pathname === path
          ) {
            loadedPath = null;
            void loadRecordedRoute(true);
            // The refresh is skipped when an active display already shows newer figures.
            if (routeReadGeneration === null && routeLoading) {
              routeLoading = false;
              render();
            }
          }
        }
      }
    }
    function adaptTheme(current: { editor: Element; anchor: Element }) {
      if (!root || !noticeRoot) return;
      const form = current.anchor;
      const style = getComputedStyle(form);
      // NotebookLM and, since October 2026, Gemini set their font on each control, not on
      // the page, so the composer box has the browser's default serif; the editor carries
      // the site's font.
      const font = getComputedStyle(
        site === "notebooklm" || site === "gemini" ? current.editor : form,
      ).fontFamily;
      let surface = style.backgroundColor;
      let element: Element | null = form;
      for (
        let i = 0;
        i < 6 && (surface === "rgba(0, 0, 0, 0)" || surface === "transparent");
        i++
      ) {
        element = element?.parentElement ?? null;
        if (element) surface = getComputedStyle(element).backgroundColor;
      }
      const text = style.color;
      const channels = text.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const dark = channels.reduce((a, b) => a + b, 0) > 450;
      // Details uses its own palette in the page's light or dark scheme; the bar keeps the page colours.
      root.dataset.aftTheme = dark ? "dark" : "light";
      root.style.setProperty("--aft-ink", text);
      root.style.setProperty(
        "--aft-surface",
        surface === "rgba(0, 0, 0, 0)"
          ? dark
            ? "#242424"
            : "#ffffff"
          : surface,
      );
      root.style.setProperty("--aft-border", dark ? "#777777" : "#a5a5a5");
      root.style.setProperty("--aft-warning", dark ? "#4c3b19" : "#fff0c4");
      root.style.setProperty("--aft-warning-ink", dark ? "#fff0c4" : "#53380b");
      root.style.fontFamily = font;
      for (const property of [
        "--aft-ink",
        "--aft-surface",
        "--aft-border",
        "--aft-warning",
        "--aft-warning-ink",
      ])
        noticeRoot.style.setProperty(
          property,
          root.style.getPropertyValue(property),
        );
      noticeRoot.style.fontFamily = font;
    }
    const quantity = (value: string | null | undefined, unit = "") =>
      unit && unit !== "tokens"
        ? formatMetric(value, unit)
        : `${formatInteger(value)}${unit ? " " + unit : ""}`;
    // The synced copy's figures in the local bar's form: In and Out, then resources added when
    // calculated alike. Which copy is synced is said in Details only (owner, 13 Oct 2026).
    const serverBarText = (summary: any) => {
      const tokens = (side: "input" | "output") => {
        const value = serverTokenTotal(summary.tokens, side);
        return value === null ? "Unknown" : `≈ ${formatInteger(value)}`;
      };
      return `Req ${quantity(summary.request_count)} · ${tokenPairText(tokens("input"), tokens("output"))} · Electricity ${serverResourceText(summary.resources, "energy", displayScenario())} · Carbon ${serverResourceText(summary.resources, "carbon", displayScenario())} · ${serverWaterText(summary.resources, displayScenario())}`;
    };
    /**
     * Until when the open chat's newest request waits for its final figures: while its
     * capture runs, and after its end until the display with its estimate arrives. Each wait
     * ends on its own (CAPTURE_SILENT_MS, DISPLAY_WAIT_MS), so a request whose figures never
     * come stops waiting. 0 when nothing waits.
     */
    const requestWaitUntil = () => {
      // ChatGPT's new chat keeps its reply as a pending promotion across its provisional
      // address, so the request stays pending through both moves.
      const captureId =
        selectedCaptureId ?? pendingPromotion()?.binding.captureId ?? null;
      if (
        captureId === null ||
        finishedCaptures.has(captureId) ||
        pausedCaptures.has(captureId)
      )
        return 0;
      const seenAt = activeCaptureIds.get(captureId);
      const endedAt = captureEnds.get(captureId);
      const until = Math.max(
        seenAt === undefined ? 0 : seenAt + CAPTURE_SILENT_MS,
        endedAt === undefined ? 0 : endedAt + DISPLAY_WAIT_MS,
      );
      const now = Date.now();
      if (until <= now) return 0;
      scheduleBarRecheck(until - now);
      return until;
    };
    /** Until when a guide of the open notebook waits for its figures (guideWaits); 0 when none. */
    const guideWaitUntil = () => {
      const now = Date.now();
      let until = 0;
      for (const [captureId, wait] of guideWaits)
        if (wait.until <= now || pausedCaptures.has(captureId))
          guideWaits.delete(captureId);
        else if (wait.navigation === navigationNonce)
          until = Math.max(until, wait.until);
      if (until) scheduleBarRecheck(until - now);
      return until;
    };
    /**
     * What the bar shows before the open chat has figures (owner decision of 14 Oct 2026,
     * afternoon). Working covers everything that can still bring this chat's first figures;
     * each signal ends on its own (a capture's end and DISPLAY_WAIT_MS, a send's
     * SEND_WAIT_MS, an import's lifecycle limit, the own read's reply limit, the three
     * calculation checks), so a chat that cannot be counted leaves Processing for No figures
     * yet instead of staying on it.
     */
    function barActivity(): BarActivity {
      // Nothing more is counted on this page until it reloads or access returns.
      if (extensionStopped || !siteAccess) return { working: false, started: true };
      const now = Date.now();
      const route = parseConversationRoute(site!, location.pathname);
      const captureId =
        selectedCaptureId ?? pendingPromotion()?.binding.captureId ?? null;
      const replying = requestWaitUntil() > 0 || guideWaitUntil() > 0;
      const sent = composerSent?.navigation === navigationNonce;
      const sending = sent && composerSent!.at + SEND_WAIT_MS > now;
      if (sending) scheduleBarRecheck(composerSent!.at + SEND_WAIT_MS - now);
      const importing =
        waitingHistorical.size > 0 ||
        [...historicalBindings.values()].some(currentHistoricalCapture) ||
        [...historyBindings.values()].some(currentThreadHistory);
      // An opened chat waits a few seconds for the provider's own read of it, unless that read
      // already came and was refused. A notebook may be empty, so NotebookLM shows Waiting for
      // your request until a read arrives.
      const awaitingRead =
        !!route &&
        site !== "notebooklm" &&
        !historyFailure &&
        earlierImport === "none" &&
        earlierGraceTimer !== null;
      const calculationChecksLeft =
        calculationCheck?.nonce !== navigationNonce ||
        calculationCheck.timer !== null ||
        calculationCheck.tries < 3;
      const calculating =
        !!latest &&
        latestPath === location.pathname &&
        latest.calculationPending === true &&
        !historyFailure &&
        calculationChecksLeft;
      const started =
        captureId !== null ||
        sent ||
        (site === "notebooklm"
          ? notebookChatSeen ||
            notebookContent ||
            notebookChatProblem !== null ||
            historyFailure
          : !!route);
      // On NotebookLM the tracker's own read only checks whether the notebook has a saved
      // chat, so an empty notebook stays on Waiting for your request; turns it finds are
      // imported, which shows Processing. The page's read of the notebook and the
      // saved-totals read show Processing only once the notebook has shown content.
      const ownReading =
        (ownReadAsked || ownRead?.progress(navigationNonce) != null) &&
        (site !== "notebooklm" || started);
      const notebookKnown = site !== "notebooklm" || started;
      // While tracking is paused nothing new is recorded: a reply, a send, a history read or
      // import and the tracker's own read bring no figures, so they never show Processing
      // (live, 21 Oct 2026). Reading and recalculating the chat's saved figures still may.
      if (trackingPaused)
        return {
          working: (routeLoading && notebookKnown) || calculating,
          started,
        };
      return {
        working:
          replying ||
          sending ||
          (importing && notebookKnown) ||
          awaitingRead ||
          (routeLoading && notebookKnown) ||
          ownReading ||
          calculating,
        started,
      };
    }
    // The bar shows figures only (owner, 14 Oct 2026). Until this navigation has figures it
    // shows one short state (barActivity), and while anything updates the last figures stay,
    // so the bar never flickers through sentences or drops back to Req 0.
    const showFigures = (
      metrics: Element,
      text: string | null,
      guideOnly = false,
    ) => {
      const requests = /^Req (?:≈ )?([0-9][0-9,.\u202f\u00a0 ]*)/.exec(text ?? "")?.[1];
      // A pending request's displays mix its partial values with older ones, so the bar
      // keeps the last complete figures, or Processing, until its final figures arrive
      // (owner decision 1a of 14 Oct 2026). A notebook whose only counted work is its guide
      // shows the guide's figures with Req 0 (notebookGuideOnly, owner decision of 16 Oct 2026).
      if (
        text &&
        requests &&
        (Number(requests.replace(/[^0-9]/g, "")) > 0 || guideOnly) &&
        !requestWaitUntil()
      )
        shownFigures = {
          navigation: navigationNonce,
          path: location.pathname,
          text,
        };
      metrics.textContent =
        shownFigures?.navigation === navigationNonce &&
        shownFigures.path === location.pathname
          ? shownFigures.text
          : barStateText(barActivity());
    };
    const retryRoute = () => {
      if (!routeFailure?.retryable || routeLoading || !siteAccess) return;
      loadedPath = null;
      void loadRecordedRoute();
    };
    function render() {
      if (!shadow || !noticeShadow) return;
      followChatAddress();
      if (latest && latestPath !== location.pathname) clearOwnedDisplay();
      ownReadAsked = false;
      ownReadWanted = false;
      // Before the person agreed the bar shows only Tracking is off and Set up, the one state
      // the owner allowed beside the figures (18 Oct 2026). Details stays closed and no read is
      // asked for. A stopped extension keeps its Reload required below.
      const setUp = shadow.querySelector<HTMLElement>("[data-setup]");
      const detailsLink = shadow.querySelector<HTMLElement>("a[data-open]");
      // No state shows until the background said whether the person agreed (trackingStateSettled).
      const barRow = shadow.querySelector<HTMLElement>(".bar");
      if (barRow) barRow.hidden = !trackingStateSettled && !extensionStopped;
      const off = trackingOff && !extensionStopped;
      if (setUp) setUp.hidden = !off;
      if (detailsLink) detailsLink.hidden = off;
      if (off) {
        shownFigures = null;
        shadow.querySelector("[data-metrics]")!.textContent = BAR_TRACKING_OFF;
        setBarStatus("", shadow);
        const panel = shadow.querySelector<HTMLElement>(".panel");
        if (panel && !panel.hidden) {
          panel.hidden = true;
          stackDetails(false);
          detailsLink?.setAttribute("aria-expanded", "false");
        }
        noticeShadow.querySelector<HTMLElement>(".notice")!.hidden = true;
        return;
      }
      // One line at the bottom of Details says where the figures were made (17 Oct 2026).
      const localLine = shadow.querySelector<HTMLElement>("[data-local-line]");
      if (localLine) {
        const text = localDetailsText(organizationLabel);
        const lead = document.createElement("b");
        lead.textContent = text.lead;
        localLine.replaceChildren(lead, ` ${text.rest}`);
      }
      // The history reader refused the page's read of this chat: read it once more with the
      // tracker's own request, unless that is the same request (checked in the page world).
      if (
        pageReadRefused() &&
        !extensionStopped &&
        parseConversationRoute(site!, location.pathname)
      )
        requestOwnRead("rejected");
      // A shown reply whose frames never reached the background: its saved copy counts it.
      // The scheduler makes one read per navigation at most, so asking again only keeps the
      // bar's Processing while that read runs.
      if (lostReplyNavigation === navigationNonce && !extensionStopped)
        requestOwnRead("lost_reply");
      const metrics = shadow.querySelector("[data-metrics]")!;
      let body = shadow.querySelector("[data-body]")!;
      const detailsRoot = body;
      const detailsSub = shadow.querySelector<HTMLElement>("[data-sub]")!;
      // Details opens with the bar's state in plain words (canvas BarStatusSheet). Statuses the
      // bar leaves out go in a collapsible section with a warning header, placed before the
      // page health notes, with the figures that were counted (owner, 13 Oct 2026).
      const syncRow = shadow.querySelector<HTMLElement>("[data-sync-row]");
      syncRow?.replaceChildren();
      // The open chat's saved history, set once the figures are known, for noFiguresNote.
      let noFiguresHistory: any = null;
      // Replies of the open chat stopped before any answer was written, for stoppedRepliesStatus.
      let stoppedReplies = 0;
      const showStatuses = (before: Node | null = null, counted = "") => {
        const label = shadow!.querySelector<HTMLElement>("[data-status]")!;
        const groups = detailsStatusGroups(
          label.dataset.actionable ?? "",
          label.dataset.details ?? "",
        );
        // A read "Load full chat history" held: Details says what works instead and offers to turn
        // it on (owner decision of 17 Oct 2026). Like every status, it never reaches the bar.
        const off = ownReadWanted ? ownRead?.off(navigationNonce) : null;
        if (off)
          groups.bar.push(
            ownReadOffStatus(
              off.key,
              off.mode,
              groups.bar.some((status) => status.reload),
              ownReadMainOff.get(off.key) === true,
            ),
          );
        detailsRoot.prepend(
          ...statusNodes(
            document,
            groups.bar,
            () => location.reload(),
            retryRoute,
            openSettings,
          ),
        );
        const progress = shadow!.querySelector<HTMLElement>("[data-progress-line]");
        if (progress)
          progress.textContent = progressText(
            (label.dataset.progress ?? "").split(" · ").filter(Boolean),
            ownRead?.progress(navigationNonce) ?? null,
          );
        // A failed own read names its reason with what was not counted, never on the bar. A read
        // of the whole chat the page made and the tracker counted after it answers what it was
        // for: after agreeing again mid-reply the own read failed (most likely because the reply
        // was still being written), claude.ai read the chat when the reply ended, the figures were
        // complete, yet Details said the chat could not be read (live QA, 19 Oct 2026). Only a
        // read for older messages than the page loads (after_import) stays failed.
        const ownReadNote = ownRead?.note(navigationNonce);
        const ownReadSettled = ownRead?.settled(navigationNonce);
        const answeredLater =
          !!ownReadSettled &&
          ownReadSettled.mode !== "after_import" &&
          earlierImportAt !== null &&
          earlierImportAt >= ownReadSettled.at;
        if (ownReadNote?.failed && !answeredLater)
          groups.notCounted.push({
            chip: "Earlier messages not read",
            text: ownReadNote.text,
            tone: "warn",
          });
        const chatNote =
          site === "notebooklm" ? notebookChatProblemNote(notebookChatProblem) : null;
        if (chatNote) groups.notCounted.push(chatNote);
        const stopped = stoppedRepliesStatus(stoppedReplies, siteName());
        if (stopped) groups.notCounted.push(stopped);
        // While paused the bar never shows Processing, so Details names the reason first
        // (live, 21 Oct 2026).
        if (trackingPaused) groups.notCounted.unshift(trackingPausedStatus());
        // A chat without figures always says why (owner, 14 Oct 2026).
        if (
          !groups.notCounted.length &&
          !groups.bar.length &&
          metrics.textContent === BAR_NO_FIGURES
        )
          groups.notCounted.push(noFiguresNote(noFiguresHistory, siteName()));
        if (!groups.notCounted.length) return;
        const heading = notCountedHeading(groups.notCounted);
        const made = disclosure(document, {
          id: "not-counted",
          title: heading.title,
          summary: heading.summary,
          tone: "warn",
          open: openSections.has("not-counted"),
          onToggle: (open) => {
            if (open) openSections.add("not-counted");
            else openSections.delete("not-counted");
          },
        });
        made.body.append(...notCountedNodes(document, groups.notCounted, counted));
        detailsRoot.insertBefore(made.box, before);
      };
      const captureStatus = watchdog.status(Date.now());
      const coverageUnverified =
        siteAccess &&
        captureStatus.listener === "active" &&
        captureStatus.interception === "unverified";
      const paragraph = (text: string) => {
        const p = document.createElement("p");
        p.textContent = text;
        body.append(p);
      };
      // A Claude Cowork session reports exact usage, so its notes differ (W5).
      const surface =
        site === "claude" &&
        isCoworkSessionId(
          parseConversationRoute(site, location.pathname)?.conversationId,
        )
          ? "cowork"
          : site;
      const appendSection = (title: string, lines: readonly string[]) => {
        if (!lines.length) return;
        const heading = document.createElement("h3");
        heading.textContent = title;
        body.append(heading);
        for (const line of lines) paragraph(line);
      };
      if (extensionStopped) {
        shownFigures = null;
        metrics.textContent = barStateText(barActivity());
        setBarStatus("Reload required", shadow);
        body.replaceChildren();
        paragraph(
          "The extension's connection to this page ended. Reload this page to reconnect. Previous conversation figures have been cleared.",
        );
        detailsSub.textContent = "";
        showStatuses();
        noticeShadow.querySelector<HTMLElement>(".notice")!.hidden = true;
        return;
      }
      const appendPageHealth = () => {
        if (!pageHealth.size) return;
        const summary = pageHealthSummary(pageHealth.values());
        const heading = document.createElement("h3");
        heading.textContent = "Page tracking health";
        body.append(heading);
        const includesObservationFailure = [...pageHealth.values()].some(
          (issue) => issue.context === "capture",
        );
        paragraph(
          summary.active
            ? `${summary.status}. Each issue below says whether it affects page observation or only the saved totals shown.`
            : includesObservationFailure
              ? `${summary.status}. These causes are no longer detected, but any observation missed at the time remains unrecovered.`
              : `${summary.status}. These saved-total read problems are no longer detected. They did not create AI requests or change saved observations.`,
        );
        for (const issue of pageHealth.values()) {
          const message =
            issue.context === "saved_totals"
              ? pageHealthMessage("conversation_summary_unavailable")
              : issue.code === "capture_hook_missing"
                ? {
                    title: "Capture coverage failed",
                    effect:
                      captureStatus.interception === "missed"
                        ? "A chat request on this page reached the network without passing the tracker, so its reply is not counted."
                        : "Capture coverage could not be verified during the affected period. Activity may be missing.",
                    action:
                      "Reload the page. If it continues, the site may need a tracker update.",
                  }
                : pageHealthMessage(issue.code);
          const title = document.createElement("strong");
          title.textContent = message.title;
          body.append(title);
          paragraph(
            `${issue.active ? "Current problem" : "Earlier problem"}. ${message.effect} ${message.action}`,
          );
          const facts = document.createElement("dl");
          for (const [label, value] of [
            ["Diagnostic code", issue.code],
            [
              "Affected operation",
              issue.context === "saved_totals"
                ? "Reading saved conversation totals"
                : issue.context === "permission"
                  ? "Site permission"
                  : issue.context === "status"
                    ? "Tracking status check"
                    : "Page observation",
            ],
            ["Occurrences", formatInteger(issue.count)],
            [
              "First detected",
              formatDateTime(new Date(issue.firstAt).toISOString()),
            ],
            [
              "Last detected",
              formatDateTime(new Date(issue.lastAt).toISOString()),
            ],
          ]) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value;
            facts.append(dt, dd);
          }
          body.append(facts);
        }
      };
      const appendCaptureCoverage = () => {
        if (!coverageUnverified) return;
        const heading = document.createElement("h3");
        heading.textContent = "Capture coverage unverified";
        body.append(heading);
        paragraph(
          "Other code on this page, such as the site's own monitoring script or another extension, wraps the page's network requests after the tracker's listener, and the tracker could not compare the page's finished requests with the ones it received. The tracker cannot check that every later request still reaches its listener. This is coverage uncertainty, not a recording failure.",
        );
        const facts = document.createElement("dl");
        for (const [label, value] of [
          ["Capture listener", "Active"],
          [
            "Live operation observed",
            captureStatus.lastCapturedAt === null ? "No" : "Yes",
          ],
          ["Future request path", "Unverified"],
        ]) {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          facts.append(dt, dd);
        }
        body.append(facts);
        if (captureStatus.lastCapturedAt !== null)
          paragraph(
            "An observed operation proves only that operation reached the listener. It does not verify the path of later requests.",
          );
      };
      // A current tracking problem stays on the bar only with an action the person can take.
      const trackingAction = trackingProblemAction(
        pageHealth.values(),
        !!routeFailure?.retryable && siteAccess,
      );
      if (!latest) {
        const tracking = siteAccess && pageHealthAffectsStatus();
        setBarStatus(
          [
            tracking ? "Tracking problem" : "",
            !siteAccess
              ? "Site access removed"
              : threadRelationChanged
                ? "Recorded match changed"
                : routeLoading
                  ? "Loading conversation totals"
                  : routeFailure
                    ? "Conversation totals unavailable"
                    : historyFailure
                      ? historyTooLarge()
                        ? "History too large"
                        : "History calculation unavailable"
                      : "",
            unsavedEarlierMissed() ? UNSAVED_EARLIER : "",
          ]
            .filter(Boolean)
            .join(" · "),
          shadow,
          { site, trackingAction },
        );
        // Without site access the tracker stops, so earlier figures are not kept.
        if (!siteAccess) shownFigures = null;
        showFigures(metrics, null);
        const explanation = threadRelationChanged
          ? "The previous matched view was cleared because its saved matches conflicted with company records. Only a freshly loaded recorded subset can be shown."
          : routeFailure
            ? routeFailure.retryable
              ? `${routeFailure.message} Retry reads saved numerical usage only and does not create a request or interact with chat controls.`
              : "Site access was removed. Restore the browser permission and reload this page to resume tracking."
            : historyFailure
              ? "History text remains local and was not stored. Reloading or loading another supported history page can retry the numerical import without creating a generation request."
              : "This profile records newly observed requests separately. Earlier conversation messages are counted only when supported history data loads; until then their usage is unknown. Hidden reasoning, server context and unverified media processing remain unknown.";
        body.replaceChildren();
        paragraph(explanation);
        appendCaptureCoverage();
        appendPageHealth();
        detailsSub.textContent = "";
        showStatuses();
        return;
      }
      const s = latest.summary;
      const conversation = latest.conversation;
      const recordedThread = latest.recordedThread;
      const historical = latest.history
        ? presentHistoryView(latest.history, displayScenario())
        : null;
      const localCompact = conversationBar(
        s,
        {
          failure: pageHealthAffectsStatus(),
          state: latest.state,
          pending: latest.calculationPending === true,
        },
        displayScenario(),
      );
      const localPresentation = localConversationPresentation(
        latest.mode,
        conversation,
        localCompact.text,
        localCompact.status,
      );
      const pendingUpload = hasPendingConversation(
        conversation?.pending,
        conversation?.pendingObservationCount,
      );
      // Organization mode is local-first (owner, 13 Oct 2026): the bar shows this browser's
      // figures, as in personal mode, and syncing runs in the background. The synced copy is
      // shown only when it holds everything recorded here and adds requests from another
      // browser; one set is shown, never both added, so nothing counts twice.
      const useServer =
        !!conversation?.server &&
        preferSyncedFigures({
          localRequests: s.requests,
          localHistoryRequests: latest.history?.local?.prompt_count,
          syncedRequests: conversation.server.request_count,
          syncedHistoryRequests: latest.history?.server?.prompt_count,
          localHistory: latest.history?.local?.status === "available",
          syncedHistory: latest.history?.server?.status === "available",
          pending: pendingUpload,
          current: !conversation.offline && conversation.source !== "cached",
        });
      const shown = useServer ? conversation.server : s;
      let compact = useServer
        ? { text: serverBarText(conversation.server), status: localCompact.status }
        : localPresentation;
      // A matched thread shows its figures as any chat does, with Processing while a
      // reply streams; how the records were matched is explained in Details (compact bar
      // decision of 22 Sep 2026).
      if (recordedThread?.status === "unavailable") {
        compact = { text: "", status: "History match unavailable" };
      }
      if (recordedThread?.serverUnavailableReason === "unresolved_identity") {
        compact = {
          text:
            recordedThread.status === "matched_recorded_subset"
              ? localCompact.text
              : "",
          status: "Synced matching unavailable",
        };
      }
      const combined = latest.history
        ? combinedUsage(shown, latest.history, displayScenario())
        : null;
      if (combined) {
        compact = {
          text: combined.text,
          status: [
            latest.state === "generating" ? "Processing" : "",
            combined.matchingConflict ? "Matching incomplete" : "",
            // NotebookLM's Studio items are not paged; only its saved chat can be partly loaded.
            historyFailure ||
            (site === "notebooklm" &&
              !notebookChatRead(selectedHistory(shown, latest.history)))
              ? null
              : combined.loading,
          ]
            .filter(Boolean)
            .join(" · "),
        };
        // A long ChatGPT chat stays partly loaded until the person scrolls to its start, and
        // a Cowork session whose start the page's reads did not show stays so; the tracker
        // reads the rest itself instead (owner decisions of 13 and 14 Oct 2026).
        if (
          (site === "chatgpt" ||
            (site === "claude" && location.pathname.startsWith("/cowork/"))) &&
          combined.loading &&
          !historyFailure &&
          earlierImport !== "running" &&
          earlierGraceTimer === null
        )
          requestOwnRead("after_import");
      }
      // NotebookLM reads a notebook's saved chat only the first time the notebook opens in a
      // tab. The page world skips the read when the page read the chat itself in the last
      // 30 s (owner decision of 14 Oct 2026); a chat whose turns arrived in this navigation
      // is never read again, however long their import took.
      if (
        site === "notebooklm" &&
        !historyFailure &&
        !notebookChatSeen &&
        earlierImport !== "running" &&
        earlierGraceTimer === null &&
        parseConversationRoute(site, location.pathname)
      )
        requestOwnRead("after_import");
      const appendStatus = (label: string) => {
        if (compact.status.split(" · ").includes(label)) return;
        compact.status = [compact.status, label].filter(Boolean).join(" · ");
      };
      const activeHistory = latest.history
        ? selectedHistory(shown, latest.history)
        : null;
      noFiguresHistory = activeHistory;
      // While a calculation is pending an estimate may still arrive, so nothing is listed yet.
      stoppedReplies =
        latest.calculationPending === true
          ? 0
          : Number(s.stoppedWithoutAnswer ?? 0);
      // Nothing is saved for this chat and nothing was sent in this view. Showing
      // "Req 0" and Unknown figures here would look like a measured empty chat.
      const earlier =
        !combined &&
        !historyFailure &&
        !routeFailure &&
        latestSource === "route" &&
        selectedCaptureId === null &&
        !pendingPromotion() &&
        activeHistory?.status === "empty" &&
        String(s.requests ?? s.request_count ?? "0") === "0" &&
        String(conversation?.server?.request_count ?? "0") === "0" &&
        !latest.queueCount &&
        latest.state !== "generating" &&
        !pendingUpload &&
        recordedThread?.status !== "matched_recorded_subset" &&
        !!parseConversationRoute(site!, location.pathname)
          ? earlierHistoryState()
          : null;
      if (earlier === "unsaved") compact = { text: "", status: UNSAVED_EARLIER };
      else if (earlier === "loading")
        compact = { text: "", status: "Loading earlier messages" };
      else if (earlier === "not_loaded")
        compact = {
          text: "",
          // Reloading never makes Perplexity send a thread's messages, so its entry offers
          // no reload (17 Oct 2026).
          status: site === "perplexity" ? "Thread not loaded" : "History not loaded",
        };
      // Newly imported history waits for recalculation for a moment. That is not a
      // failure; the page refreshes when the calculation publishes.
      const calculating =
        activeHistory?.status === "unavailable" &&
        latest.calculationPending === true &&
        !historyFailure;
      if (calculating) {
        // A capture display is republished by the background when the result publishes.
        if (latestSource === "route") scheduleCalculationCheck();
        if (
          String(s.requests ?? s.request_count ?? "0") === "0" &&
          String(conversation?.server?.request_count ?? "0") === "0"
        )
          compact = { text: "", status: "Calculating earlier messages" };
        else appendStatus("Updating");
      } else if (activeHistory?.status === "unavailable")
        appendStatus("Earlier activity unavailable");
      if (heldDisplay) appendStatus("Updating");
      // A signed-out ChatGPT chat counted only from a later message (20 Oct 2026). The bar
      // keeps its figures; Details says the earlier messages cannot be counted.
      if (unsavedEarlierMissed()) appendStatus(UNSAVED_EARLIER);
      if (
        combined &&
        recordedThread?.serverUnavailableReason === "unresolved_identity"
      )
        appendStatus("Synced matching unavailable");
      // The figures as counted, before any problem note, for Details.
      const countedText = compact.text.startsWith("Req ") ? compact.text : "";
      if (
        pageHealthAffectsStatus() &&
        !compact.status.includes("Tracking problem")
      )
        compact = {
          text: compact.text,
          status: ["Tracking problem", compact.status]
            .filter(Boolean)
            .join(" · "),
        };
      if (historyFailure)
        compact = {
          text: compact.text,
          status: [
            activeHistory?.status === "empty" ? "" : compact.status,
            historyTooLarge() ? "History too large" : "History update problem",
          ]
            .filter(Boolean)
            .join(" · "),
        };
      if (routeFailure)
        compact = {
          text: compact.text,
          status: [compact.status, "Saved totals refresh problem"]
            .filter(Boolean)
            .join(" · "),
        };
      // A guide still being estimated stays on Processing (barActivity) until its figures
      // are calculated, as a reply's do.
      showFigures(
        metrics,
        compact.text,
        latest.calculationPending !== true &&
          notebookGuideOnly(
            site,
            shown,
            useServer
              ? serverTokenTotal(shown.tokens, "output")
              : shown.tokens?.output?.value,
          ),
      );
      setBarStatus(
        threadRelationChanged
          ? `Recorded match changed · ${compact.status}`
          : compact.status,
        shadow,
        { site, trackingAction },
      );
      // Sync state is a small icon at the bottom of Details, never a bar status.
      const syncState = detailsSyncState({
        mode: latest.mode,
        offline:
          !!conversation?.offline || latest.history?.server_status === "offline",
        pending: pendingUpload || Number(latest.queueCount ?? 0) > 0,
        current:
          !!conversation?.server &&
          !conversation.offline &&
          conversation.source !== "cached",
        paused: latest.sharingPaused === true,
        held: latest.sharingHeld === true,
      });
      if (syncState) syncRow?.replaceChildren(syncNodes(document, syncState));
      body.replaceChildren();
      // Problems and coverage notes come last, after every section (owner, 12 October 2026),
      // and stay open: never inside a closed section.
      const problems = document.createElement("div");
      problems.className = "dt-problems";
      if (heldDisplay)
        paragraph(
          "A newer observation is being calculated with the selected method. These figures are from the previous calculation and refresh when it finishes.",
        );
      const appendFileText = (
        fileText: any,
        coverage: any,
        sectionLabel: string,
        coverageLabel = "Requests",
      ) => {
        const presentation = presentFileTextSummary(fileText, coverage);
        const heading = document.createElement("h3");
        heading.textContent = `${sectionLabel} Extracted file text`;
        body.append(heading);
        paragraph(presentation.description);
        if (presentation.coverage) {
          const coverageList = document.createElement("dl");
          for (const [label, value] of [
            [
              `${coverageLabel} with observed extraction state`,
              presentation.coverage.observedRequests,
            ],
            [
              `${coverageLabel} with unknown extraction state`,
              presentation.coverage.unknownRequests,
            ],
          ]) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value;
            coverageList.append(dt, dd);
          }
          body.append(coverageList);
        } else if (presentation.coverageUnknown)
          paragraph(presentation.coverageUnknown);
        if (presentation.empty) paragraph(presentation.empty);
        for (const group of presentation.groups) {
          const groupHeading = document.createElement("h4");
          groupHeading.textContent = `${group.profile} · ${group.origin}`;
          body.append(groupHeading);
          paragraph(group.tokens);
          const groupList = document.createElement("dl");
          for (const [label, value] of [
            ["Extraction profile", group.extractionProfileId],
            ["Tokenizer profile", group.tokenizerProfile],
            ["Evidence", group.evidence],
            ["Applicable components", group.applicable],
            ["Contributing components", group.contributing],
            ["Unknown", group.unknown],
            ["Partial", group.partial],
            ["Unvalidated", group.unvalidated],
          ]) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value;
            groupList.append(dt, dd);
          }
          body.append(groupList);
          paragraph(`Measurement reasons: ${group.reasons}.`);
          paragraph(`Missing coverage: ${group.missing}.`);
        }
      };
      const appendHistorical = () => {
        if (!historical) return;
        const heading = document.createElement("h3");
        heading.textContent = "Conversation coverage";
        body.append(heading);
        if (earlier === "loading")
          paragraph(
            "Earlier messages are being counted on this device. Figures appear when counting finishes.",
          );
        else if (calculating)
          paragraph(
            "Figures are being calculated on this device with the selected method. The bar refreshes when the calculation finishes.",
          );
        else if (earlier === "not_loaded")
          paragraph(
            site === "perplexity"
              ? "Perplexity did not send this thread's messages, so the tracker could not count them. Perplexity sends them when the page loads, so reloading the page usually counts them. Reloading does not send a message."
              : `${siteName()} did not load this chat's messages again when it was reopened, so the tracker could not count them. Reload the page to count earlier messages. Reloading does not send a message.`,
          );
        const ownReadNote = ownRead?.note(navigationNonce);
        if (ownReadNote && !ownReadNote.failed) paragraph(ownReadNote.text);
        if (historical.serverNotice) paragraph(historical.serverNotice);
        for (const section of historical.sections) {
          const sectionHeading = document.createElement("h4");
          sectionHeading.textContent = section.label;
          body.append(sectionHeading);
          if (section.presentation.state !== "available")
            paragraph(section.presentation.status);
          const facts = document.createElement("dl");
          const rows = [
            // Studio items are not a chat with a first message (W9).
            ...(site === "notebooklm" && !notebookChatRead(section.summary)
              ? []
              : [
                  [
                    "First message",
                    section.summary.first_request_verified
                      ? "Loaded"
                      : "Not verified",
                  ],
                ]),
            ...section.presentation.counts,
            ...section.presentation.tokens.map((item) => [
              item.role,
              item.tokens,
            ]),
            ...section.presentation.resources.map((item) => [
              item.quantity,
              item.value,
            ]),
          ];
          for (const [label, value] of rows) {
            const dt = document.createElement("dt");
            dt.textContent = label;
            const dd = document.createElement("dd");
            dd.textContent = value;
            facts.append(dt, dd);
          }
          body.append(facts);
          const technical = document.createElement("details");
          const title = document.createElement("summary");
          title.textContent = "Measurement sources";
          technical.append(title);
          const sources = document.createElement("dl");
          for (const item of section.presentation.tokens) {
            const dt = document.createElement("dt");
            dt.textContent = item.role;
            const dd = document.createElement("dd");
            dd.textContent = `${item.profile} · ${item.evidence} · Unknown: ${item.unknownMessages}`;
            sources.append(dt, dd);
          }
          for (const item of section.presentation.resources) {
            const dt = document.createElement("dt");
            dt.textContent = item.quantity;
            const dd = document.createElement("dd");
            dd.textContent = `${item.method} · ${item.methodHash} · ${item.selectedProfile} · ${item.status} · ${item.profileSelection} · Counted: ${item.knownMessages} · Unknown: ${item.unknownMessages} · Reasons: ${item.reasons} · Missing: ${item.missing}`;
            sources.append(dt, dd);
          }
          technical.append(sources);
          body.append(technical);
          if (section.summary.file_text.length) {
            const mainBody = body;
            body = technical;
            appendFileText(
              section.summary.file_text,
              {
                observed_request_count:
                  section.summary.file_text_coverage.observed_message_count,
                unknown_request_count:
                  section.summary.file_text_coverage.unknown_message_count,
                scope: "extracted_file_text",
                additive: false,
              },
              "Earlier",
              "Messages",
            );
            body = mainBody;
          }
        }
      };
      // The summary reads the same figures as the bar: combined history and live totals,
      // the synced conversation, or this browser's own records.
      const unitOf = (kind: "energy" | "carbon" | "water") =>
        kind === "energy" ? "kWh" : kind === "carbon" ? "gCO2e" : "L";
      const detailsFigure = (
        kind: "energy" | "carbon" | "water",
      ): DetailsFigure => {
        if (combined) {
          const c = combined[kind];
          return {
            value: c.value,
            unit: c.unit,
            value_kind: c.scenario_low != null ? "midpoint_sum" : "scalar",
            scenario_low: c.scenario_low,
            scenario_high: c.scenario_high,
            multiple: c.multiple,
          };
        }
        if (useServer)
          return serverFigure(
            conversation.server.resources,
            kind === "water" ? "water_total" : kind,
            unitOf(kind),
          );
        const m = s.metrics?.[kind];
        return {
          value: m?.value ?? null,
          unit: m?.unit ?? unitOf(kind),
          value_kind: m?.value_kind,
          scenario_low: m?.scenario_low,
          scenario_high: m?.scenario_high,
          multiple:
            m?.reason === "incompatible_scopes" || (m?.groups?.length ?? 0) > 1,
        };
      };
      const liveSummary = shown;
      let detailsRequests: string | null = null;
      try {
        const live = BigInt(
          liveSummary?.requests ?? liveSummary?.request_count ?? 0,
        );
        detailsRequests = (
          combined && activeHistory?.status === "available"
            ? live + BigInt(activeHistory.prompt_count)
            : live
        ).toString();
      } catch {
        detailsRequests = null;
      }
      const detailsInput: DetailsInput = {
        surface: surface ?? site!,
        siteName: siteName(),
        scenario: displayScenario(),
        requests: detailsRequests,
        requestsApproximate: !!combined?.matchingIncomplete,
        tokensIn: combined
          ? combined.input.value
          : useServer
            ? serverTokenTotal(conversation.server.tokens, "input")
            : (s.tokens?.input?.value ?? null),
        tokensOut: combined
          ? combined.output.value
          : useServer
            ? serverTokenTotal(conversation.server.tokens, "output")
            : (s.tokens?.output?.value ?? null),
        energy: detailsFigure("energy"),
        carbon: detailsFigure("carbon"),
        water: detailsFigure("water"),
        // Saved history names its models too, so an imported chat is not "Model not named".
        models: detailsModels(
          (s.estimation?.lines ?? [])
            .filter((line: any) => line.role === "main" && line.model)
            .map((line: any) => String(line.model)),
          Array.isArray(latest.history?.models) ? latest.history.models : null,
        ),
        earlierLoaded:
          site === "notebooklm" && !notebookChatRead(activeHistory)
            ? null
            : earlier === "not_loaded"
              ? false
              : activeHistory?.status === "available"
                ? activeHistory.first_request_verified !== false
                : null,
      };
      detailsSub.textContent = headerLine(detailsInput);
      detailsRoot.append(...overviewNodes(document, detailsInput));
      const section = (
        id: string,
        title: string,
        summary: string,
        extra?: Node,
      ) => {
        const made = disclosure(document, {
          id,
          title,
          summary,
          extra,
          open: openSections.has(id),
          onToggle: (open) => {
            if (open) openSections.add(id);
            else openSections.delete(id);
          },
        });
        detailsRoot.append(made.box);
        return made;
      };
      // Waits for the comparison reply, which carries the smaller-model change.
      const smaller =
        comparison?.path === location.pathname &&
        comparison.state.state === "ready"
          ? smallerModelCard(detailsInput, comparison.state.result.smallerModel)
          : null;
      if (smaller) detailsRoot.append(smallerModelNodes(document, smaller));
      if (comparison?.path === location.pathname)
        section(
          "compared",
          "Compared with your chats",
          comparisonLine(comparison.state),
        ).body.append(...comparisonNodes(document, comparison.state));
      const parts = countedParts(
        detailsInput.surface,
        siteName(),
        detailsInput.earlierLoaded,
      );
      const counted = section(
        "counted",
        "What was counted",
        countedSummary(parts, siteName()),
        countedDots(document, parts),
      );
      counted.body.append(...countedNodes(document, parts, siteName()));
      // Here rather than in the totals' explanation below, which a chat counted only from
      // saved history (no recorded request, live finding of 14 Oct 2026) never shows.
      for (const line of computerFileLines(
        computerFileFacts,
        savedComputerFiles(latest.history?.computer_files),
      )) {
        const item = document.createElement("p");
        item.textContent = line;
        counted.body.append(item);
      }
      // Here too, so a live chat says why an attached image adds no input (19 Oct 2026). The
      // display does not say whether the chat had an attachment, so every chat of the site
      // says it.
      const attached = attachmentNote(detailsInput.surface);
      if (attached) {
        const item = document.createElement("p");
        item.textContent = attached;
        counted.body.append(item);
      }
      const estimated = section(
        "estimated",
        "How this was estimated",
        estimatedSummary(detailsInput),
      );
      estimated.body.append(...estimatedNodes(document, detailsInput));
      // The earlier full explanation stays available, below the summary rows.
      const more = document.createElement("div");
      more.className = "dt-more";
      estimated.body.append(more);
      body = more;
      const methodology = document.createElement("a");
      methodology.href = methodologyUrl;
      methodology.target = "_blank";
      methodology.rel = "noopener noreferrer";
      methodology.textContent = "Methodology";
      body.append(methodology);
      if (combined) {
        const totals = document.createElement("dl");
        for (const [label, value] of [
          ["Requests", combined.requests],
          [
            "New requests",
            formatInteger(useServer ? conversation.server.request_count : s.requests),
          ],
          ["Input tokens", combined.input.text],
          ["Output tokens", combined.output.text],
          ["Electricity", combined.energy.text],
          ["Carbon", combined.carbon.text],
          ["Water", combined.water.text],
        ]) {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          totals.append(dt, dd);
        }
        body.append(totals);
        if (combined.matchingIncomplete)
          paragraph(
            "Some loaded messages have no verified link to live records, which can happen after reinstalling the extension. This is not itself a tracking failure. The approximate totals may include overlap. See Conversation coverage below.",
          );
        if (combined.matchingConflict)
          paragraph(
            "Matching incomplete: some loaded messages contain conflicting saved identities or measurements. Conflicting records are excluded from totals. See Conversation coverage below.",
          );
      }
      appendHistorical();
      const measurementDetails = document.createElement("details");
      const measurementTitle = document.createElement("summary");
      measurementTitle.textContent = "More measurement details";
      measurementDetails.append(measurementTitle);
      const measurementBody = document.createElement("div");
      measurementDetails.append(measurementBody);
      body.append(measurementDetails);
      body = measurementBody;
      if (historyFailure)
        paragraph(
          historyFailureReason === "history_response_limit"
            ? "This conversation's history response exceeded the bounded import size. Earlier messages could not be counted. Previously accepted numeric records remain separate. Scrolling or refreshing cannot reduce the response."
            : historyFailureReason === "history_text_limit"
              ? "The selected conversation text exceeded the bounded import size. Earlier messages could not be counted. Previously accepted numeric records remain separate. Scrolling or refreshing cannot reduce the text."
              : historyFailureReason === "history_message_limit"
                ? "The selected conversation has more messages than the bounded import can process. Earlier messages could not be counted. Previously accepted numeric records remain separate."
                : "The latest loaded history could not be counted. Previously accepted numeric history remains visible and separate.",
        );
      if (routeFailure)
        paragraph(
          `${routeFailure.message} The values shown remain the last accepted snapshot. Retry reads saved numerical usage only.`,
        );
      if (threadRelationChanged)
        paragraph(
          "Conflicting saved matches were removed. The values below are the refreshed recorded subset.",
        );
      const appendPending = () => {
        if (
          !hasPendingConversation(
            conversation?.pending,
            conversation?.pendingObservationCount,
          )
        )
          return;
        const pending = conversation.pending;
        const pendingCount = conversation.pendingObservationCount;
        const pendingHeading = document.createElement("h3");
        pendingHeading.textContent = "Waiting to synchronize";
        body.append(pendingHeading);
        const estimates = pending?.metrics
          ? ` Pending estimates: ${quantity(scenarioValue(pending.metrics.energy, displayScenario()), "kWh")} electricity; ${quantity(scenarioValue(pending.metrics.carbon, displayScenario()), pending.metrics.carbon.unit)} carbon; ${quantity(scenarioValue(pending.metrics.water, displayScenario()), "L")} total scoped water.`
          : "";
        paragraph(
          `${formatInteger(pendingCount)} measurement update${String(pendingCount) === "1" ? " is" : "s are"} waiting to synchronize. An update can replace an older accepted revision, so pending usage estimates are shown separately and are not added to matched or synced totals.${estimates}`,
        );
        if (pending)
          appendFileText(
            pending.file_text,
            pending.file_text_coverage,
            "Waiting local",
          );
      };
      if (recordedThread) {
        const relationHeading = document.createElement("h3");
        relationHeading.textContent = "Matched recorded conversation activity";
        body.append(relationHeading);
        paragraph(
          recordedThread.status === "matched_recorded_subset"
            ? "This view includes only requests that the tracker matched to this recorded Perplexity conversation. It does not establish complete provider or account history."
            : "No saved requests are currently matched to this recorded Perplexity conversation. Usage remains unknown; this does not mean the provider performed zero work.",
        );
        if (recordedThread.serverUnavailableReason === "unresolved_identity")
          paragraph(
            "Synced matching is unavailable while a recorded request identity is unresolved. Matched records in this browser profile and waiting local updates remain separate from synced totals.",
          );
        const coverage = document.createElement("dl");
        const coverageRows: Array<[string, string]> = [
          ["Provider history complete", "No"],
          [
            "Current page coverage",
            recordedThread.coverageAfterRestart === "observed_page"
              ? "Observed in this session"
              : "Unavailable after restart",
          ],
        ];
        if (recordedThread.observedPageRequests !== null)
          coverageRows.push([
            "Request IDs on latest observed page",
            formatInteger(recordedThread.observedPageRequests),
          ]);
        if (recordedThread.unmatchedPageRequests !== null)
          coverageRows.push([
            "Latest-page requests without a saved match",
            formatInteger(recordedThread.unmatchedPageRequests),
          ]);
        if (recordedThread.hasNextPage !== null)
          coverageRows.push([
            "Provider reported another page",
            recordedThread.hasNextPage ? "Yes" : "No",
          ]);
        for (const [label, value] of coverageRows) {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          coverage.append(dt, dd);
        }
        body.append(coverage);
        paragraph(
          recordedThread.coverageAfterRestart === "saved_links_only"
            ? "Saved matches can cover pages observed earlier. Current parsed-page counts and transient unmatched request IDs are not retained across a browser restart. Requests outside observed pages may be missing."
            : "Matched totals can include saved links from earlier observed pages. Requests outside observed pages may be missing, and latest-page unmatched counts are not usage totals.",
        );
      }
      if (recordedThread?.status === "unavailable") {
        appendPending();
      } else if (useServer) {
        const snapshotTime = conversation.server.generated_at
          ? formatDateTime(conversation.server.generated_at)
          : conversation.cachedAt
            ? formatDateTime(new Date(conversation.cachedAt).toISOString())
            : "time unavailable";
        paragraph(
          `${conversation.offline ? "Offline cached" : conversation.source === "cached" ? "Cached" : "Current"} synced conversation snapshot from ${snapshotTime}. It combines your records from paired browsers for this conversation. Synced totals and waiting local updates are never added together in this view.`,
        );
        const serverDl = document.createElement("dl");
        const synced = conversation.server;
        const syncedResource = (name: string) =>
          serverResourceText(synced.resources, name, displayScenario());
        const syncedTokens = Object.fromEntries(
          Object.keys(TOKEN_LABELS).map((key) => [
            key,
            serverTokenFigure(
              synced.tokens,
              key as TokenTotalKey,
              Number(synced.attempt_count ?? 0),
            ),
          ]),
        ) as Record<TokenTotalKey, ReturnType<typeof serverTokenFigure>>;
        for (const [label, value] of [
          ["Recorded requests", quantity(synced.request_count)],
          ...Object.entries(TOKEN_LABELS).map(([key, label]) => [
            label,
            tokenTotalText(syncedTokens[key as TokenTotalKey], formatInteger),
          ]),
          ["Estimated electricity", syncedResource("energy")],
          ["Electricity-related carbon", syncedResource("carbon")],
          ["Direct cooling water", syncedResource("water_direct")],
          ["Electricity-supply water", syncedResource("water_upstream")],
          ["Total scoped water", syncedResource("water_total")],
        ]) {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          serverDl.append(dt, dd);
        }
        body.append(serverDl);
        const syncedPartly = partlyMeasuredText(
          syncedTokens,
          (synced.resources ?? [])
            .filter((row: any) => row.quantity === "energy")
            .reduce(
              (sum: number, row: any) => sum + Number(row.unknown_count ?? 0),
              0,
            ),
          formatInteger,
        );
        if (syncedPartly) paragraph(syncedPartly);
        paragraph(
          `Ranged estimates show the ${displayScenario()} scenario. Change it in Settings on the dashboard.`,
        );
        appendSection("Not included", coverageNotes(surface));
        appendFileText(
          conversation.server.file_text,
          conversation.server.file_text_coverage,
          "Synced",
        );
        appendPending();
      } else {
        paragraph(
          `Recorded in this browser profile. ${localPresentation.explanation}`,
        );
        const dl = document.createElement("dl");
        for (const [label, value] of [
          ...Object.entries(TOKEN_LABELS).map(([key, label]) => [
            label,
            tokenTotalText(s.tokens[key as TokenTotalKey], formatInteger),
          ]),
          [
            "Estimated electricity",
            quantity(scenarioValue(s.metrics.energy, displayScenario()), "kWh"),
          ],
          [
            "Electricity-related carbon",
            quantity(
              scenarioValue(s.metrics.carbon, displayScenario()),
              s.metrics.carbon.unit,
            ),
          ],
          [
            "Direct cooling water",
            quantity(
              scenarioValue(s.metrics.waterDirect, displayScenario()),
              "L",
            ),
          ],
          [
            "Electricity-supply water",
            quantity(
              scenarioValue(s.metrics.waterUpstream, displayScenario()),
              "L",
            ),
          ],
          [
            "Total scoped water",
            quantity(scenarioValue(s.metrics.water, displayScenario()), "L"),
          ],
        ]) {
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          dl.append(dt, dd);
        }
        body.append(dl);
        const partly = partlyMeasuredText(
          s.tokens,
          Math.max(
            0,
            ...[s.metrics.energy, s.metrics.carbon, s.metrics.water].map(
              (metric: any) => Number(metric?.unknown ?? 0),
            ),
          ),
          formatInteger,
          s.estimation?.reasons.unknown_event_observed ?? 0,
        );
        if (partly) paragraph(partly);
        paragraph(
          `Ranged estimates show the ${displayScenario()} scenario. Change it in Settings on the dashboard.`,
        );
        appendFileText(s.file_text, s.file_text_coverage, "Local");
        const releasesNote = methodReleasesNote(s.metrics?.energy, combined);
        appendSection("How this was estimated", [
          ...estimateDetailLines(s.estimation, latest.modelLabels ?? []),
          ...(releasesNote ? [releasesNote] : []),
        ]);
        appendSection(
          "Not included",
          coverageNotes(
            surface,
            s.estimation?.reasons,
            s.estimation?.lines.map(
              (line: {
                role: NonNullable<Parameters<typeof coverageNotes>[2]>[number];
              }) =>
                line.role,
            ),
          ),
        );
        paragraph(countSourceNote(surface));
        for (const [name, metric] of Object.entries(s.metrics) as Array<
          [string, any]
        >) {
          if (metric.groups?.length > 1) {
            const heading = document.createElement("h3");
            heading.textContent = `Separate ${name} scopes`;
            body.append(heading);
            for (const group of metric.groups)
              paragraph(
                `${quantity(scenarioValue(group, displayScenario()), group.unit)} · ${group.scope} · ${group.method_id}`,
              );
          }
        }
        if (s.images?.operations > 0)
          paragraph(
            s.images.returned === null || s.images.returned === undefined
              ? `${s.images.operations} image operation${s.images.operations === 1 ? " was" : "s were"} observed, but the number of returned images is unknown. ${s.images.completed} operation${s.images.completed === 1 ? " is" : "s are"} confirmed final; other outcomes remain provisional.`
              : `${quantity(s.images.returned)} generated image${s.images.returned === "1" ? "" : "s"} observed across ${s.images.operations} operation${s.images.operations === 1 ? "" : "s"}. ${s.images.completed} operation${s.images.completed === 1 ? " is" : "s are"} confirmed final; other outcomes remain provisional.`,
          );
        // Version 3 estimates explain themselves above; older results keep their notes.
        const legacyEstimate =
          s.estimate && !("requested_method" in s.estimate) ? s.estimate : null;
        if (legacyEstimate) {
          paragraph(
            `Highest comparable estimate: ${legacyEstimate.selected_profile_id ?? "unavailable"}. Method ${legacyEstimate.method_id}. Rough, unvalidated text-component estimate; the finite reference cohort does not establish a physical upper bound.`,
          );
          paragraph(
            "Input length is not explicitly modeled in the current energy method. Training, hardware manufacturing, your computer/network and unobserved auxiliary work are excluded.",
          );
        }
        appendPending();
      }
      body = section(
        "context",
        "Chat length",
        latest.guidance.ratio !== null
          ? `About ${Math.round(latest.guidance.ratio * 100)}% of the context budget, partial estimate`
          : "Share of the context budget unavailable",
      ).body;
      const heading = document.createElement("h3");
      heading.textContent = "Active conversation context";
      body.append(heading);
      if (latest.guidance.ratio !== null) {
        paragraph(
          `${quantity(latest.activeContext)} / ${quantity(String(latest.budget))} tokens (${Math.round(latest.guidance.ratio * 100)}%, partial estimate). ${latest.budgetBasis?.basis ?? "Basis: conservative guidance; actual app limit unverified."}`,
        );
        if (latest.budgetBasis?.source) {
          const link = document.createElement("a");
          link.href = latest.budgetBasis.source;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = `Published capacity source · ${latest.budgetBasis.version}`;
          body.append(link);
        }
        const progress = document.createElement("progress");
        progress.max = 1;
        progress.value = Math.min(1, latest.guidance.ratio);
        progress.setAttribute(
          "aria-label",
          "Estimated context share of the displayed budget",
        );
        body.append(progress);
      } else
        paragraph(
          "Percentage unavailable. No verified application capacity or configured advisory budget is available. Set an optional budget in extension settings.",
        );
      paragraph(
        "Active context follows known retained conversation text, not cumulative usage. Hidden instructions, retrieval, uploads and provider compaction can change the actual context.",
      );
      paragraph(
        "For a new topic, consider a fresh conversation. Ask for the answer length you need and attach relevant excerpts. Summarizing also uses computation; losing needed context can cause retries.",
      );
      const snooze = document.createElement("button");
      snooze.type = "button";
      snooze.textContent = "Snooze the long-chat tip for 24 hours";
      snooze.addEventListener("click", () => {
        changeTip("snooze");
        if (latest?.guidance?.key)
          void sendToBackground({
            target: "snooze-advice",
            key: latest.guidance.key,
          });
        noticeShadow!.querySelector<HTMLElement>(".notice")!.hidden = true;
      });
      body.append(snooze);
      detailsRoot.append(problems);
      body = problems;
      appendCaptureCoverage();
      appendPageHealth();
      showStatuses(problems, countedText);
      // The long-chat tip shows when a switched-on trigger is met (16 Oct 2026): the chat's
      // Req reached the request limit, or the token trigger, which arrives already decided,
      // and the person has not closed or snoozed it for this chat.
      const notice = noticeShadow.querySelector<HTMLElement>(".notice")!;
      const tipReason = longChatTipReason({
        tokens: latest.guidance?.show === true,
        requests: detailsRequests,
        requestLimit: Number.isInteger(latest.tipRequestLimit)
          ? latest.tipRequestLimit
          : null,
      });
      const tipChatState = tipReason ? tipState() : null;
      notice.hidden =
        !tipReason || !tipChatState || !tipOpen(tipChatState, Date.now());
      if (tipReason)
        notice.querySelector("span")!.textContent = longChatTipText(
          tipReason,
          detailsRequests,
          !!combined?.matchingIncomplete,
        );
    }
    function scan(preserveCurrentHistory = false) {
      if (extensionStopped) return;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = null;
      if (followChatAddress()) render();
      if (location.pathname !== lastPath) {
        recordedThreadInvalidationToken = null;
        const previousRoute = parseConversationRoute(site!, lastPath);
        const nextRoute = parseConversationRoute(site!, location.pathname);
        const pending = pendingPromotion();
        const candidateId =
          selectedCaptureId ?? pending?.binding.captureId ?? null;
        const observedIdentity = candidateId
          ? captureIdentities.get(candidateId)
          : null;
        const identity =
          observedIdentity?.scopeGeneration === scopeGeneration
            ? observedIdentity.identity
            : (pending?.identity ?? null);
        const captured = candidateId ? captureBindings.get(candidateId) : null;
        const promotingSelectedCapture =
          !previousRoute &&
          !!nextRoute &&
          !!identity &&
          !!captured &&
          captured.documentNonce === documentNonce &&
          identity.site === nextRoute.site &&
          identity.conversationId === nextRoute.conversationId;
        // A new ChatGPT chat's reply shown at its local address keeps its figures through the
        // move, also once its bounded promotion has run out.
        const restoring = promotingSelectedCapture
          ? (pending?.display ??
            ((provisionalChatgptRoute(lastPath) ||
              unsavedChatgptRoute(location.pathname)) &&
            latestSource === "active"
              ? latest
              : null))
          : null;
        // Preserve only a bounded numeric candidate across provisional provider routes.
        // File grants and visible totals remain cleared until an exact provider identity matches.
        // A new Perplexity thread opens at its first answer's id while the answer streams,
        // and its identity can only be proven after that (the reply's id must be the
        // route's). Its capture waits, bounded, for a display whose identity is this
        // route. A new ChatGPT chat waits the same way after its provisional address.
        // Other moves name the conversation before the route opens. A signed-out ChatGPT
        // chat moves from / straight to /uc/<id> once its stream names it, often before a
        // display does (live, 20 Oct 2026), so its reply waits the same way.
        const awaitsNewChat =
          !!nextRoute &&
          !identity &&
          (provisionalChatgptRoute(lastPath) ||
            unsavedChatgptRoute(location.pathname));
        if (
          !previousRoute &&
          (!nextRoute || (site === "perplexity" && !identity) || awaitsNewChat) &&
          candidateId &&
          captured
        ) {
          pendingCapturePromotion = pending ?? {
            binding: { ...captured },
            identity,
            display: latestSource === "active" ? latest : null,
            scopeGeneration,
            expires: Date.now() + 30000,
          };
          if (awaitsNewChat) pendingCapturePromotion.awaitsNewChat = true;
        } else pendingCapturePromotion = null;
        routeGeneration++;
        lastPath = location.pathname;
        // A new chat moves to its own address after the send, so the send stays with it.
        const carrySend =
          !previousRoute && composerSent?.navigation === navigationNonce;
        // So does a reply cut off by turning tracking off before the chat had its address.
        const carryWithdrawn =
          !previousRoute && withdrawnReply === navigationNonce;
        navigationNonce = crypto.randomUUID();
        if (carrySend) composerSent!.navigation = navigationNonce;
        if (carryWithdrawn) withdrawnReply = navigationNonce;
        startEarlierGrace(4000);
        // Clear the prior conversation before cleanup or transport can fail.
        clearOwnedDisplay();
        captureIdentities.clear();
        if (promotingSelectedCapture && candidateId) {
          selectedCaptureId = candidateId;
          if (!pending) fileOffers.promoteCapture(candidateId);
        } else {
          selectedCaptureId = null;
          fileOffers.invalidate();
        }
        invalidateThreadHistory(!preserveCurrentHistory);
        loadedPath = null;
        routeLoading = false;
        routeFailure = null;
        threadRelationChanged = false;
        historyFailure = false;
        historyFailureReason = null;
        notebookChatProblem = null;
        notebookChatSeen = false;
        notebookContent = false;
        computerFileFacts.clear();
        clearOwnedDisplay();
        render();
        void loadRecordedRoute();
        if (restoring && selectedCaptureId && siteAccess) {
          latest = restoring;
          latestPath = location.pathname;
          latestSource = "active";
          displayGeneration++;
          render();
        }
      } else if (routeFailure?.retryable) void loadRecordedRoute();
      mount(true);
    }
    const ownedNode = (node: Node) =>
      ownedHosts.has(node) ||
      node === root ||
      node === noticeRoot ||
      !!root?.contains(node) ||
      !!noticeRoot?.contains(node);
    const potentialEditorSelector =
      site === "claude"
        ? ".ProseMirror"
        : site === "perplexity"
          ? "#ask-input, [data-lexical-editor], textarea[placeholder]"
          : editorSelector;
    const candidateNode = (node: Node) =>
      node instanceof Element &&
      (node.matches(editorSelector) || !!node.querySelector(editorSelector));
    const mutationsRequireComposerScan = (mutations: MutationRecord[]) => {
      const attributeTargets = new Set<Element>();
      const changedNodes = new Set<Node>();
      const maxUnownedTargets = 64;
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          if (mutation.target instanceof Element && !ownedNode(mutation.target))
            attributeTargets.add(mutation.target);
        } else {
          if (
            mountedComposer &&
            mutation.target instanceof Element &&
            mountedComposer.anchor.contains(mutation.target)
          )
            return true;
          for (const nodes of [mutation.addedNodes, mutation.removedNodes])
            for (const node of nodes) {
              if (!ownedNode(node)) changedNodes.add(node);
              if (attributeTargets.size + changedNodes.size > maxUnownedTargets)
                return true;
            }
        }
        if (attributeTargets.size + changedNodes.size > maxUnownedTargets)
          return true;
      }

      let candidates: Element[] | null = null;
      const currentCandidates = () =>
        (candidates ??= [...document.querySelectorAll(editorSelector)]);
      for (const target of attributeTargets) {
        if (
          mountedComposer &&
          (target === mountedComposer.editor ||
            target === mountedComposer.anchor ||
            mountedComposer.anchor.contains(target) ||
            target.contains(mountedComposer.anchor))
        )
          return true;
        if (target.matches(potentialEditorSelector)) return true;
        if (
          currentCandidates().some(
            (editor) => target === editor || target.contains(editor),
          )
        )
          return true;
      }
      return [...changedNodes].some(
        (node) =>
          candidateNode(node) ||
          (!!mountedComposer &&
            node instanceof Element &&
            (node === mountedComposer.anchor ||
              node.contains(mountedComposer.anchor))),
      );
    };
    const observer = new MutationObserver((mutations) => {
      followChatAddress();
      if (latest && latestPath !== location.pathname) {
        clearOwnedDisplay();
        routeFailure = null;
        routeLoading = !!parseConversationRoute(site!, location.pathname);
        render();
      }
      schedulePanelPosition?.();
      // Inspect only a bounded activity indicator, never assistant text or history.
      if (Date.now() - diagnosticScan > 500) {
        diagnosticScan = Date.now();
        const active = !!document.querySelector(
          '[data-testid="stop-button"],button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="Stop"]',
        );
        if (active && !diagnosticActivity) watchdog.activity(Date.now());
        diagnosticActivity = active;
      }
      if (
        !scanTimer &&
        (!root?.isConnected ||
          location.pathname !== lastPath ||
          mutationsRequireComposerScan(mutations))
      )
        scanTimer = setTimeout(scan, 500);
    });
    observer.observe(document, {
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "aria-label",
        "class",
        "contenteditable",
        "data-cds-dock-group",
        "data-lexical-editor",
        // Signed-out ChatGPT's mark that its composer is set up (composerPageReady).
        "data-octane-home-behavior-ready",
        "data-perf-region",
        "hidden",
        "id",
        "role",
        "style",
        "type",
      ],
      childList: true,
      subtree: true,
    });
    window.addEventListener("popstate", () => scan(), { signal });
    const readTheme = () => {
      const current = composer();
      if (current) adaptTheme(current);
    };
    const themeObserver = new MutationObserver(readTheme);
    // Each site marks its theme differently: ChatGPT data-theme, claude.ai data-mode (light or
    // dark), Perplexity data-color-scheme, Gemini a class. Without data-mode the bar and Details
    // kept claude.ai's old colours after an appearance change until the page was reloaded
    // (15 October 2026).
    const themeAttributes = ["class", "style", "data-theme", "data-mode", "data-color-scheme"];
    for (const node of [document.documentElement, document.body])
      if (node)
        themeObserver.observe(node, { attributes: true, attributeFilter: themeAttributes });
    // A site that follows the system setting through CSS alone changes no attribute. Read again
    // after the page's own listeners have run.
    window
      .matchMedia?.("(prefers-color-scheme: dark)")
      ?.addEventListener?.("change", () => setTimeout(readTheme, 50), { signal });
    // The first route never passes through scan's route change, so start its wait here.
    // Page load is slower than a sidebar click, so it gets a longer grace period.
    if (parseConversationRoute(site!, location.pathname)) {
      startEarlierGrace(6000);
      // Saved totals do not depend on the composer, so read them while a long chat
      // is still rendering. Mounting the bar then shows them at once.
      void loadRecordedRoute();
    }
    const bootTimer = setTimeout(() => {
      startupWaitOver = true;
      mount(true);
      if (!root) void sendToBackground({ target: "placement-health" });
    }, 5000);
    function stopExtension() {
      if (extensionStopped) return;
      extensionStopped = true;
      siteAccess = false;
      clearEarlierGrace();
      ownRead?.stop();
      if (calculationCheck?.timer) clearTimeout(calculationCheck.timer);
      calculationCheck = null;
      routeGeneration++;
      scopeGeneration++;
      clearOwnedDisplay();
      controller.abort();
      observer.disconnect();
      themeObserver.disconnect();
      clearTimeout(bootTimer);
      clearInterval(watchdogTimer);
      if (heldTimer) clearTimeout(heldTimer);
      heldTimer = null;
      heldProgress.clear();
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = null;
      clearHistoricalCapture();
      clearThreadHistory();
      captureIdentities.clear();
      pendingCapturePromotion = null;
      render();
      // Cleanup must complete without a working extension transport.
      try {
        fileOffers.destroy();
      } finally {
        window.postMessage(
          { channel: "ai-footprint-control-v1", action: "stop" },
          location.origin,
        );
      }
    }
    ctx.onInvalidated(stopExtension);
  },
});
