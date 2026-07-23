const observed = new WeakSet();
const articleByRequestId = new Map();
const queue = [];
const VIDEO_FRAME_MAX_DIMENSION = 1280;
const VIDEO_FRAME_MAX_BYTES = 300_000;

let filteringEnabled = false;
let batchTimer = 0;
let batchBusy = false;
let requestCounter = 0;
let sessionEndsAt = 0;
let timerId = 0;
let timerBadge = null;
let sessionOverlay = null;

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
  if (article.dataset.calmXState) return;

  article.dataset.calmXState = "pending";
  article.setAttribute("aria-busy", "true");
  article.append(createCard({
    title: "Checking post",
    note: "It will appear if it looks safe to show."
  }));
}

function showHidden(article) {
  article.dataset.calmXState = "hidden";
  article.removeAttribute("aria-busy");

  const card = getCard(article);
  if (!card) return;

  card.replaceWith(createCard({
    title: "Post hidden",
    note: "Likely negative, hostile, or graphic.",
    buttonLabel: "Show",
    onClick: () => showArticle(article)
  }));
}

function showArticle(article) {
  article.dataset.calmXState = "shown";
  article.removeAttribute("aria-busy");
  getCard(article)?.remove();
}

function createCard({ title, note, buttonLabel, onClick }) {
  const card = document.createElement("div");
  card.className = "calm-x-card";

  const copy = document.createElement("div");
  copy.className = "calm-x-card-copy";

  const heading = document.createElement("strong");
  heading.textContent = title;

  const description = document.createElement("span");
  description.textContent = note;

  copy.append(heading, description);
  card.append(copy);

  if (buttonLabel && onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = buttonLabel;
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    card.append(button);
  }

  return card;
}

function getCard(article) {
  return [...article.children].find(child => child.classList?.contains("calm-x-card")) || null;
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
  eyebrow.textContent = "CALMFEED";

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
