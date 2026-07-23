const elements = {
  apiKey: document.querySelector("#apiKey"),
  minutes: document.querySelector("#minutes"),
  sensitivity: document.querySelector("#sensitivity"),
  status: document.querySelector("#status"),
  save: document.querySelector("#save"),
  start: document.querySelector("#start")
};

elements.save.addEventListener("click", save);
elements.start.addEventListener("click", startSession);

load().catch(error => setStatus(error.message));

async function load() {
  const response = await chrome.runtime.sendMessage({ type: "getState" });
  if (!response?.ok) throw new Error(response?.error || "Could not load settings.");

  const state = response.state;
  elements.apiKey.value = state.apiKey || "";
  elements.minutes.value = state.minutes || 10;
  elements.sensitivity.value = state.sensitivity || "balanced";

  if (state.sessionEndsAt > Date.now()) {
    const minutesLeft = Math.max(1, Math.ceil((state.sessionEndsAt - Date.now()) / 60_000));
    setStatus(`${minutesLeft} min left in this session.`, true);
  }
}

async function save() {
  setBusy(true);
  setStatus("Checking key...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "saveSettings",
      apiKey: elements.apiKey.value,
      minutes: elements.minutes.value,
      sensitivity: elements.sensitivity.value
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
    const response = await chrome.runtime.sendMessage({
      type: "startSession",
      minutes: elements.minutes.value
    });

    if (!response?.ok) throw new Error(response?.error || "Could not start session.");
    setStatus("Session started.", true);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function setStatus(message, ok = false) {
  elements.status.textContent = message || "";
  elements.status.classList.toggle("ok", ok);
}

function setBusy(busy) {
  elements.save.disabled = busy;
  elements.start.disabled = busy;
}
