const observed = new WeakSet();
const articleByRequestId = new Map();
const queue = [];
const decisionCache = new Map(); // postId -> { decision, reason }
const VIDEO_FRAME_MAX_DIMENSION = 1280;
const VIDEO_FRAME_MAX_BYTES = 300_000;
const CARD_CLASS = "calm-x-card";
const CACHE_STORAGE_KEY = "calmfeed-decisions-v4";
const MAX_DECISION_CACHE = 1000;

let filteringEnabled = false;
let batchTimer = 0;
let batchBusy = false;
let requestCounter = 0;
let sessionEndsAt = 0;
let timerId = 0;
let timerBadge = null;
let sessionOverlay = null;
let stylesInjected = false;
let cacheSaveTimer = 0;
let visitPingId = 0;
let defaultSessionMinutes = 10;

// Smaller lookahead than before — huge rootMargin classified far-off posts,
// collapsed their height, and made X think you were near the bottom.
const intersectionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    intersectionObserver.unobserve(entry.target);
    enqueue(entry.target);
  }
}, { rootMargin: "480px 0px" });

const mutationObserver = new MutationObserver(mutations => {
  if (!filteringEnabled) return;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sessionEnded") {
    sessionEndsAt = 0;
    stopVisitPing();
    removeTimerBadge();
    showIntentGateWithStats(true);
    return undefined;
  }

  if (message?.type === "sessionStarted") {
    sessionEndsAt = Number(message.sessionEndsAt) || 0;
    hideSessionOverlay();
    runTimer();
    startVisitPing();
    return undefined;
  }

  if (message?.type === "categoriesChanged") {
    decisionCache.clear();
    try {
      sessionStorage.removeItem(CACHE_STORAGE_KEY);
    } catch {
      // ignore
    }
    document.querySelectorAll('article[data-testid="tweet"]').forEach(article => {
      delete article.dataset.calmXQueued;
      delete article.dataset.calmXState;
      getCard(article)?.remove();
      observed.delete(article);
    });
    if (filteringEnabled) scan(document);
    return undefined;
  }

  if (message?.type === "captureVideoFrames") {
    captureVideoFramesForRequest(message.requestId)
      .then(frames => sendResponse({ ok: true, frames }))
      .catch(() => sendResponse({ ok: false, frames: [] }));
    return true;
  }

  return undefined;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.sessionBlocked?.newValue === true) {
    sessionEndsAt = 0;
    stopVisitPing();
    removeTimerBadge();
    showIntentGateWithStats(true);
  }

  if (changes.sessionEndsAt) {
    sessionEndsAt = Number(changes.sessionEndsAt.newValue) || 0;
    if (sessionEndsAt > Date.now()) {
      hideSessionOverlay();
      runTimer();
      startVisitPing();
    } else if (!sessionOverlay) {
      showIntentGate({ finished: Boolean(changes.sessionBlocked?.newValue) });
    }
  }
});

start().catch(error => {
  document.documentElement.classList.remove("calm-x-booting");
  console.error(error);
});

async function start() {
  document.documentElement.classList.add("calm-x-booting");
  injectStyles();
  loadDecisionCache();

  const response = await chrome.runtime.sendMessage({ type: "getState" });
  filteringEnabled = Boolean(response?.state?.hasApiKey);
  sessionEndsAt = Number(response?.state?.sessionEndsAt) || 0;
  defaultSessionMinutes = Number(response?.state?.minutes) || 10;
  applySystemFeedTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applySystemFeedTheme);

  document.documentElement.classList.remove("calm-x-booting");
  document.documentElement.classList.toggle("calm-x-active", filteringEnabled);

  const live = sessionEndsAt > Date.now();
  if (live) {
    runTimer();
    startVisitPing();
  } else {
    showIntentGate({
      finished: Boolean(response?.state?.sessionBlocked),
      stats: response?.state?.visitStats
    });
  }

  if (filteringEnabled) scan(document);

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  console.info("[Calmfeed] content script v0.6.5 active — decision cache", decisionCache.size);
}

function applySystemFeedTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.calmfeedTheme = dark ? "dark" : "light";
}

function loadDecisionCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [postId, value] = entry;
      if (typeof postId !== "string" || !postId || !value) continue;
      // Legacy cache used { hide: boolean }; map to SHOW | BLUR.
      const decision =
        value.decision === "SHOW" || value.decision === "BLUR" || value.decision === "HIDE"
          ? value.decision
          : value.hide === true
            ? "BLUR"
            : value.hide === false
              ? "SHOW"
              : null;
      if (decision) {
        decisionCache.set(postId, {
          decision,
          reason: typeof value.reason === "string" ? value.reason : ""
        });
      }
    }
  } catch {
    // sessionStorage may be unavailable
  }
}

function rememberDecision(postId, decision, reason = "") {
  if (!postId) return;
  const normalized =
    decision === "BLUR" || decision === "HIDE" || decision === "SHOW"
      ? decision
      : decision === true
        ? "BLUR"
        : "SHOW";
  decisionCache.set(postId, {
    decision: normalized,
    reason: normalized === "SHOW" ? "" : String(reason || "")
  });

  while (decisionCache.size > MAX_DECISION_CACHE) {
    const oldest = decisionCache.keys().next().value;
    decisionCache.delete(oldest);
  }

  window.clearTimeout(cacheSaveTimer);
  cacheSaveTimer = window.setTimeout(() => {
    try {
      sessionStorage.setItem(
        CACHE_STORAGE_KEY,
        JSON.stringify([...decisionCache.entries()])
      );
    } catch {
      // quota / private mode
    }
  }, 200);
}

function getCachedDecision(postId) {
  if (!postId) return null;
  return decisionCache.get(postId) || null;
}

/** Keep scroll position stable when height changes above the viewport. */
function withScrollAnchor(article, apply) {
  if (!article) {
    apply();
    return;
  }

  const rect = article.getBoundingClientRect();
  const anchorAbove = rect.top < 0;
  const heightBefore = article.offsetHeight;

  apply();

  if (!anchorAbove || !article.isConnected) return;

  const delta = article.offsetHeight - heightBefore;
  if (delta !== 0) {
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop += delta;
  }
}

function injectStyles() {
  const existing = document.getElementById("calmfeed-styles");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "calmfeed-styles";
  style.setAttribute("data-calmfeed", "0.6.5");
  style.textContent = getCalmfeedStyles();
  (document.documentElement || document.head).append(style);
  stylesInjected = true;
}

function getCalmfeedStyles() {
  const fraunces600 = chrome.runtime.getURL("fonts/fraunces-600.woff2");
  const fraunces700 = chrome.runtime.getURL("fonts/fraunces-700.woff2");
  const bricolage400 = chrome.runtime.getURL("fonts/bricolage-grotesque-400.woff2");
  const bricolage500 = chrome.runtime.getURL("fonts/bricolage-grotesque-500.woff2");
  const bricolage600 = chrome.runtime.getURL("fonts/bricolage-grotesque-600.woff2");
  const bricolage700 = chrome.runtime.getURL("fonts/bricolage-grotesque-700.woff2");

  return `
@font-face{font-family:"Fraunces";src:url("${fraunces600}") format("woff2");font-weight:600;font-style:normal;font-display:swap}
@font-face{font-family:"Fraunces";src:url("${fraunces700}") format("woff2");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"Bricolage Grotesque";src:url("${bricolage400}") format("woff2");font-weight:400;font-style:normal;font-display:swap}
@font-face{font-family:"Bricolage Grotesque";src:url("${bricolage500}") format("woff2");font-weight:500;font-style:normal;font-display:swap}
@font-face{font-family:"Bricolage Grotesque";src:url("${bricolage600}") format("woff2");font-weight:600;font-style:normal;font-display:swap}
@font-face{font-family:"Bricolage Grotesque";src:url("${bricolage700}") format("woff2");font-weight:700;font-style:normal;font-display:swap}

html.calm-x-booting article[data-testid="tweet"]{visibility:hidden!important}
html.calm-x-active{overflow-anchor:auto}

/* Pending + blurred: soft blur in place. Pending = blur only. */
article[data-testid="tweet"][data-calm-x-state="pending"],
article[data-testid="tweet"][data-calm-x-state="blurred"]{
  position:relative!important;overflow:hidden!important
}
article[data-testid="tweet"][data-calm-x-state="pending"]>:not(.calm-x-card),
article[data-testid="tweet"][data-calm-x-state="blurred"]>:not(.calm-x-card){
  filter:blur(16px)!important;-webkit-filter:blur(16px)!important;
  pointer-events:none!important;user-select:none!important;
  transition:filter .35s ease!important
}
article[data-testid="tweet"][data-calm-x-state="pending"]>.calm-x-card{display:none!important}
article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card{
  position:absolute!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;
  inset:auto 0 0 0!important;z-index:5!important;
  display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;
  width:100%!important;max-width:100%!important;height:auto!important;min-height:56px!important;
  margin:0!important;padding:12px 16px!important;border:none!important;border-top:1px solid #e4e3e0!important;border-radius:0!important;
  background:rgba(250,250,250,.96)!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;
  pointer-events:auto!important;animation:calmfeed-veil-in .35s ease both!important
}
article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card .calm-x-card-title{
  text-shadow:none!important
}
article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card .calm-x-card-copy{
  flex:1 1 auto!important;min-width:0!important;text-align:left!important
}
article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card button{
  flex-shrink:0!important;margin-left:auto!important
}

/* Hard hide: only when user settings explicitly remove a post. */
article[data-testid="tweet"][data-calm-x-state="hidden"]{
  display:block!important;position:relative!important;overflow:hidden!important;
  min-height:0!important;height:auto!important;padding:0!important;margin:0!important;
  border:none!important;background:transparent!important;overflow-anchor:none
}
article[data-testid="tweet"][data-calm-x-state="hidden"]>:not(.calm-x-card){
  display:none!important;visibility:hidden!important;pointer-events:none!important;
  height:0!important;max-height:0!important;overflow:hidden!important;
  margin:0!important;padding:0!important;border:none!important
}
article[data-testid="tweet"][data-calm-x-state="hidden"]>.calm-x-card{
  position:relative!important;inset:auto!important;height:auto!important;min-height:92px!important
}

@keyframes calmfeed-veil-in{from{opacity:0}to{opacity:1}}
@keyframes calmfeed-panel-in{
  from{opacity:0;transform:translateY(8px) scale(.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}
@keyframes calmfeed-breathe{
  0%,100%{box-shadow:0 12px 40px rgba(20,20,19,.1)}
  50%{box-shadow:0 14px 44px rgba(20,20,19,.14)}
}
@keyframes calmfeed-timer-in{
  from{opacity:0;transform:translate3d(-8px,-6px,0) scale(.96)}
  to{opacity:1;transform:translate3d(0,0,0) scale(1)}
}
@keyframes calmfeed-timer-tick{
  0%{opacity:.55;transform:translateY(2px)}
  100%{opacity:1;transform:translateY(0)}
}
@keyframes calmfeed-timer-warn{
  0%,100%{box-shadow:0 10px 30px rgba(179,58,50,.12)}
  50%{box-shadow:0 12px 34px rgba(179,58,50,.22)}
}
.calm-x-timer{
  box-sizing:border-box!important;position:fixed!important;left:18px!important;top:18px!important;
  right:auto!important;bottom:auto!important;z-index:2147483646!important;
  min-width:72px!important;padding:11px 14px!important;
  border:1px solid #e4e3e0!important;border-radius:14px!important;color:#141413!important;
  background:rgba(250,250,250,.92)!important;backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  font-size:14px!important;font-weight:600!important;letter-spacing:-.02em!important;
  line-height:1!important;text-align:center!important;font-variant-numeric:tabular-nums!important;
  box-shadow:0 10px 30px rgba(20,20,19,.1)!important;pointer-events:none!important;
  animation:calmfeed-timer-in .45s cubic-bezier(.22,1,.36,1) both!important
}
.calm-x-timer[data-tick="1"]{animation:calmfeed-timer-tick .28s ease!important}
.calm-x-timer[data-warn="true"]{
  border-color:#b33a32!important;color:#b33a32!important;
  animation:calmfeed-timer-warn 1.8s ease-in-out infinite!important
}
.calm-x-timer[data-warn="true"][data-tick="1"]{
  animation:calmfeed-timer-tick .28s ease,calmfeed-timer-warn 1.8s ease-in-out infinite!important
}
.calm-x-overlay{
  box-sizing:border-box!important;position:fixed!important;inset:0!important;z-index:2147483647!important;
  display:grid!important;place-items:center!important;padding:24px!important;background:#f3f2f0!important;
  color:#141413!important;font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  animation:calmfeed-veil-in .4s ease both!important
}
.calm-x-end-panel{
  box-sizing:border-box!important;width:min(460px,100%)!important;border-radius:18px!important;
  border:1px solid #e4e3e0!important;padding:32px 28px!important;background:#fafafa!important;
  box-shadow:0 20px 50px rgba(20,20,19,.08)!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  animation:calmfeed-panel-in .5s cubic-bezier(.22,1,.36,1) both!important
}
.calm-x-eyebrow{
  display:block!important;margin:0 0 22px!important;font-family:"Fraunces",Georgia,serif!important;
  font-size:20px!important;font-weight:600!important;letter-spacing:-.03em!important;line-height:1!important;color:#141413!important
}
.calm-x-end-panel h1{
  display:block!important;margin:0 0 12px!important;padding:0!important;border:none!important;
  font-family:"Fraunces",Georgia,serif!important;font-size:clamp(36px,7vw,54px)!important;
  font-weight:600!important;line-height:1.02!important;letter-spacing:-.04em!important;color:#141413!important
}
.calm-x-end-panel p{
  display:block!important;max-width:400px!important;margin:0!important;padding:0!important;color:#73736e!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;font-size:15.5px!important;
  font-weight:400!important;line-height:1.5!important;letter-spacing:-.01em!important
}
.calm-x-intent-stats{margin-top:10px!important}
.calm-x-intent-label{
  display:block!important;margin:22px 0 8px!important;color:#73736e!important;
  font-size:12px!important;font-weight:600!important;letter-spacing:-.01em!important
}
.calm-x-intent-input,.calm-x-intent-minutes{
  box-sizing:border-box!important;width:100%!important;border:1px solid #e4e3e0!important;
  border-radius:10px!important;padding:12px 14px!important;color:#141413!important;background:#fff!important;
  font:500 15px/1.4 "Bricolage Grotesque",system-ui,sans-serif!important;outline:none!important;resize:vertical!important
}
.calm-x-intent-minutes{width:96px!important;resize:none!important}
.calm-x-intent-row{display:flex!important;align-items:center!important;gap:12px!important;margin-top:4px!important}
.calm-x-intent-row .calm-x-intent-label{margin:0!important}
.calm-x-intent-error{margin:12px 0 0!important;color:#b33a32!important;font-size:13px!important;font-weight:500!important}
.calm-x-intent-start{
  display:block!important;width:100%!important;margin-top:18px!important;min-height:48px!important;
  border:1px solid #141413!important;border-radius:10px!important;padding:12px 16px!important;
  color:#f3f2f0!important;background:#141413!important;
  font:600 15px/1 "Bricolage Grotesque",system-ui,sans-serif!important;cursor:pointer!important
}
.calm-x-intent-start:disabled{opacity:.5!important;cursor:wait!important}
html[data-calmfeed-theme="dark"] .calm-x-intent-input,
html[data-calmfeed-theme="dark"] .calm-x-intent-minutes{
  border-color:#2e2e2c!important;color:#f0efed!important;background:#141413!important
}
html[data-calmfeed-theme="dark"] .calm-x-intent-start{
  border-color:#f0efed!important;color:#141413!important;background:#f0efed!important
}
html[data-calmfeed-theme="dark"] .calm-x-intent-label,
html[data-calmfeed-theme="dark"] .calm-x-intent-stats{color:#a1a09a!important}
html[data-calmfeed-theme="dark"] article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card{
  background:rgba(28,28,27,.96)!important;border-top-color:#2e2e2c!important
}
html[data-calmfeed-theme="dark"] .calm-x-card-title{color:#f0efed!important}
html[data-calmfeed-theme="dark"] .calm-x-card button{
  border-color:#f0efed!important;color:#f0efed!important;background:rgba(28,28,27,.92)!important
}
html[data-calmfeed-theme="dark"] .calm-x-card[data-state="hidden"]{
  background:#1c1c1b!important;color:#f0efed!important;border-bottom-color:#2e2e2c!important
}
html[data-calmfeed-theme="dark"] .calm-x-timer{
  background:rgba(28,28,27,.92)!important;color:#f0efed!important;border-color:#2e2e2c!important
}
html[data-calmfeed-theme="dark"] .calm-x-overlay{background:#141413!important;color:#f0efed!important}
html[data-calmfeed-theme="dark"] .calm-x-end-panel{background:#1c1c1b!important;border-color:#2e2e2c!important}
html[data-calmfeed-theme="dark"] .calm-x-eyebrow,
html[data-calmfeed-theme="dark"] .calm-x-end-panel h1{color:#f0efed!important}
html[data-calmfeed-theme="dark"] .calm-x-end-panel p{color:#a1a09a!important}
@media (prefers-reduced-motion:reduce){
  article[data-testid="tweet"][data-calm-x-state="pending"]>:not(.calm-x-card),
  article[data-testid="tweet"][data-calm-x-state="blurred"]>:not(.calm-x-card){transition:none!important}
  article[data-testid="tweet"][data-calm-x-state="pending"]>.calm-x-card,
  article[data-testid="tweet"][data-calm-x-state="blurred"]>.calm-x-card,
  .calm-x-card-panel,.calm-x-card[data-state="pending"] .calm-x-card-panel,
  .calm-x-card button,.calm-x-timer,.calm-x-timer[data-warn="true"],.calm-x-timer[data-tick="1"],
  .calm-x-overlay,.calm-x-end-panel{animation:none!important;transition:none!important;transform:none!important}
}
`;
}

function scan(root) {
  if (root.matches?.('article[data-testid="tweet"]')) observe(root);
  root.querySelectorAll?.('article[data-testid="tweet"]').forEach(observe);
}

function observe(article) {
  if (observed.has(article)) return;
  observed.add(article);

  const postId = extractPostId(article);
  const cached = getCachedDecision(postId);

  // X remounts tweets while scrolling. Reuse the last decision instantly —
  // no "Checking post" flash, no height collapse, no re-fetch.
  if (cached) {
    article.dataset.calmXQueued = "true";
    applyDecision(article, cached.decision, {
      postId,
      fromCache: true,
      reason: cached.reason
    });
    return;
  }

  showPending(article);
  intersectionObserver.observe(article);
}

function enqueue(article) {
  if (!article.isConnected || article.dataset.calmXQueued === "true") return;

  const postId = extractPostId(article);
  const cached = getCachedDecision(postId);
  if (cached) {
    article.dataset.calmXQueued = "true";
    applyDecision(article, cached.decision, {
      postId,
      fromCache: true,
      reason: cached.reason
    });
    return;
  }

  article.dataset.calmXQueued = "true";
  queue.push(article);
  scheduleBatch();
}

function scheduleBatch() {
  if (batchTimer || batchBusy) return;
  batchTimer = window.setTimeout(flushBatches, 70);
}

async function flushBatches() {
  window.clearTimeout(batchTimer);
  batchTimer = 0;

  if (batchBusy) return;
  batchBusy = true;

  try {
    while (queue.length) {
      const articles = queue.splice(0, 8).filter(article => article?.isConnected);
      const posts = articles.map(createPostRequest).filter(Boolean);

      if (posts.length === 0) continue;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "classifyBatch",
          posts
        });

        const results = new Map(
          (response?.results || []).map(result => [result.requestId, result])
        );

        for (const post of posts) {
          const article = articleByRequestId.get(post.requestId);
          const result = results.get(post.requestId);

          articleByRequestId.delete(post.requestId);
          if (!article?.isConnected) continue;

          // AI filters → BLUR (not hard hide). SHOW is default / fail-open.
          const decision = response?.ok && result?.hide ? "BLUR" : "SHOW";
          const reason = decision === "BLUR" ? String(result?.reason || "") : "";
          rememberDecision(post.postId, decision, reason);
          applyDecision(article, decision, { postId: post.postId, reason });
        }
      } catch {
        for (const post of posts) {
          const article = articleByRequestId.get(post.requestId);
          articleByRequestId.delete(post.requestId);
          if (!article?.isConnected) continue;
          rememberDecision(post.postId, "SHOW");
          applyDecision(article, "SHOW", { postId: post.postId });
        }
      }

      if (queue.length) await sleep(35);
    }
  } finally {
    batchBusy = false;
    if (queue.length) scheduleBatch();
  }
}

function createPostRequest(article) {
  const text = extractText(article);
  const imageUrls = extractImageUrls(article);
  const hasVideo = Boolean(article.querySelector("video"));

  if (!text && imageUrls.length === 0 && !hasVideo) {
    showArticle(article);
    return null;
  }

  const requestId = `calm-x-${Date.now()}-${requestCounter}`;
  requestCounter += 1;
  articleByRequestId.set(requestId, article);

  return {
    requestId,
    postId: extractPostId(article),
    text,
    imageUrls,
    hasVideo
  };
}

function extractPostId(article) {
  const timeLink = article.querySelector('time')?.closest('a[href*="/status/"]');
  const fallbackLink = article.querySelector('a[href*="/status/"]');
  const href = timeLink?.getAttribute("href") || fallbackLink?.getAttribute("href") || "";
  return href.match(/\/status\/(\d+)/)?.[1] || "";
}

function extractText(article) {
  const parts = [...article.querySelectorAll('[data-testid="tweetText"]')]
    .map(node => node.innerText.trim())
    .filter(Boolean);

  return [...new Set(parts)].join("\n").slice(0, 1600);
}

function extractImageUrls(article) {
  const imageUrls = [...article.querySelectorAll('img[src*="pbs.twimg.com/"]')]
    .map(image => image.currentSrc || image.src)
    .filter(Boolean);

  const posterUrls = [...article.querySelectorAll("video[poster]")]
    .map(video => video.poster)
    .filter(Boolean);

  return [...new Set([...imageUrls, ...posterUrls])].slice(0, 4);
}

async function captureVideoFramesForRequest(requestId) {
  const article = articleByRequestId.get(String(requestId || ""));
  if (!article?.isConnected) return [];

  const videos = [...article.querySelectorAll("video")].slice(0, 1);
  if (videos.length === 0) return [];

  const frames = [];
  const seen = new Set();
  const video = videos[0];

  await waitForVideoData(video, 600);
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return [];

  for (let index = 0; index < 2; index += 1) {
    const frame = await captureCompressedVideoFrame(video).catch(() => null);

    if (frame && !seen.has(frame.data)) {
      seen.add(frame.data);
      frames.push(frame);
    }

    if (index === 0 && !video.paused && !video.ended) {
      await sleep(220);
    } else {
      break;
    }
  }

  return frames;
}

async function waitForVideoData(video, timeoutMs) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;

  await Promise.race([
    new Promise(resolve => {
      video.addEventListener("loadeddata", resolve, { once: true });
    }),
    sleep(timeoutMs)
  ]);
}

async function captureCompressedVideoFrame(video) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) return null;

  const attempts = [
    { maxDimension: VIDEO_FRAME_MAX_DIMENSION, quality: 0.52 },
    { maxDimension: VIDEO_FRAME_MAX_DIMENSION, quality: 0.40 },
    { maxDimension: VIDEO_FRAME_MAX_DIMENSION, quality: 0.30 },
    { maxDimension: VIDEO_FRAME_MAX_DIMENSION, quality: 0.22 }
  ];

  let smallest = null;

  for (const attempt of attempts) {
    const { width, height } = fitInside(
      sourceWidth,
      sourceHeight,
      attempt.maxDimension
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: false
    });

    if (!context) continue;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(video, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", attempt.quality);
    if (!blob) continue;

    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= VIDEO_FRAME_MAX_BYTES) {
      return {
        mimeType: "image/jpeg",
        data: await blobToBase64(blob)
      };
    }
  }

  if (!smallest || smallest.size > VIDEO_FRAME_MAX_BYTES) return null;

  return {
    mimeType: "image/jpeg",
    data: await blobToBase64(smallest)
  };
}

function fitInside(width, height, maxDimension) {
  const largest = Math.max(width, height);
  const scale = largest > maxDimension ? maxDimension / largest : 1;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function showPending(article) {
  if (article.dataset.calmXState === "pending") return;
  if (
    article.dataset.calmXState === "blurred" ||
    article.dataset.calmXState === "hidden" ||
    article.dataset.calmXState === "shown"
  ) {
    return;
  }

  article.dataset.calmXState = "pending";
  article.setAttribute("aria-busy", "true");
  getCard(article)?.remove();
}

function applyDecision(article, decision, options = {}) {
  if (decision === "BLUR") {
    showBlurred(article, options);
    return;
  }
  if (decision === "HIDE") {
    showHidden(article, options);
    return;
  }
  showArticle(article, options);
}

/** Soft filter: reason left, Show right — no white plate. */
function showBlurred(article, options = {}) {
  const postId = options.postId || extractPostId(article);
  const reason = String(options.reason || "").trim() || "Stressful content";

  withScrollAnchor(article, () => {
    article.dataset.calmXState = "blurred";
    article.removeAttribute("aria-busy");

    mountCard(article, {
      state: "blurred",
      title: reason,
      buttonLabel: "Show",
      onClick: () => {
        rememberDecision(postId, "SHOW");
        showArticle(article, { postId });
      }
    });
  });
}

/** Hard remove — only for explicit user settings. */
function showHidden(article, options = {}) {
  const postId = options.postId || extractPostId(article);

  withScrollAnchor(article, () => {
    article.dataset.calmXState = "hidden";
    article.removeAttribute("aria-busy");

    mountCard(article, {
      state: "hidden",
      title: "Hidden",
      buttonLabel: "Show",
      onClick: () => {
        rememberDecision(postId, "SHOW");
        showArticle(article, { postId });
      }
    });
  });
}

function showArticle(article, options = {}) {
  withScrollAnchor(article, () => {
    article.dataset.calmXState = "shown";
    article.removeAttribute("aria-busy");
    getCard(article)?.remove();
  });
}

function mountCard(article, options) {
  const next = createCard(options);
  const existing = getCard(article);

  if (existing) {
    existing.replaceWith(next);
  } else {
    article.append(next);
  }

  return next;
}

function createCard({ state, title, buttonLabel, onClick }) {
  const card = document.createElement("div");
  card.className = CARD_CLASS;
  card.dataset.state = state || "blurred";
  card.dataset.calmfeedVersion = "0.6.5";
  card.setAttribute("role", "status");
  const isOverlay = state === "blurred";
  const dark = document.documentElement.dataset.calmfeedTheme === "dark";
  const ink = dark ? "#f0efed" : "#141413";
  const surface = isOverlay
    ? dark
      ? "rgba(28, 28, 27, 0.96)"
      : "rgba(250, 250, 250, 0.96)"
    : dark
      ? "#1c1c1b"
      : "#f3f2f0";
  const buttonBg = dark ? "#1c1c1b" : "#ffffff";
  const line = dark ? "#2e2e2c" : "#e4e3e0";

  Object.assign(card.style, {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    width: "100%",
    maxWidth: "100%",
    minHeight: isOverlay ? "56px" : "72px",
    margin: "0",
    padding: isOverlay ? "12px 16px" : "14px 16px",
    border: "none",
    borderTop: isOverlay ? `1px solid ${line}` : "none",
    borderBottom: isOverlay ? "none" : `1px solid ${line}`,
    color: ink,
    background: surface,
    backdropFilter: isOverlay ? "blur(12px)" : "none",
    WebkitBackdropFilter: isOverlay ? "blur(12px)" : "none",
    fontFamily: '"Bricolage Grotesque", system-ui, -apple-system, sans-serif',
    position: isOverlay ? "absolute" : "relative",
    left: isOverlay ? "0" : "auto",
    right: isOverlay ? "0" : "auto",
    bottom: isOverlay ? "0" : "auto",
    top: isOverlay ? "auto" : "auto",
    zIndex: isOverlay ? "5" : "auto",
    pointerEvents: "auto",
    WebkitFontSmoothing: "antialiased"
  });

  const copy = document.createElement("div");
  copy.className = "calm-x-card-copy";
  Object.assign(copy.style, {
    display: "grid",
    gap: "2px",
    minWidth: "0",
    flex: "1 1 auto",
    textAlign: "left"
  });

  if (title) {
    const heading = document.createElement("strong");
    heading.className = "calm-x-card-title";
    heading.textContent = title;
    Object.assign(heading.style, {
      display: "block",
      color: ink,
      fontFamily: '"Fraunces", Georgia, serif',
      fontSize: "16px",
      fontWeight: "600",
      letterSpacing: "-0.03em",
      lineHeight: "1.2",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textShadow: "none"
    });
    copy.append(heading);
  }

  card.append(copy);

  if (buttonLabel && onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buttonLabel;
    Object.assign(button.style, {
      boxSizing: "border-box",
      flexShrink: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "34px",
      margin: "0",
      marginLeft: "auto",
      padding: "8px 16px",
      border: `1px solid ${ink}`,
      borderRadius: "999px",
      color: ink,
      background: buttonBg,
      fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
      fontSize: "13px",
      fontWeight: "600",
      letterSpacing: "-0.01em",
      cursor: "pointer"
    });
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    card.append(button);
  }

  card.addEventListener("click", event => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
  });

  return card;
}

function getCard(article) {
  if (!article) return null;
  return (
    article.querySelector(`:scope > .${CARD_CLASS}`) ||
    [...article.children].find(child => child.classList?.contains(CARD_CLASS)) ||
    null
  );
}

function runTimer() {
  clearInterval(timerId);

  const tick = () => {
    if (!sessionEndsAt) {
      removeTimerBadge();
      return;
    }

    const remaining = sessionEndsAt - Date.now();

    if (remaining <= 0) {
      sessionEndsAt = 0;
      stopVisitPing();
      removeTimerBadge();
      showIntentGateWithStats(true);
      chrome.runtime.sendMessage({ type: "markSessionEnded" }).catch(() => undefined);
      clearInterval(timerId);
      return;
    }

    showTimerBadge(remaining);
  };

  tick();
  timerId = window.setInterval(tick, 1000);
}

function showTimerBadge(milliseconds) {
  const created = !timerBadge;
  if (!timerBadge) {
    timerBadge = document.createElement("div");
    timerBadge.className = "calm-x-timer";
    timerBadge.setAttribute("aria-live", "polite");
    document.documentElement.append(timerBadge);
  }

  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const nextText = `${minutes}:${seconds}`;
  const warn = milliseconds <= 2 * 60_000;

  timerBadge.dataset.warn = warn ? "true" : "false";

  if (!created && timerBadge.textContent !== nextText) {
    timerBadge.dataset.tick = "1";
    window.clearTimeout(showTimerBadge._tickTimer);
    showTimerBadge._tickTimer = window.setTimeout(() => {
      if (timerBadge) timerBadge.dataset.tick = "0";
    }, 280);
  }

  timerBadge.textContent = nextText;
}

function removeTimerBadge() {
  timerBadge?.remove();
  timerBadge = null;
}

function showIntentGateWithStats(finished) {
  chrome.runtime
    .sendMessage({ type: "getState" })
    .then(response => {
      showIntentGate({
        finished,
        stats: response?.state?.visitStats
      });
    })
    .catch(() => showIntentGate({ finished }));
}

function showIntentGate(options = {}) {
  const finished = options.finished === true;
  if (sessionOverlay) {
    sessionOverlay.remove();
    sessionOverlay = null;
  }

  sessionOverlay = document.createElement("div");
  sessionOverlay.className = "calm-x-overlay";
  sessionOverlay.setAttribute("role", "dialog");
  sessionOverlay.setAttribute("aria-modal", "true");
  sessionOverlay.setAttribute(
    "aria-labelledby",
    "calmfeed-intent-title"
  );

  const panel = document.createElement("section");
  panel.className = "calm-x-end-panel calm-x-intent-panel";

  const title = document.createElement("h1");
  title.id = "calmfeed-intent-title";
  title.textContent = finished ? "Time’s up." : "Why are you here?";

  const note = document.createElement("p");
  note.textContent = finished
    ? "Session’s done. If you’re coming back, write a reason first."
    : "One sentence. Then you get a timed session.";

  if (options.stats?.todayMs > 0) {
    const stats = document.createElement("p");
    stats.className = "calm-x-intent-stats";
    stats.textContent = `Today on X: ${formatDuration(options.stats.todayMs)}`;
    panel.append(title, note, stats);
  } else {
    panel.append(title, note);
  }

  const reasonLabel = document.createElement("label");
  reasonLabel.className = "calm-x-intent-label";
  reasonLabel.htmlFor = "calmfeed-intent-reason";
  reasonLabel.textContent = "Reason";

  const reasonInput = document.createElement("textarea");
  reasonInput.id = "calmfeed-intent-reason";
  reasonInput.className = "calm-x-intent-input";
  reasonInput.rows = 2;
  reasonInput.maxLength = 200;
  reasonInput.placeholder = "Catch up on replies, check one link, leave…";
  reasonInput.autocomplete = "off";

  const minutesRow = document.createElement("div");
  minutesRow.className = "calm-x-intent-row";

  const minutesLabel = document.createElement("label");
  minutesLabel.className = "calm-x-intent-label";
  minutesLabel.htmlFor = "calmfeed-intent-minutes";
  minutesLabel.textContent = "Minutes";

  const minutesInput = document.createElement("input");
  minutesInput.id = "calmfeed-intent-minutes";
  minutesInput.className = "calm-x-intent-minutes";
  minutesInput.type = "number";
  minutesInput.min = "1";
  minutesInput.max = "120";
  minutesInput.value = String(defaultSessionMinutes || 10);

  minutesRow.append(minutesLabel, minutesInput);

  const error = document.createElement("p");
  error.className = "calm-x-intent-error";
  error.hidden = true;

  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "calm-x-intent-start";
  startBtn.textContent = finished ? "Start another session" : "Start session";

  const submit = async () => {
    const reason = reasonInput.value.trim();
    if (!reason) {
      error.hidden = false;
      error.textContent = "Write why you’re opening X.";
      reasonInput.focus();
      return;
    }

    startBtn.disabled = true;
    error.hidden = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "startSession",
        reason,
        minutes: minutesInput.value
      });
      if (!response?.ok) throw new Error(response?.error || "Could not start.");
      // reloadXTabs will refresh; keep overlay until then
    } catch (err) {
      error.hidden = false;
      error.textContent = err?.message || "Could not start.";
      startBtn.disabled = false;
    }
  };

  startBtn.addEventListener("click", () => {
    submit().catch(() => undefined);
  });

  reasonInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit().catch(() => undefined);
    }
  });

  panel.append(reasonLabel, reasonInput, minutesRow, error, startBtn);
  sessionOverlay.append(panel);
  document.documentElement.append(sessionOverlay);
  window.setTimeout(() => reasonInput.focus(), 50);
}

function hideSessionOverlay() {
  sessionOverlay?.remove();
  sessionOverlay = null;
}

function startVisitPing() {
  stopVisitPing();
  visitPingId = window.setInterval(() => {
    if (!(sessionEndsAt > Date.now())) {
      stopVisitPing();
      return;
    }
    if (document.visibilityState !== "visible") return;
    chrome.runtime
      .sendMessage({ type: "pingVisit", ms: 15_000 })
      .catch(() => undefined);
  }, 15_000);
}

function stopVisitPing() {
  if (visitPingId) {
    window.clearInterval(visitPingId);
    visitPingId = 0;
  }
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
