const CATEGORY_ORDER = [
  "hostility",
  "doom",
  "graphic",
  "rageBait",
  "engagementBait"
];

const elements = {
  apiKey: document.querySelector("#apiKey"),
  reason: document.querySelector("#reason"),
  minutes: document.querySelector("#minutes"),
  status: document.querySelector("#status"),
  save: document.querySelector("#save"),
  start: document.querySelector("#start"),
  categoryList: document.querySelector("#categoryList"),
  filterToggle: document.querySelector("#filterToggle"),
  filterClose: document.querySelector("#filterClose"),
  filterPanel: document.querySelector("#filterPanel"),
  filterSummary: document.querySelector("#filterSummary"),
  visitSummary: document.querySelector("#visitSummary"),
  visitList: document.querySelector("#visitList")
};

let hiddenCategories = {
  hostility: false,
  doom: false,
  graphic: false,
  rageBait: false,
  engagementBait: false
};

let categoryMeta = {
  hostility: {
    title: "Hostility",
    example: "“You’re a nazi.” / personal insults / dunking to humiliate"
  },
  doom: {
    title: "Doom & catastrophe",
    example: "“Everything is collapsing. Nobody is safe.”"
  },
  graphic: {
    title: "Graphic content",
    example: "Gore, injury, abuse, CSAM talk, shock violence"
  },
  rageBait: {
    title: "Rage bait",
    example: "Outrage posts meant to make you furious, not inform"
  },
  engagementBait: {
    title: "Engagement bait",
    example: "“Reply YES if you agree” / “tag 3 friends” / obvious farm prompts"
  }
};

elements.save.addEventListener("click", save);
elements.start.addEventListener("click", startSession);
elements.filterToggle.addEventListener("click", () => setFilterOpen(!isFilterOpen()));
elements.filterClose.addEventListener("click", () => setFilterOpen(false));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => applySystemTheme());

applySystemTheme();
load().catch(error => setStatus(error.message));

async function load() {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  if (!response?.ok) throw new Error(response?.error || "Could not load settings.");

  const state = response.state;
  elements.apiKey.value = state.apiKey || "";
  elements.minutes.value = state.minutes || 10;
  hiddenCategories = {
    ...hiddenCategories,
    ...(state.hiddenCategories || {})
  };
  if (state.categoryMeta) categoryMeta = state.categoryMeta;
  renderCategories();
  updateFilterSummary();
  renderVisits(state.visitStats, state.visits);

  if (state.sessionEndsAt > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((state.sessionEndsAt - Date.now()) / 60_000));
    setStatus(`${minutesLeft} min left in this session.`, true);
  }
}

function renderCategories() {
  elements.categoryList.replaceChildren();

  for (const key of CATEGORY_ORDER) {
    const meta = categoryMeta[key] || { title: key, example: "" };
    const row = document.createElement("label");
    row.className = "category-row";
    row.htmlFor = `cat-${key}`;

    const text = document.createElement("div");
    text.className = "category-copy";

    const title = document.createElement("span");
    title.className = "category-title";
    title.textContent = meta.title;

    const example = document.createElement("span");
    example.className = "category-example";
    const examples = Array.isArray(meta.examples)
      ? meta.examples
      : meta.example
        ? [meta.example]
        : [];
    example.textContent = examples.join(" · ");

    text.append(title, example);

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = `cat-${key}`;
    input.checked = hiddenCategories[key] === true;
    input.addEventListener("change", () => {
      hiddenCategories[key] = input.checked;
      updateFilterSummary();
      persistCategories().catch(error => setStatus(error.message));
    });

    row.append(text, input);
    elements.categoryList.append(row);
  }
}

function isFilterOpen() {
  return document.body.classList.contains("filter-open");
}

function setFilterOpen(open) {
  document.body.classList.toggle("filter-open", open);
  elements.filterPanel.hidden = !open;
  elements.filterToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function updateFilterSummary() {
  const count = CATEGORY_ORDER.filter(key => hiddenCategories[key] === true).length;
  elements.filterSummary.textContent =
    count === 0 ? "Off" : `${count} on`;
}

async function persistCategories() {
  const response = await chrome.runtime.sendMessage({
    type: "setHiddenCategories",
    hiddenCategories
  });
  if (!response?.ok) throw new Error(response?.error || "Could not save filters.");
}

async function save() {
  setBusy(true);
  setStatus("Checking key...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "saveSettings",
      apiKey: elements.apiKey.value,
      minutes: elements.minutes.value,
      hiddenCategories
    });

    if (!response?.ok) throw new Error(response?.error || "Could not save settings.");
    setStatus("Saved. Gemini is connected.", true);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function startSession() {
  setBusy(true);

  try {
    await persistCategories();
    const reason = elements.reason.value.trim();
    if (!reason) throw new Error("Say why you’re opening X first.");

    const response = await chrome.runtime.sendMessage({
      type: "startSession",
      minutes: elements.minutes.value,
      reason
    });

    if (!response?.ok) throw new Error(response?.error || "Could not start session.");
    setStatus("Session started.", true);
    elements.reason.value = "";
    const stateResponse = await chrome.runtime.sendMessage({ type: "getState" });
    if (stateResponse?.ok) {
      renderVisits(stateResponse.state.visitStats, stateResponse.state.visits);
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderVisits(stats = {}, visits = []) {
  const today = formatDuration(stats.todayMs || 0);
  const week = formatDuration(stats.weekMs || 0);
  const count = Number(stats.count) || 0;

  if (!count) {
    elements.visitSummary.textContent = "No visits logged yet.";
  } else {
    elements.visitSummary.textContent = `Today ${today} · Last 7 days ${week} · ${count} visits`;
  }

  elements.visitList.replaceChildren();
  for (const visit of (visits || []).slice(0, 6)) {
    const row = document.createElement("div");
    row.className = "visit-row";

    const reason = document.createElement("div");
    reason.className = "visit-reason";
    reason.textContent = visit.reason || "(no reason)";

    const meta = document.createElement("div");
    meta.className = "visit-meta";
    const tracked = visit.activeMs || visit.durationMs || 0;
    meta.textContent = `${formatShortDate(visit.startedAt)} · ${formatDuration(tracked)}`;

    row.append(reason, meta);
    elements.visitList.append(row);
  }
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatShortDate(ts) {
  const date = new Date(Number(ts) || 0);
  if (!ts || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function applySystemTheme() {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function setStatus(message, ok = false) {
  elements.status.textContent = message || "";
  elements.status.classList.toggle("ok", ok);
}

function setBusy(busy) {
  elements.save.disabled = busy;
  elements.start.disabled = busy;
}
