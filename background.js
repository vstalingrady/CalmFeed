const MODEL = "gemini-embedding-2";
const OUTPUT_DIMENSIONS = 768;
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
const SESSION_ALARM = "calm-x-session";
const MAX_POSTS_PER_BATCH = 8;
const MAX_MEDIA_REQUESTS = 2;
const MAX_STATIC_IMAGES = 3;
const MAX_VIDEO_FRAMES = 2;
const MAX_IMAGE_DIMENSION = 1280;
const MAX_IMAGE_BYTES = 450_000;
const MAX_VIDEO_FRAME_BYTES = 300_000;
const MAX_MEDIA_BYTES_PER_POST = 1_200_000;
const GEMINI_TIMEOUT_MS = 8_000;
const MEDIA_FETCH_TIMEOUT_MS = 6_000;
const VIDEO_CAPTURE_TIMEOUT_MS = 3_000;

const DEFAULTS = {
  apiKey: "",
  minutes: 10,
  sensitivity: "balanced",
  prototypeVectors: null,
  prototypeModel: "",
  sessionEndsAt: 0,
  sessionBlocked: false
};

const PROTOTYPES = {
  negative: [
    "An angry hostile social media post or image attacking someone to provoke outrage.",
    "A hopeless post or image saying everything is collapsing, ruined, doomed, or getting worse.",
    "A distressing or graphic post or image focused on death, violence, disaster, injury, tragedy, or suffering.",
    "A toxic argumentative reply or meme mocking someone and escalating conflict."
  ],
  safe: [
    "A calm useful social media post or image sharing information, advice, context, or a practical update.",
    "A friendly constructive post or image that is supportive, thoughtful, funny, peaceful, or encouraging."
  ]
};

const cache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(current);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== SESSION_ALARM) return;

  await chrome.storage.local.set({
    sessionEndsAt: 0,
    sessionBlocked: true
  });
  await broadcast({ type: "sessionEnded" });
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new Error("Invalid message.");
  }

  if (message.type === "getState") {
    const state = await chrome.storage.local.get(DEFAULTS);
    return { ok: true, state: publicState(state) };
  }

  if (message.type === "saveSettings") {
    const apiKey = cleanApiKey(message.apiKey);
    const minutes = clampNumber(message.minutes, 1, 120, 10);
    const sensitivity = ["gentle", "balanced", "strict"].includes(message.sensitivity)
      ? message.sensitivity
      : "balanced";

    if (!apiKey) throw new Error("Paste a Gemini API key first.");

    const prototypeVectors = await embedPrototypes(apiKey);
    cache.clear();

    await chrome.storage.local.set({
      apiKey,
      minutes,
      sensitivity,
      prototypeVectors,
      prototypeModel: MODEL
    });

    return { ok: true };
  }

  if (message.type === "startSession") {
    const state = await chrome.storage.local.get(DEFAULTS);
    const minutes = clampNumber(message.minutes ?? state.minutes, 1, 120, 10);
    const sessionEndsAt = Date.now() + minutes * 60_000;

    await chrome.storage.local.set({
      minutes,
      sessionEndsAt,
      sessionBlocked: false
    });
    await chrome.alarms.clear(SESSION_ALARM);
    await chrome.alarms.create(SESSION_ALARM, { when: sessionEndsAt });
    await broadcast({ type: "sessionStarted", sessionEndsAt });

    return { ok: true, sessionEndsAt };
  }

  if (message.type === "markSessionEnded") {
    await chrome.storage.local.set({
      sessionEndsAt: 0,
      sessionBlocked: true
    });
    return { ok: true };
  }

  if (message.type === "classifyBatch") {
    validateSender(sender);

    const posts = cleanPosts(message.posts).slice(0, MAX_POSTS_PER_BATCH);
    if (posts.length === 0) return { ok: true, results: [] };

    const state = await chrome.storage.local.get(DEFAULTS);
    if (!state.apiKey) {
      return {
        ok: true,
        results: posts.map(post => ({ requestId: post.requestId, hide: false }))
      };
    }

    const prototypeVectors = await getPrototypeVectors(state);
    const results = await classifyPosts(
      state.apiKey,
      state.sensitivity,
      prototypeVectors,
      posts,
      sender
    );

    return { ok: true, results };
  }

  throw new Error("Unknown message type.");
}

async function classifyPosts(apiKey, sensitivity, prototypeVectors, posts, sender) {
  const output = new Map();
  const uncached = [];

  for (const post of posts) {
    post.cacheKey = createCacheKey(post);
    const cached = cache.get(post.cacheKey);

    if (cached) {
      output.set(post.requestId, { requestId: post.requestId, ...cached });
    } else {
      uncached.push(post);
    }
  }

  const textPosts = uncached.filter(post => post.text);
  const textVectors = textPosts.length
    ? await embedTextBatch(apiKey, textPosts.map(post => post.text))
    : [];

  const needsMedia = [];

  textPosts.forEach((post, index) => {
    const score = scoreVector(textVectors[index], prototypeVectors);
    const hasMedia = post.imageUrls.length > 0 || post.hasVideo;
    const decision = decideText(score, sensitivity, hasMedia);

    if (decision === "media") {
      needsMedia.push(post);
      return;
    }

    storeResult(post, { hide: decision === "hide" }, output);
  });

  for (const post of uncached) {
    const hasMedia = post.imageUrls.length > 0 || post.hasVideo;
    if (!post.text && hasMedia) needsMedia.push(post);
    if (!post.text && !hasMedia) {
      storeResult(post, { hide: false }, output);
    }
  }

  await mapLimit(needsMedia, MAX_MEDIA_REQUESTS, async post => {
    try {
      const vector = await embedPost(apiKey, post, sender);
      const score = scoreVector(vector, prototypeVectors);
      const decision = decideFinal(score, sensitivity);
      storeResult(post, { hide: decision === "hide" }, output);
    } catch {
      // Filtering must fail open. A media decode, capture, or API failure
      // should never leave the user's feed permanently covered.
      storeResult(post, { hide: false }, output);
    }
  });

  return posts.map(post =>
    output.get(post.requestId) || { requestId: post.requestId, hide: false }
  );
}

function storeResult(post, result, output) {
  cache.set(post.cacheKey, result);
  if (post.postId) cache.set(`id:${post.postId}`, result);
  output.set(post.requestId, { requestId: post.requestId, ...result });

  while (cache.size > 800) {
    cache.delete(cache.keys().next().value);
  }
}

async function getPrototypeVectors(state) {
  if (state.prototypeVectors && state.prototypeModel === MODEL) {
    return state.prototypeVectors;
  }

  const prototypeVectors = await embedPrototypes(state.apiKey);
  await chrome.storage.local.set({
    prototypeVectors,
    prototypeModel: MODEL
  });
  return prototypeVectors;
}

function publicState(state) {
  return {
    hasApiKey: Boolean(state.apiKey),
    apiKey: state.apiKey || "",
    minutes: state.minutes,
    sensitivity: state.sensitivity,
    sessionEndsAt: state.sessionEndsAt,
    sessionBlocked: Boolean(state.sessionBlocked)
  };
}

function cleanPosts(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter(post => post && typeof post === "object")
    .map(post => ({
      requestId: String(post.requestId || "").slice(0, 80),
      postId: String(post.postId || "").slice(0, 80),
      text: cleanPostText(post.text),
      imageUrls: cleanImageUrls(post.imageUrls),
      hasVideo: post.hasVideo === true
    }))
    .filter(post =>
      post.requestId &&
      (post.text || post.imageUrls.length > 0 || post.hasVideo)
    );
}

function cleanApiKey(value) {
  return typeof value === "string" ? value.trim().slice(0, 256) : "";
}

function cleanPostText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 1600);
}

function cleanImageUrls(value) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value)]
    .filter(url => typeof url === "string")
    .map(url => url.trim())
    .filter(url => {
      try {
        const parsed = new URL(url);
        const allowedPath = [
          "/media/",
          "/ext_tw_video_thumb/",
          "/amplify_video_thumb/",
          "/tweet_video_thumb/"
        ].some(prefix => parsed.pathname.startsWith(prefix));

        return parsed.protocol === "https:" &&
          parsed.hostname === "pbs.twimg.com" &&
          allowedPath;
      } catch {
        return false;
      }
    })
    .slice(0, MAX_STATIC_IMAGES);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function validateSender(sender) {
  const url = sender?.tab?.url || "";
  if (!url.startsWith("https://x.com/") && !url.startsWith("https://twitter.com/")) {
    throw new Error("Classification is only available on X.");
  }
}

async function embedPrototypes(apiKey) {
  const labels = [...PROTOTYPES.negative, ...PROTOTYPES.safe];
  const values = await embedTextBatch(apiKey, labels);

  return {
    negative: values.slice(0, PROTOTYPES.negative.length),
    safe: values.slice(PROTOTYPES.negative.length)
  };
}

async function embedTextBatch(apiKey, texts) {
  const response = await fetchWithTimeout(
    `${API_BASE}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: `models/${MODEL}`,
          content: {
            parts: [{ text: prepareClassificationText(text) }]
          },
          embedContentConfig: {
            outputDimensionality: OUTPUT_DIMENSIONS
          }
        }))
      })
    },
    GEMINI_TIMEOUT_MS
  );

  const data = await readApiResponse(response);
  const embeddings = data.embeddings;

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error("Gemini returned an unexpected batch embedding response.");
  }

  return embeddings.map(embedding => normalize(embedding.values));
}

async function embedPost(apiKey, post, sender) {
  const parts = [{
    text: prepareClassificationText(
      post.text ||
      "Classify the attached social media media by emotional tone and its likelihood of causing doomscrolling."
    )
  }];

  let mediaBytes = 0;

  const imageResults = await Promise.allSettled(
    post.imageUrls
      .slice(0, MAX_STATIC_IMAGES)
      .map(url => fetchCompressedImagePart(url))
  );

  for (const result of imageResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (mediaBytes + result.value.byteLength > MAX_MEDIA_BYTES_PER_POST) break;

    mediaBytes += result.value.byteLength;
    parts.push(result.value.part);
  }

  if (post.hasVideo && parts.length <= 1 + MAX_STATIC_IMAGES) {
    const frames = await requestCompressedVideoFrames(sender, post.requestId);

    for (const frame of frames.slice(0, MAX_VIDEO_FRAMES)) {
      if (mediaBytes + frame.byteLength > MAX_MEDIA_BYTES_PER_POST) break;

      mediaBytes += frame.byteLength;
      parts.push(frame.part);
    }
  }

  if (parts.length === 1) {
    throw new Error("No usable media was found.");
  }

  return embedParts(apiKey, parts);
}

async function embedParts(apiKey, parts) {
  const response = await fetchWithTimeout(
    `${API_BASE}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model: `models/${MODEL}`,
        content: { parts },
        embedContentConfig: {
          outputDimensionality: OUTPUT_DIMENSIONS
        }
      })
    },
    GEMINI_TIMEOUT_MS
  );

  const data = await readApiResponse(response);
  const values = data.embedding?.values || data.embeddings?.[0]?.values;

  if (!Array.isArray(values)) {
    throw new Error("Gemini returned an unexpected embedding response.");
  }

  return normalize(values);
}

function prepareClassificationText(text) {
  return `task: classification | query: ${text}`;
}

async function fetchCompressedImagePart(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("format", "jpg");
  url.searchParams.set("name", "large");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      cache: "force-cache",
      credentials: "omit"
    },
    MEDIA_FETCH_TIMEOUT_MS
  );

  if (!response.ok) return null;

  const sourceBlob = await response.blob();
  if (!sourceBlob.size || sourceBlob.size > 12_000_000) return null;

  const compressedBlob = await compressImageBlob(sourceBlob);
  if (!compressedBlob) return null;

  return {
    byteLength: compressedBlob.size,
    part: {
      inline_data: {
        mime_type: "image/jpeg",
        data: await blobToBase64(compressedBlob)
      }
    }
  };
}

async function compressImageBlob(sourceBlob) {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    if (
      sourceBlob.type === "image/jpeg" &&
      sourceBlob.size <= MAX_IMAGE_BYTES
    ) {
      return sourceBlob;
    }
    return null;
  }

  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const attempts = [
      { maxDimension: MAX_IMAGE_DIMENSION, quality: 0.58 },
      { maxDimension: MAX_IMAGE_DIMENSION, quality: 0.46 },
      { maxDimension: MAX_IMAGE_DIMENSION, quality: 0.36 },
      { maxDimension: MAX_IMAGE_DIMENSION, quality: 0.28 }
    ];

    let smallest = null;

    for (const attempt of attempts) {
      const { width, height } = fitInside(
        bitmap.width,
        bitmap.height,
        attempt.maxDimension
      );
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: false });

      if (!context) continue;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      const blob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: attempt.quality
      });

      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
    }

    return smallest && smallest.size <= MAX_IMAGE_BYTES ? smallest : null;
  } finally {
    bitmap.close();
  }
}

async function requestCompressedVideoFrames(sender, requestId) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) return [];

  const options = Number.isInteger(sender.frameId)
    ? { frameId: sender.frameId }
    : undefined;

  const captureRequest = options
    ? chrome.tabs.sendMessage(
        tabId,
        { type: "captureVideoFrames", requestId },
        options
      )
    : chrome.tabs.sendMessage(
        tabId,
        { type: "captureVideoFrames", requestId }
      );

  const response = await promiseWithTimeout(
    captureRequest,
    VIDEO_CAPTURE_TIMEOUT_MS
  ).catch(() => null);

  if (!response?.ok || !Array.isArray(response.frames)) return [];

  return response.frames
    .map(frame => sanitizeInlineJpeg(frame))
    .filter(Boolean)
    .slice(0, MAX_VIDEO_FRAMES);
}

function sanitizeInlineJpeg(frame) {
  if (
    !frame ||
    frame.mimeType !== "image/jpeg" ||
    typeof frame.data !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)
  ) {
    return null;
  }

  const byteLength = estimateBase64Bytes(frame.data);
  if (byteLength <= 0 || byteLength > MAX_VIDEO_FRAME_BYTES) return null;

  return {
    byteLength,
    part: {
      inline_data: {
        mime_type: "image/jpeg",
        data: frame.data
      }
    }
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

function estimateBase64Bytes(value) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor(value.length * 3 / 4) - padding;
}

async function blobToBase64(blob) {
  return arrayBufferToBase64(await blob.arrayBuffer());
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function promiseWithTimeout(promise, timeoutMs) {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Operation timed out.")),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function scoreVector(vector, prototypes) {
  const negative = Math.max(...prototypes.negative.map(item => cosine(vector, item)));
  const safe = Math.max(...prototypes.safe.map(item => cosine(vector, item)));

  return {
    negative,
    safe,
    margin: negative - safe
  };
}

function decideText(score, sensitivity, hasImages) {
  const threshold = getThreshold(sensitivity);

  if (score.negative >= threshold.negative && score.margin >= threshold.margin) {
    return "hide";
  }

  if (score.margin <= threshold.safeMargin) {
    return "show";
  }

  return hasImages ? "media" : "show";
}

function decideFinal(score, sensitivity) {
  const threshold = getThreshold(sensitivity);
  return score.negative >= threshold.negative && score.margin >= threshold.margin
    ? "hide"
    : "show";
}

function getThreshold(sensitivity) {
  const thresholds = {
    gentle: { negative: 0.68, margin: 0.08, safeMargin: -0.02 },
    balanced: { negative: 0.62, margin: 0.04, safeMargin: -0.03 },
    strict: { negative: 0.56, margin: 0.00, safeMargin: -0.05 }
  };

  return thresholds[sensitivity] || thresholds.balanced;
}

function createCacheKey(post) {
  // Prefer stable status id so remounted tweets hit the in-memory cache.
  if (post.postId) return `id:${post.postId}`;

  const mediaIdentity = `${post.imageUrls.join("|")}|video:${post.hasVideo}`;
  const contentHash = hash(`${post.text}|${mediaIdentity}`);
  return `hash:${contentHash}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function readApiResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Gemini request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

function normalize(values) {
  if (!Array.isArray(values)) return [];
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return values;
  return values.map(value => value / magnitude);
}

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return -1;
  let dot = 0;
  for (let index = 0; index < a.length; index += 1) dot += a[index] * b[index];
  return dot;
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

async function mapLimit(items, limit, worker) {
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        await worker(item);
      }
    }
  );

  await Promise.all(runners);
}

async function broadcast(message) {
  const tabs = await chrome.tabs.query({
    url: ["https://x.com/*", "https://twitter.com/*"]
  });

  await Promise.all(
    tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
    )
  );
}
