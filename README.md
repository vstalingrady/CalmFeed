# CalmFeed for X

**For builders that want to use X — without the doomscroll.**

An open-source browser extension that makes X less miserable to use. Stay connected and informed. Filter toxicity. Leave when your session ends.

> I’m building an open-source browser extension that makes X less miserable to use.  
> For builders that want to use X but want to avoid doomscrolling and toxicity but want to still connect with people and stay informed.  
> Coming soon............................................... :P

## What it does

- Covers X posts **before** they hit the viewport
- Classifies text in batches with **Gemini Embedding 2**
- Compresses tweet images locally before sending them
- Samples up to two video frames instead of uploading full videos
- Only analyzes media when text is uncertain
- Collapses likely negative, hostile, or graphic posts
- Ends X when your **session timer** expires

There is no project backend, account, database, or analytics. MIT licensed. 100% open source.

## Install on Microsoft Edge

1. Clone this repo (or download the ZIP and unzip it):
   ```bash
   git clone https://github.com/vstalingrady/CalmFeed.git
   ```
2. Open Edge and go to: `edge://extensions`
3. Turn on **Developer mode** (bottom-left toggle)
4. Click **Load unpacked**
5. Select this folder: `C:\Users\vstal\calmfeed`  
   (the folder that contains `manifest.json`)
6. Pin CalmFeed from the extensions menu (puzzle icon) if you want one-click access

### Chrome

Same steps, but open `chrome://extensions` instead of `edge://extensions`.

## How to use

### 1. Get a free Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Copy it (starts with `AIza...`)

CalmFeed stores the key **only in your browser**. It talks to Google’s Gemini API directly — no CalmFeed servers.

### 2. Configure the extension

1. Click the **CalmFeed for X** icon in Edge
2. Paste your Gemini API key
3. Pick session length (**Minutes**, 1–120)
4. Pick filter strength:
   - **Gentle** — hide only clear toxicity
   - **Balanced** — default
   - **Strict** — more aggressive filtering
5. Click **Save** (you should see “Saved. Gemini is connected.”)
6. Click **Start session**
7. Refresh [x.com](https://x.com)

### 3. Browse normally

- Posts are checked before you see them
- Likely toxic / hostile / graphic posts stay collapsed — click **Show** if you want them
- A small timer badge shows remaining session time
- When time is up, CalmFeed blocks X until you start a new session

### Tips for builders

- Use short sessions (5–15 min) for replies, DMs, and news — then leave
- Prefer **Following** / lists over For You when you can
- Strict mode is useful on high-noise days; Gentle if you care about fewer false positives
- Classification will make mistakes — that is expected for v0.5

## Privacy

See [PRIVACY.md](./PRIVACY.md). Short version:

- No CalmFeed backend
- Key + settings stay in `chrome.storage.local`
- Text (and sometimes compressed images / video frames) go **only** to Google Gemini for embeddings

## Development

Plain Manifest V3 JavaScript and CSS. **No build step.**

```text
calmfeed/
  manifest.json
  background.js   # Gemini embeddings + session timer
  content.js      # DOM scanning, hide/show, overlays
  content.css
  popup.html
  popup.js
  popup.css
```

After editing:

1. Open `edge://extensions`
2. Click **Reload** on CalmFeed
3. Refresh X

## Current limitations

- Classification will make mistakes
- X may change its DOM selectors
- A paused video may provide only one frame
- Browser security may block frame capture for some videos
- In-memory result cache resets when the service worker suspends
- Session-ended screen blocks all of X until a new session starts

## License

[MIT](./LICENSE) — free to use, fork, ship, and sell.
