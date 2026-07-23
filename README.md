# <img src="icons/icon-48.png" alt="" width="36" height="36" align="absmiddle"> Calmfeed

X gets ugly fast. Calmfeed is a browser extension that asks why you’re opening X, blurs the posts you asked it to filter, then kicks you off when the timer hits zero. Visits (reason + time) stay in local browser storage — no servers.

<p align="center">
  <img src="icons/logo.png" alt="Calmfeed logo" width="160" height="160">
</p>

## What it actually does

While a session is running, the content script watches the feed and sends batches of post text to **Gemini Embedding 2**. Matches against your enabled filters get blurred in place (Show button to peek). Media only goes to Google when text alone isn't enough: images get resized and JPEG'd locally first, and videos contribute at most two compressed frames, never the full file.

Open X without a live session and you get **Why are you here?** — write a reason, pick minutes, start. Each visit lands in a local log (today / week totals in the popup). Active time ticks only while the tab is visible.

Filters are opt-in. Hostility, doom, graphic stuff, rage bait, engagement farms — all off until you flip them in the Filter side panel. When the session ends, Calmfeed blocks x.com until you start another one.

It will misclassify posts. X will break selectors. Treat both as expected.

## Install (Edge)

```bash
git clone https://github.com/vstalingrady/CalmFeed.git
```

Open `edge://extensions`, turn on **Developer mode**, hit **Load unpacked**, and pick the folder that contains `manifest.json`. Pin it if you want the popup one click away.

Chrome is the same dance at `chrome://extensions`.

## Gemini key

You need a free key from [Google AI Studio](https://aistudio.google.com/apikey). Create one, paste it into the Calmfeed popup, Save, set session length + strength, turn on whatever you want filtered, then Start session. Refresh [x.com](https://x.com).

Keys and settings never leave your browser except when the extension calls Google's embedding API to classify a post. Details: [PRIVACY.md](./PRIVACY.md).

## Dev

Plain Manifest V3 JS/CSS. No bundler.

```text
calmfeed/
  manifest.json
  background.js
  content.js
  content.css
  popup.html / popup.js / popup.css
  theme-boot.js
  icons/
  fonts/
```

Edit → Reload on the extensions page → hard-refresh X. That's the loop.

## Known sharp edges

Classification mistakes are normal; fail-open means uncertain posts still show. A paused video might only yield one frame, and some players block capture. The in-memory classify cache dies when the service worker sleeps. Session-end locks the whole site until you start again on purpose.

## License

[MIT](./LICENSE)
