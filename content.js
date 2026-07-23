const observed = new WeakSet();
const articleByRequestId = new Map();
const queue = [];
const VIDEO_FRAME_MAX_DIMENSION = 1280;
const VIDEO_FRAME_MAX_BYTES = 300_000;
const CARD_CLASS = "calm-x-card";

let filteringEnabled = false;
let batchTimer = 0;
let batchBusy = false;
let requestCounter = 0;
let sessionEndsAt = 0;
let timerId = 0;
let timerBadge = null;
let sessionOverlay = null;
let stylesInjected = false;

const intersectionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    intersectionObserver.unobserve(entry.target);
    enqueue(entry.target);
  }
}, { rootMargin: "1200px 0px" });

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
    showSessionEnded();
    return undefined;
  }

  if (message?.type === "sessionStarted") {
    sessionEndsAt = Number(message.sessionEndsAt) || 0;
    hideSessionEnded();
    runTimer();
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

  if (changes.sessionBlocked?.newValue === true) showSessionEnded();
  if (changes.sessionBlocked?.newValue === false) hideSessionEnded();

  if (changes.sessionEndsAt) {
    sessionEndsAt = Number(changes.sessionEndsAt.newValue) || 0;
    if (sessionEndsAt > Date.now()) runTimer();
  }
});

start().catch(error => {
  document.documentElement.classList.remove("calm-x-booting");
  console.error(error);
});

async function start() {
  document.documentElement.classList.add("calm-x-booting");
  injectStyles();

  const response = await chrome.runtime.sendMessage({ type: "getState" });
  filteringEnabled = Boolean(response?.state?.hasApiKey);
  sessionEndsAt = Number(response?.state?.sessionEndsAt) || 0;

  document.documentElement.classList.remove("calm-x-booting");
  document.documentElement.classList.toggle("calm-x-active", filteringEnabled);

  if (response?.state?.sessionBlocked) showSessionEnded();

  if (filteringEnabled) scan(document);

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  runTimer();
  console.info("[CalmFeed] content script v0.5.5 active");
}

function injectStyles() {
  const existing = document.getElementById("calmfeed-styles");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "calmfeed-styles";
  style.setAttribute("data-calmfeed", "0.5.5");
  style.textContent = getCalmFeedStyles();
  (document.documentElement || document.head).append(style);
  stylesInjected = true;
}

function getCalmFeedStyles() {
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

article[data-testid="tweet"][data-calm-x-state="pending"],
article[data-testid="tweet"][data-calm-x-state="hidden"]{
  display:block!important;position:relative!important;overflow:hidden!important;
  min-height:0!important;height:auto!important;padding:0!important;margin:0!important;
  border:none!important;background:transparent!important
}

article[data-testid="tweet"][data-calm-x-state="pending"]>:not(.calm-x-card),
article[data-testid="tweet"][data-calm-x-state="hidden"]>:not(.calm-x-card){
  display:none!important;visibility:hidden!important;pointer-events:none!important;
  height:0!important;max-height:0!important;overflow:hidden!important;
  margin:0!important;padding:0!important;border:none!important
}

.calm-x-card{
  box-sizing:border-box!important;display:flex!important;align-items:center!important;
  justify-content:space-between!important;gap:14px!important;width:100%!important;
  min-height:92px!important;margin:0!important;padding:16px!important;
  border:none!important;border-bottom:1px solid #e4e3e0!important;border-radius:0!important;
  color:#141413!important;background:#f3f2f0!important;
  font-family:"Bricolage Grotesque",system-ui,-apple-system,sans-serif!important;
  cursor:default!important;-webkit-font-smoothing:antialiased!important
}
.calm-x-card-mark{
  box-sizing:border-box!important;display:flex!important;align-items:center!important;
  justify-content:center!important;flex-shrink:0!important;width:36px!important;height:36px!important;
  border-radius:10px!important;background:#141413!important;color:#fafafa!important;
  font-family:"Fraunces",Georgia,serif!important;font-size:15px!important;font-weight:600!important;
  letter-spacing:-.03em!important;line-height:1!important
}
.calm-x-card[data-state="pending"] .calm-x-card-mark{
  background:#73736e!important;animation:calm-x-pulse 1.2s ease-in-out infinite!important
}
.calm-x-card-copy{display:grid!important;gap:2px!important;min-width:0!important;flex:1 1 auto!important}
.calm-x-card-kicker{
  display:block!important;color:#73736e!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  font-size:11px!important;font-weight:600!important;letter-spacing:.08em!important;
  text-transform:uppercase!important;line-height:1.2!important
}
.calm-x-card-title{
  display:block!important;color:#141413!important;
  font-family:"Fraunces",Georgia,serif!important;font-size:17px!important;font-weight:600!important;
  letter-spacing:-.03em!important;line-height:1.15!important
}
.calm-x-card-note{
  display:block!important;color:#73736e!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  font-size:13px!important;font-weight:400!important;letter-spacing:-.01em!important;line-height:1.35!important
}
.calm-x-card button{
  box-sizing:border-box!important;flex-shrink:0!important;display:inline-flex!important;
  align-items:center!important;justify-content:center!important;min-height:36px!important;
  margin:0!important;padding:8px 14px!important;border:1px solid #141413!important;
  border-radius:10px!important;color:#141413!important;background:#fafafa!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important;font-size:13px!important;
  font-weight:600!important;letter-spacing:-.01em!important;line-height:1!important;cursor:pointer!important
}
.calm-x-card button:hover{background:#eeedeb!important}
.calm-x-timer{
  box-sizing:border-box!important;position:fixed!important;right:18px!important;bottom:18px!important;
  z-index:2147483646!important;min-width:64px!important;padding:11px 13px!important;
  border:1px solid #e4e3e0!important;border-radius:12px!important;color:#141413!important;
  background:#fafafa!important;font-family:"Bricolage Grotesque",system-ui,sans-serif!important;
  font-size:14px!important;font-weight:600!important;letter-spacing:-.02em!important;
  line-height:1!important;text-align:center!important;box-shadow:0 10px 30px rgba(20,20,19,.1)!important;
  pointer-events:none!important
}
.calm-x-overlay{
  box-sizing:border-box!important;position:fixed!important;inset:0!important;z-index:2147483647!important;
  display:grid!important;place-items:center!important;padding:24px!important;background:#f3f2f0!important;
  color:#141413!important;font-family:"Bricolage Grotesque",system-ui,sans-serif!important
}
.calm-x-end-panel{
  box-sizing:border-box!important;width:min(460px,100%)!important;border-radius:18px!important;
  border:1px solid #e4e3e0!important;padding:32px 28px!important;background:#fafafa!important;
  box-shadow:0 20px 50px rgba(20,20,19,.08)!important;
  font-family:"Bricolage Grotesque",system-ui,sans-serif!important
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
@keyframes calm-x-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){
  .calm-x-card[data-state="pending"] .calm-x-card-mark{animation:none!important}
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
  showPending(article);
  intersectionObserver.observe(article);
}

function enqueue(article) {
  if (!article.isConnected || article.dataset.calmXQueued === "true") return;

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

          if (response?.ok && result?.hide) {
            showHidden(article);
          } else {
            showArticle(article);
          }
        }
      } catch {
        for (const post of posts) {
          const article = articleByRequestId.get(post.requestId);
          articleByRequestId.delete(post.requestId);
          if (article?.isConnected) showArticle(article);
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
  if (article.dataset.calmXState === "pending" && getCard(article)) return;
  if (article.dataset.calmXState === "hidden" || article.dataset.calmXState === "shown") return;

  article.dataset.calmXState = "pending";
  article.setAttribute("aria-busy", "true");
  mountCard(article, {
    state: "pending",
    title: "Checking post",
    note: "It will appear if it looks safe to show."
  });
}

function showHidden(article) {
  article.dataset.calmXState = "hidden";
  article.removeAttribute("aria-busy");

  mountCard(article, {
    state: "hidden",
    title: "Post hidden",
    note: "Likely negative, hostile, or graphic.",
    buttonLabel: "Show anyway",
    onClick: () => showArticle(article)
  });
}

function showArticle(article) {
  article.dataset.calmXState = "shown";
  article.removeAttribute("aria-busy");
  getCard(article)?.remove();
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

function createCard({ state, title, note, buttonLabel, onClick }) {
  // Inline styles as a hard fallback so X CSS / stale content.css cannot hide updates.
  const card = document.createElement("div");
  card.className = CARD_CLASS;
  card.dataset.state = state || "pending";
  card.dataset.calmfeedVersion = "0.5.5";
  card.setAttribute("role", "status");
  Object.assign(card.style, {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    width: "100%",
    minHeight: "92px",
    margin: "0",
    padding: "16px",
    border: "none",
    borderBottom: "1px solid #e4e3e0",
    borderRadius: "0",
    color: "#141413",
    background: "#f3f2f0",
    fontFamily: '"Bricolage Grotesque", system-ui, -apple-system, sans-serif',
    cursor: "default",
    WebkitFontSmoothing: "antialiased"
  });

  const mark = document.createElement("div");
  mark.className = "calm-x-card-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "C";
  Object.assign(mark.style, {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0",
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    background: state === "pending" ? "#73736e" : "#141413",
    color: "#fafafa",
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: "15px",
    fontWeight: "600",
    letterSpacing: "-0.03em",
    lineHeight: "1"
  });

  const copy = document.createElement("div");
  copy.className = "calm-x-card-copy";
  Object.assign(copy.style, {
    display: "grid",
    gap: "2px",
    minWidth: "0",
    flex: "1 1 auto"
  });

  const kicker = document.createElement("span");
  kicker.className = "calm-x-card-kicker";
  kicker.textContent = "CalmFeed";
  Object.assign(kicker.style, {
    display: "block",
    color: "#73736e",
    fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    lineHeight: "1.2"
  });

  const heading = document.createElement("strong");
  heading.className = "calm-x-card-title";
  heading.textContent = title;
  Object.assign(heading.style, {
    display: "block",
    color: "#141413",
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: "17px",
    fontWeight: "600",
    letterSpacing: "-0.03em",
    lineHeight: "1.15"
  });

  const description = document.createElement("span");
  description.className = "calm-x-card-note";
  description.textContent = note;
  Object.assign(description.style, {
    display: "block",
    color: "#73736e",
    fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
    fontSize: "13px",
    fontWeight: "400",
    letterSpacing: "-0.01em",
    lineHeight: "1.35"
  });

  copy.append(kicker, heading, description);
  card.append(mark, copy);

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
      minHeight: "36px",
      margin: "0",
      padding: "8px 14px",
      border: "1px solid #141413",
      borderRadius: "10px",
      color: "#141413",
      background: "#fafafa",
      fontFamily: '"Bricolage Grotesque", system-ui, sans-serif',
      fontSize: "13px",
      fontWeight: "600",
      letterSpacing: "-0.01em",
      lineHeight: "1",
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
      removeTimerBadge();
      showSessionEnded();
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
  if (!timerBadge) {
    timerBadge = document.createElement("div");
    timerBadge.className = "calm-x-timer";
    timerBadge.setAttribute("aria-live", "polite");
    document.documentElement.append(timerBadge);
  }

  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  timerBadge.textContent = `${minutes}:${seconds}`;
}

function removeTimerBadge() {
  timerBadge?.remove();
  timerBadge = null;
}

function showSessionEnded() {
  if (sessionOverlay) return;

  sessionOverlay = document.createElement("div");
  sessionOverlay.className = "calm-x-overlay";

  const panel = document.createElement("section");
  panel.className = "calm-x-end-panel";

  const eyebrow = document.createElement("span");
  eyebrow.className = "calm-x-eyebrow";
  eyebrow.textContent = "CalmFeed";

  const title = document.createElement("h1");
  title.textContent = "Session finished.";

  const note = document.createElement("p");
  note.textContent = "You came here for a reason. You can close X now, or start a new session from the extension.";

  panel.append(eyebrow, title, note);
  sessionOverlay.append(panel);
  document.documentElement.append(sessionOverlay);
}

function hideSessionEnded() {
  sessionOverlay?.remove();
  sessionOverlay = null;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
