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

const PROTOTYPE_VERSION = "v4-tight-engagement";

const CATEGORY_KEYS = [
  "hostility",
  "doom",
  "graphic",
  "rageBait",
  "engagementBait"
];

const DEFAULT_HIDDEN_CATEGORIES = {
  hostility: false,
  doom: false,
  graphic: false,
  rageBait: false,
  engagementBait: false
};

const CATEGORY_META = {
  hostility: {
    title: "Hostility",
    examples: [
      "“You’re a nazi.”",
      "Personal insults",
      "Dunking to humiliate"
    ]
  },
  doom: {
    title: "Doom & catastrophe",
    examples: [
      "“Everything is collapsing.”",
      "“Nobody is safe.”",
      "Hopeless catastrophe framing"
    ]
  },
  graphic: {
    title: "Graphic content",
    examples: [
      "Gore and injury",
      "Abuse / shock violence",
      "CSAM talk"
    ]
  },
  rageBait: {
    title: "Rage bait",
    examples: [
      "Posts meant to make you furious",
      "Outrage over information",
      "Provocation for clicks"
    ]
  },
  engagementBait: {
    title: "Engagement bait",
    examples: [
      "“Reply YES if you agree”",
      "“Tag 3 friends”",
      "Obvious farm prompts"
    ]
  }
};

const DEFAULTS = {
  apiKey: "",
  minutes: 10,
  hiddenCategories: { ...DEFAULT_HIDDEN_CATEGORIES },
  prototypeVectors: null,
  prototypeModel: "",
  prototypeVersion: "",
  sessionEndsAt: 0,
  sessionBlocked: false,
  visits: [],
  currentVisitId: null
};

// Many specific prototypes beat a few vague ones for embedding classifiers.
const PROTOTYPES = {
  negative: [
    // hostility
    {
      reason: "hostility",
      label: "Personal attack",
      text: "A social media post personally insulting or demeaning someone with mean names or cruel put-downs."
    },
    {
      reason: "hostility",
      label: "Hostile accusation",
      text: "A post accusing someone of being a nazi, fascist, predator, or criminal to shame them and start a fight."
    },
    {
      reason: "hostility",
      label: "Aggressive dunk",
      text: "An aggressive dunking reply that mocks someone, piles on, and tries to humiliate them in public."
    },
    {
      reason: "hostility",
      label: "Hate slur pile-on",
      text: "A hostile pile-on using slurs, dehumanizing language, or group hatred toward people."
    },
    {
      reason: "hostility",
      label: "Threat or intimidation",
      text: "A threatening or intimidating post daring someone to fight, promising harm, or trying to scare them."
    },

    // conflict / toxic argument
    {
      reason: "conflict",
      label: "Toxic argument",
      text: "A toxic argumentative reply escalating a fight with sarcasm, bad-faith framing, and no useful point."
    },
    {
      reason: "conflict",
      label: "Quote-dunk drama",
      text: "A quote-tweet dunk meant to drag someone into drama and farm agreement from an angry audience."
    },
    {
      reason: "conflict",
      label: "Callout smear",
      text: "A callout post smearing someone's character with inflammatory labels instead of calm evidence."
    },

    // doom
    {
      reason: "doom",
      label: "Doom spiral",
      text: "A hopeless doom post saying everything is collapsing, ruined, doomed, or getting irreversibly worse."
    },
    {
      reason: "doom",
      label: "Catastrophe panic",
      text: "A panic post claiming society is ending, nobody is safe, and catastrophe is inevitable with no practical info."
    },
    {
      reason: "doom",
      label: "Despair spiral",
      text: "A despairing post about constant fear, hopelessness, and the idea that nothing can ever improve."
    },
    {
      reason: "doom",
      label: "Collapse narrative",
      text: "A collapse narrative post claiming civilization, markets, or the world is failing with only fear language."
    },

    // graphic / distressing
    {
      reason: "graphic",
      label: "Graphic violence",
      text: "A graphic post or image focused on violence, blood, injury, torture, or brutal harm."
    },
    {
      reason: "graphic",
      label: "Death and tragedy focus",
      text: "A distressing post centered on death, corpses, funerals as spectacle, or tragic suffering for shock."
    },
    {
      reason: "graphic",
      label: "Abuse / exploitation talk",
      text: "A post discussing child abuse, CSAM, sexual exploitation, or similar crimes in a shocking or graphic way."
    },
    {
      reason: "graphic",
      label: "Gore or injury imagery",
      text: "A post or media showing gore, open wounds, mutilation, or medical trauma meant to disturb."
    },
    {
      reason: "graphic",
      label: "Disaster suffering focus",
      text: "A disaster post focusing on mangled bodies, suffering victims, or trauma imagery rather than useful warnings."
    },

    // rage bait
    {
      reason: "rageBait",
      label: "Rage bait",
      text: "An intentionally inflammatory claim designed to make people furious without giving useful information."
    },
    {
      reason: "rageBait",
      label: "Outrage framing",
      text: "A provocative outrage post with extreme wording meant to trigger replies and anger, not inform."
    },
    {
      reason: "rageBait",
      label: "Culture-war fuel",
      text: "A culture-war bait post that frames an issue as pure evil vs pure good to maximize tribal rage."
    },
    {
      reason: "rageBait",
      label: "Moral panic bait",
      text: "A moral-panic post exaggerating a threat with loaded language so people feel forced to react angrily."
    },

    // engagement bait — only obvious farm prompts, not vague/normal posts
    {
      reason: "engagementBait",
      label: "Reply farm prompt",
      text: "An obvious engagement farm post that explicitly says reply yes if you agree, comment your take below, or drop a fire emoji for the algorithm."
    },
    {
      reason: "engagementBait",
      label: "Tag / ratio farm",
      text: "A post that explicitly tells people to tag friends, share for reach, or help ratio someone to boost engagement."
    }
  ],
  safe: [
    "A calm practical update sharing useful information, advice, or context without insults.",
    "A factual news summary or status update that informs without panic or hostility.",
    "A useful warning with concrete details like locations, times, routes, or what to do next.",
    "An educational explanation teaching a concept, tool, or process in a constructive way.",
    "Constructive criticism that points out a problem and suggests improvement without attacking the person.",
    "A friendly supportive post that is thoughtful, encouraging, or peacefully funny.",
    "A technical builder post about code, shipping, products, or learning with no drama.",
    "A light joke or meme that is playful and not cruel, hateful, or graphic.",
    "A personal reflection or diary-like post that is honest but not hostile or hopeless doom.",
    "A measured disagreement that stays civil and focuses on ideas rather than insults.",
    "A calm discussion of a serious topic that stays informative and avoids rage or gore.",
    "A helpful recommendation sharing a book, tool, article, or workflow without bait.",
    "A short casual observation or half-thought that is harmless and not asking for replies.",
    "A normal conversational tweet sharing an opinion or update without farming engagement.",
    "A mildly incomplete or cryptic personal note that is not trying to manipulate the algorithm."
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

  await endVisitAndBlock();
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

    if (!apiKey) throw new Error("Paste a Gemini API key first.");

    const current = await chrome.storage.local.get(DEFAULTS);
    const prototypeVectors = await embedPrototypes(apiKey);
    cache.clear();

    await chrome.storage.local.set({
      apiKey,
      minutes,
      hiddenCategories: cleanHiddenCategories(
        message.hiddenCategories ?? current.hiddenCategories
      ),
      prototypeVectors,
      prototypeModel: MODEL,
      prototypeVersion: PROTOTYPE_VERSION
    });

    return { ok: true };
  }

  if (message.type === "setHiddenCategories") {
    const hiddenCategories = cleanHiddenCategories(message.hiddenCategories);
    cache.clear();
    await chrome.storage.local.set({ hiddenCategories });
    await broadcast({ type: "categoriesChanged", hiddenCategories });
    return { ok: true, hiddenCategories };
  }

  if (message.type === "startSession") {
    const state = await chrome.storage.local.get(DEFAULTS);
    const minutes = clampNumber(message.minutes ?? state.minutes, 1, 120, 10);
    const reason = cleanReason(message.reason);
    if (!reason) throw new Error("Say why you’re here first.");

    const sessionEndsAt = Date.now() + minutes * 60_000;
    const visitId = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const visit = {
      id: visitId,
      reason,
      plannedMinutes: minutes,
      startedAt: Date.now(),
      endedAt: 0,
      durationMs: 0,
      activeMs: 0
    };
    const visits = [...cleanVisits(state.visits), visit].slice(-120);

    await chrome.storage.local.set({
      minutes,
      sessionEndsAt,
      sessionBlocked: false,
      visits,
      currentVisitId: visitId
    });
    await chrome.alarms.clear(SESSION_ALARM);
    await chrome.alarms.create(SESSION_ALARM, { when: sessionEndsAt });
    await broadcast({ type: "sessionStarted", sessionEndsAt, reason });
    await reloadXTabs();

    return { ok: true, sessionEndsAt, visitId };
  }

  if (message.type === "markSessionEnded") {
    await endVisitAndBlock();
    return { ok: true };
  }

  if (message.type === "pingVisit") {
    const added = clampNumber(message.ms, 1, 60_000, 15_000);
    const state = await chrome.storage.local.get(DEFAULTS);
    if (!state.currentVisitId || !(state.sessionEndsAt > Date.now())) {
      return { ok: true };
    }

    const visits = cleanVisits(state.visits);
    const index = visits.findIndex(visit => visit.id === state.currentVisitId);
    if (index >= 0) {
      visits[index] = {
        ...visits[index],
        activeMs: Number(visits[index].activeMs || 0) + added
      };
      await chrome.storage.local.set({ visits });
    }
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
        results: posts.map(post => ({ requestId: post.requestId, hide: false, reason: "" }))
      };
    }

    const hiddenCategories = cleanHiddenCategories(state.hiddenCategories);
    if (!CATEGORY_KEYS.some(key => hiddenCategories[key])) {
      return {
        ok: true,
        results: posts.map(post => ({
          requestId: post.requestId,
          hide: false,
          reason: ""
        }))
      };
    }

    const prototypeVectors = await getPrototypeVectors(state);
    const results = await classifyPosts(
      state.apiKey,
      hiddenCategories,
      prototypeVectors,
      posts,
      sender
    );

    return { ok: true, results };
  }

  throw new Error("Unknown message type.");
}

async function classifyPosts(
  apiKey,
  hiddenCategories,
  prototypeVectors,
  posts,
  sender
) {
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
    const decision = decideText(score, hasMedia);

    if (decision === "media") {
      needsMedia.push(post);
      return;
    }

    storeResult(post, decideToResult(decision, score, hiddenCategories), output);
  });

  for (const post of uncached) {
    const hasMedia = post.imageUrls.length > 0 || post.hasVideo;
    if (!post.text && hasMedia) needsMedia.push(post);
    if (!post.text && !hasMedia) {
      storeResult(post, { hide: false, reason: "" }, output);
    }
  }

  await mapLimit(needsMedia, MAX_MEDIA_REQUESTS, async post => {
    try {
      const vector = await embedPost(apiKey, post, sender);
      const score = scoreVector(vector, prototypeVectors);
      const decision = decideFinal(score);
      storeResult(post, decideToResult(decision, score, hiddenCategories), output);
    } catch {
      storeResult(post, { hide: false, reason: "" }, output);
    }
  });

  return posts.map(post =>
    output.get(post.requestId) || { requestId: post.requestId, hide: false, reason: "" }
  );
}

function decideToResult(decision, score, hiddenCategories) {
  if (decision !== "hide") return { hide: false, reason: "" };
  if (!isCategoryEnabled(score.reason, hiddenCategories)) {
    return { hide: false, reason: "" };
  }
  return { hide: true, reason: score.reasonLabel };
}

function normalizeCategory(reason) {
  if (reason === "conflict") return "hostility";
  return reason;
}

function isCategoryEnabled(reason, hiddenCategories) {
  const key = normalizeCategory(reason);
  return Boolean(hiddenCategories?.[key]);
}

function cleanHiddenCategories(value) {
  const source = value && typeof value === "object" ? value : {};
  const next = { ...DEFAULT_HIDDEN_CATEGORIES };
  for (const key of CATEGORY_KEYS) {
    next[key] = source[key] === true;
  }
  return next;
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
  if (
    state.prototypeVectors &&
    state.prototypeModel === MODEL &&
    state.prototypeVersion === PROTOTYPE_VERSION
  ) {
    return state.prototypeVectors;
  }

  const prototypeVectors = await embedPrototypes(state.apiKey);
  cache.clear();
  await chrome.storage.local.set({
    prototypeVectors,
    prototypeModel: MODEL,
    prototypeVersion: PROTOTYPE_VERSION
  });
  return prototypeVectors;
}

function publicState(state) {
  const visits = cleanVisits(state.visits);
  return {
    hasApiKey: Boolean(state.apiKey),
    apiKey: state.apiKey || "",
    minutes: state.minutes,
    hiddenCategories: cleanHiddenCategories(state.hiddenCategories),
    categoryMeta: CATEGORY_META,
    sessionEndsAt: state.sessionEndsAt,
    sessionBlocked: Boolean(state.sessionBlocked),
    currentVisitId: state.currentVisitId || null,
    visits: visits.slice(-20).reverse(),
    visitStats: summarizeVisits(visits)
  };
}

async function endVisitAndBlock() {
  const state = await chrome.storage.local.get(DEFAULTS);
  const visits = cleanVisits(state.visits);
  const now = Date.now();

  if (state.currentVisitId) {
    const index = visits.findIndex(visit => visit.id === state.currentVisitId);
    if (index >= 0 && !visits[index].endedAt) {
      visits[index] = {
        ...visits[index],
        endedAt: now,
        durationMs: Math.max(0, now - Number(visits[index].startedAt || now))
      };
    }
  }

  await chrome.storage.local.set({
    sessionEndsAt: 0,
    sessionBlocked: true,
    visits,
    currentVisitId: null
  });
}

function cleanReason(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 200);
}

function cleanVisits(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(visit => visit && typeof visit === "object")
    .map(visit => ({
      id: String(visit.id || "").slice(0, 64),
      reason: cleanReason(visit.reason) || "(no reason)",
      plannedMinutes: clampNumber(visit.plannedMinutes, 1, 120, 10),
      startedAt: Number(visit.startedAt) || 0,
      endedAt: Number(visit.endedAt) || 0,
      durationMs: Math.max(0, Number(visit.durationMs) || 0),
      activeMs: Math.max(0, Number(visit.activeMs) || 0)
    }))
    .filter(visit => visit.id && visit.startedAt);
}

function summarizeVisits(visits) {
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayStart = startOfDay.getTime();
  const weekStart = dayStart - 6 * 24 * 60 * 60 * 1000;

  let todayMs = 0;
  let weekMs = 0;

  for (const visit of visits) {
    const tracked = visit.activeMs > 0
      ? visit.activeMs
      : visit.durationMs > 0
        ? visit.durationMs
        : visit.endedAt
          ? Math.max(0, visit.endedAt - visit.startedAt)
          : 0;
    if (visit.startedAt >= dayStart) todayMs += tracked;
    if (visit.startedAt >= weekStart) weekMs += tracked;
  }

  return {
    count: visits.length,
    todayMs,
    weekMs,
    now
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
  const negativeTexts = PROTOTYPES.negative.map(item => item.text);
  const labels = [...negativeTexts, ...PROTOTYPES.safe];
  const values = await embedTextBatch(apiKey, labels, 20_000);

  return {
    negative: values.slice(0, PROTOTYPES.negative.length),
    safe: values.slice(PROTOTYPES.negative.length)
  };
}

async function embedTextBatch(apiKey, texts, timeoutMs = GEMINI_TIMEOUT_MS) {
  const chunkSize = 16;
  const vectors = [];

  for (let offset = 0; offset < texts.length; offset += chunkSize) {
    const chunk = texts.slice(offset, offset + chunkSize);
    const response = await fetchWithTimeout(
      `${API_BASE}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          requests: chunk.map(text => ({
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
      timeoutMs
    );

    const data = await readApiResponse(response);
    const embeddings = data.embeddings;

    if (!Array.isArray(embeddings) || embeddings.length !== chunk.length) {
      throw new Error("Gemini returned an unexpected batch embedding response.");
    }

    for (const embedding of embeddings) {
      vectors.push(normalize(embedding.values));
    }
  }

  return vectors;
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
  let negative = -1;
  let reasonIndex = 0;

  prototypes.negative.forEach((item, index) => {
    const value = cosine(vector, item);
    if (value > negative) {
      negative = value;
      reasonIndex = index;
    }
  });

  const safe = Math.max(...prototypes.safe.map(item => cosine(vector, item)));
  const matched = PROTOTYPES.negative[reasonIndex] || PROTOTYPES.negative[0];

  return {
    negative,
    safe,
    margin: negative - safe,
    reason: matched.reason,
    reasonLabel: matched.label
  };
}

function decideText(score, hasImages) {
  const threshold = MATCH_THRESHOLD;

  if (
    (score.negative >= threshold.negative && score.margin >= threshold.margin) ||
    score.negative >= threshold.strong
  ) {
    return "hide";
  }

  if (score.margin <= threshold.safeMargin) {
    return "show";
  }

  return hasImages ? "media" : "show";
}

function decideFinal(score) {
  const threshold = MATCH_THRESHOLD;
  return (
    (score.negative >= threshold.negative && score.margin >= threshold.margin) ||
    score.negative >= threshold.strong
  )
    ? "hide"
    : "show";
}

const MATCH_THRESHOLD = {
  negative: 0.60,
  margin: 0.03,
  safeMargin: -0.03,
  strong: 0.70
};

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

async function reloadXTabs() {
  const tabs = await chrome.tabs.query({
    url: ["https://x.com/*", "https://twitter.com/*"]
  });

  await Promise.all(
    tabs.map(tab =>
      chrome.tabs.reload(tab.id).catch(() => undefined)
    )
  );
}
