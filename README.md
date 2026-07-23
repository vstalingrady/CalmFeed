# <img src="icons/icon-48.png" alt="" width="36" height="36" align="absmiddle"> CalmFeed

**For builders that want to use X — without the doomscroll.**

Open-source browser extension that makes X less miserable to use. Stay connected and informed. Filter toxicity. Leave when your session ends.

<p align="center">
  <img src="icons/logo.png" alt="CalmFeed logo" width="160" height="160">
</p>

MIT licensed. No backend, no accounts, no analytics.

## What it does

- Covers X posts **before** they hit the viewport
- Classifies text in batches with **Gemini Embedding 2**
- Compresses tweet images locally before sending them
- Samples up to two video frames instead of uploading full videos
- Only analyzes media when text is uncertain
- Collapses likely negative, hostile, or graphic posts
- Ends X when your **session timer** expires

## Install on Microsoft Edge

1. Clone this repo (or download the ZIP and unzip it):
   ```bash
   git clone https://github.com/vstalingrady/CalmFeed.git
   ```
2. Open Edge and go to: `edge://extensions`
3. Turn on **Developer mode** (bottom-left toggle)
4. Click **Load unpacked**
5. Select the folder that contains `manifest.json`
6. Pin CalmFeed from the extensions menu if you want one-click access

### Chrome

Same steps at `chrome://extensions`.

## How to get a Gemini API key

CalmFeed needs a free Gemini key so it can classify posts on-device via Google’s API.

1. Open **[Google AI Studio → API keys](https://aistudio.google.com/apikey)**
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key (it starts with `AIza…`)
5. Open the CalmFeed popup → paste the key → **Save**
6. Set minutes + filter strength → **Start session**
7. Refresh [x.com](https://x.com)

Your key is stored only in `chrome.storage.local` on this browser. CalmFeed has no servers. See [PRIVACY.md](./PRIVACY.md).

### Filter modes

| Mode | Behavior |
|------|----------|
| Gentle | Hide only clear toxicity |
| Balanced | Default |
| Strict | More aggressive filtering |

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Development

Plain Manifest V3 JavaScript and CSS. **No build step.**

```text
calmfeed/
  manifest.json
  background.js
  content.js
  content.css
  popup.html
  popup.js
  popup.css
  icons/
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

[MIT](./LICENSE)
